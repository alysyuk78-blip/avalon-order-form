// Proxy helpers: Vercel admin APIs → Google Apps Script (admin_action + secret)
//
// Як відповідає Apps Script: POST виконує скрипт і повертає 302 на
// script.googleusercontent.com, а вже GET за тією адресою віддає JSON.
// Заміри 15.09.2026: сам скрипт завершується за 1–6 с (журнал виконань), але Google
// інколи тримає БУДЬ-ЯКИЙ із двох кроків по 8–18 с, а зрідка довше за тайм-аут. Коли
// кроки йшли одним fetch із автопереадресацією, завислий другий крок виглядав як
// «Google Sheets не відповів» — хоча дію вже було виконано (збереження замовлення
// проходило, а кабінет показував помилку).
//
// Тому кроки розділені. Якщо відповідь POST — переадресація, скрипт уже відпрацював:
// завислий другий крок перепитуємо окремо, не запускаючи дію вдруге.

// Дії, що ЗМІНЮЮТЬ дані: їх не можна повторювати автоматично.
const WRITE_ACTIONS = new Set([
  "create_order", "update_order", "upsert_partner",
  "add_expense", "update_expense", "add_payout",
  "add_payment", "delete_payment",
  "settlement_pdf", "settlement_send", "migrate_legacy_payments",
  "file_upload_init", "file_upload_small", "file_upload_chunk", "file_trash",
  "contractor_send", "contractor_send_file",
]);
// Записи, які можна запустити ще раз, якщо ВІДОМО, що перший запуск завершився, а його
// відповідь загубилась: повтор нічого не зіпсує. Відкриття сесії завантаження лише
// створить ще одну (невикористана сама зникне), а тека замовлення вже збережена.
const RERUN_AFTER_EXECUTION = new Set(["file_upload_init"]);

// Скільки чекаємо, поки Google виконає скрипт (крок 1).
const EXECUTE_TIMEOUT_MS = { read: 30000, write: 40000, long: 55000 };
// Скільки чекаємо на готову відповідь (крок 2) — скрипт на цей момент уже виконано.
const RESULT_TIMEOUT_MS = 12000;
// Загальний бюджет одного виклику разом із повторами. Функції проєкту мають до 300 с
// (fluid compute), а кабінет чекає 60 с на читання і 90 с на запис.
const BUDGET_MS = { read: 55000, write: 55000, long: 80000 };
// Частина файлу (3 МБ на Google Диск) і відправка файлу в Telegram ідуть довше за
// звичайний запис.
const LONG_ACTIONS = new Set([
  "file_upload_chunk", "file_upload_status", "file_upload_small",
  "contractor_send", "contractor_send_file",
]);

const REDIRECT_CODES = new Set([301, 302, 303, 307, 308]);

function sheetsError(message, status, code, extra) {
  const err = new Error(message);
  err.status = status;
  if (code) err.code = code;
  return Object.assign(err, extra || {});
}

async function fetchWithin(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1, timeoutMs));
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function readJson(res) {
  try {
    return await res.json();
  } catch (_) {
    return null;
  }
}

async function callAdminSheets(action, payload) {
  const url = process.env.GOOGLE_SHEET_URL;
  const secret = process.env.ADMIN_API_SECRET;
  if (!url) throw sheetsError("GOOGLE_SHEET_URL is not configured", 503);
  if (!secret) throw sheetsError("ADMIN_API_SECRET is not configured", 503);

  const body = JSON.stringify({
    admin_action: action,
    admin_secret: secret,
    ...(payload || {}),
  });

  // Із записів повторюємо лише ті, що мають request_id: Apps Script упізнає повтор і
  // не створить дубль (платіж, створення замовлення, надсилання підряднику, малий файл).
  const hasRequestId = (value) => !!String(value || "").trim();
  const retryableWrite =
    (action === "add_payment" && hasRequestId(payload && payload.payment && payload.payment.request_id)) ||
    (action === "create_order" && hasRequestId(payload && payload.order && payload.order.request_id)) ||
    ((action === "contractor_send" || action === "contractor_send_file" || action === "file_upload_small") &&
      hasRequestId(payload && payload.request_id));
  const readAction = !WRITE_ACTIONS.has(action);
  const repeatable = readAction || retryableWrite;
  const kind = LONG_ACTIONS.has(action) ? "long" : (readAction ? "read" : "write");
  const deadline = Date.now() + BUDGET_MS[kind];
  const left = () => deadline - Date.now();

  // Крок 1: запуск скрипту. Переадресацію НЕ виконуємо автоматично.
  async function execute() {
    const limit = Math.min(EXECUTE_TIMEOUT_MS[kind], left());
    try {
      return await fetchWithin(url, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body,
        redirect: "manual",
      }, limit);
    } catch (err) {
      if (err && err.name === "AbortError") {
        throw sheetsError(`Google Sheets не відповів за ${Math.round(limit / 1000)} секунд`, 504, "SHEETS_TIMEOUT");
      }
      throw sheetsError("Немає звʼязку з Google Sheets", 502, "SHEETS_NETWORK");
    }
  }

  // Крок 2: забираємо готову відповідь. Скрипт уже виконано, тож повтор безпечний.
  async function collect(location) {
    let lastError = null;
    for (let attempt = 0; attempt < 3 && left() > 1000; attempt += 1) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, 400));
      let res;
      try {
        res = await fetchWithin(location, { method: "GET", redirect: "manual" }, Math.min(RESULT_TIMEOUT_MS, left()));
      } catch (err) {
        lastError = err;
        continue;   // завис або обірвався — перепитуємо ту саму адресу
      }
      if (res.ok) return readJson(res);
      // Відповідь уже віддано або вона протермінувалась — далі перепитувати марно.
      lastError = new Error(`HTTP ${res.status}`);
      break;
    }
    throw sheetsError(
      "Таблиця виконала дію, але відповідь не дійшла. Оновіть дані, щоб побачити результат.",
      502, "SHEETS_RESULT_LOST", { cause: lastError }
    );
  }

  async function once() {
    const res = await execute();
    if (REDIRECT_CODES.has(res.status)) {
      const location = res.headers && res.headers.get ? res.headers.get("location") : "";
      if (!location) throw sheetsError("Google Sheets не повернув адресу відповіді", 502, "SHEETS_BAD_REDIRECT");
      return collect(location);
    }
    if (!res.ok) {
      const data = await readJson(res);
      throw sheetsError((data && data.message) || `Sheets HTTP ${res.status}`, 502, "SHEETS_HTTP", { details: data });
    }
    return readJson(res);
  }

  let data;
  for (let attempt = 1; ; attempt += 1) {
    try {
      data = await once();
      break;
    } catch (err) {
      // Другий повний запуск — лише один, лише якщо лишився час і лише коли це безпечно:
      //  • читання й записи з request_id — завжди;
      //  • відкриття сесії завантаження — коли відомо, що перший запуск завершився.
      // Довгі дії після тайм-ауту кроку 1 не повторюємо: вони можуть ще тривати —
      // повторює клієнт тим самим request_id і отримує «pending» або результат.
      const executed = err.code === "SHEETS_RESULT_LOST";
      const safe = repeatable || (executed && RERUN_AFTER_EXECUTION.has(action));
      const longStillRunning = kind === "long" && err.code === "SHEETS_TIMEOUT";
      if (attempt >= 2 || !safe || longStillRunning || left() < 8000) throw err;
      await new Promise((r) => setTimeout(r, retryableWrite ? 800 : 600));
    }
  }

  if (!data || data.status === "error") {
    const err = sheetsError((data && data.message) || "Apps Script admin error", data && data.code === 401 ? 401 : 502);
    err.details = data;
    throw err;
  }

  return data;
}

function sendError(res, err) {
  const status = err.status || 500;
  return res.status(status).json({
    error: err.message || "Internal error",
    code: err.code || undefined,
    details: err.details || undefined,
  });
}

module.exports = { callAdminSheets, sendError };
