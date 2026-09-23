// Proxy helpers: Vercel admin APIs → Google Apps Script (admin_action + secret)
//
// Як відповідає Apps Script: POST виконує скрипт і повертає 302 на
// script.googleusercontent.com, а вже GET за тією адресою віддає JSON.
//
// Заміри 15.09.2026: сам скрипт завершується за 2–6 с (журнал виконань), але Google
// інколи тримає БУДЬ-ЯКИЙ із двох кроків відповіді — з Mac по 8–18 с, а з серверів Vercel
// після релізу #139 крок 1 висів понад 30 с двічі поспіль для одного запиту. Послідовні
// повтори тут не допомагають: кожна спроба чекає свій тайм-аут до кінця.
//
// Тому:
//  • кроки розділені — якщо POST повернув переадресацію, скрипт уже виконано, і завислий
//    другий крок перепитуємо, не запускаючи дію вдруге;
//  • для ЧИТАНЬ спроби йдуть паралельно з випередженням: якщо перша не відповіла за
//    кілька секунд, стартує друга (потім третя), і перемагає та, що прийде першою.
//    Решту скасовуємо. Читання нічого не змінює, тож зайвий запуск — лише кілька секунд
//    роботи скрипту;
//  • записи не повторюються наосліп: лише з request_id або коли відомо, що безпечно.

// Дії, що ЗМІНЮЮТЬ дані: їх не можна повторювати автоматично.
const WRITE_ACTIONS = new Set([
  "create_order", "update_order", "delete_order_item", "upsert_partner",
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
// Частина файлу (3 МБ на Google Диск) і відправка файлу в Telegram ідуть довше за
// звичайний запис.
const LONG_ACTIONS = new Set([
  "file_upload_chunk", "file_upload_status", "file_upload_small",
  "contractor_send", "contractor_send_file",
]);

// Налаштування часу. Обʼєкт, а не константи, — щоб тести могли прискорити випередження.
const TIMING = {
  // Скільки чекаємо, поки Google виконає скрипт і віддасть переадресацію (крок 1).
  executeMs: { read: 25000, write: 40000, long: 55000 },
  // Скільки чекаємо на готову відповідь (крок 2) — скрипт на цей момент уже виконано.
  resultMs: 12000,
  // Загальний бюджет виклику. Кабінет чекає 60 с на читання і 90 с на запис, тож сервер
  // має встигнути відповісти (хай і помилкою) раніше. Функції проєкту — до 300 с.
  budgetMs: { read: 45000, write: 55000, long: 80000 },
  // Читання: через скільки мілісекунд без відповіді запускаємо ще одну спробу. Заміри:
  // звичайна відповідь — 1–4 с (+3–4 с виконання bootstrap), а ~40% запитів Google тримає
  // 6–35 с випадково, незалежно від навантаження. Кожні 6 с — нова спроба, до чотирьох.
  hedgeAfterMs: 6000,
  maxReadAttempts: 4,
};

const REDIRECT_CODES = new Set([301, 302, 303, 307, 308]);

function sheetsError(message, status, code, extra) {
  const err = new Error(message);
  err.status = status;
  if (code) err.code = code;
  return Object.assign(err, extra || {});
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Один HTTP-запит із тайм-аутом, що охоплює й читання тіла (воно теж може зависнути),
// та з можливістю скасувати ззовні (коли інша спроба вже перемогла).
async function request(url, options, timeoutMs, cancelSignal, wantBody) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1, timeoutMs));
  const onCancel = () => controller.abort();
  if (cancelSignal) {
    if (cancelSignal.aborted) controller.abort();
    else cancelSignal.addEventListener("abort", onCancel, { once: true });
  }
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    let data = null;
    if (wantBody(res)) {
      try {
        data = await res.json();
      } catch (err) {
        if (err && err.name === "AbortError") throw err;
        data = null;
      }
    }
    return { res, data };
  } finally {
    clearTimeout(timer);
    if (cancelSignal) cancelSignal.removeEventListener("abort", onCancel);
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
  const deadline = Date.now() + TIMING.budgetMs[kind];
  const left = () => deadline - Date.now();

  // Крок 1: запуск скрипту. Переадресацію НЕ виконуємо автоматично.
  async function execute(cancel) {
    const limit = Math.min(TIMING.executeMs[kind], left());
    try {
      return await request(url, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body,
        redirect: "manual",
      }, limit, cancel, (res) => !REDIRECT_CODES.has(res.status));
    } catch (err) {
      if (err && err.name === "AbortError") {
        throw sheetsError(`Google Sheets не відповів за ${Math.round(limit / 1000)} секунд`, 504, "SHEETS_TIMEOUT");
      }
      throw sheetsError("Немає звʼязку з Google Sheets", 502, "SHEETS_NETWORK");
    }
  }

  // Крок 2: забираємо готову відповідь. Скрипт уже виконано, тож повтор безпечний.
  async function collect(location, cancel) {
    let lastError = null;
    for (let attempt = 0; attempt < 3 && left() > 1000; attempt += 1) {
      if (cancel && cancel.aborted) break;
      if (attempt > 0) await wait(400);
      let reply;
      try {
        reply = await request(location, { method: "GET", redirect: "manual" },
          Math.min(TIMING.resultMs, left()), cancel, (res) => res.ok);
      } catch (err) {
        lastError = err;
        continue;   // завис або обірвався — перепитуємо ту саму адресу
      }
      if (reply.res.ok) return reply.data;
      // Відповідь уже віддано або вона протермінувалась — далі перепитувати марно.
      lastError = new Error(`HTTP ${reply.res.status}`);
      break;
    }
    throw sheetsError(
      "Таблиця виконала дію, але відповідь не дійшла. Оновіть дані, щоб побачити результат.",
      502, "SHEETS_RESULT_LOST", { cause: lastError }
    );
  }

  // Непрочитане чи обрізане тіло — провал цієї спроби, а не результат: інакше вона
  // «перемогла» б і скасувала паралельну спробу, що несе нормальні дані.
  function ensureBody(data) {
    if (!data || typeof data !== "object") {
      throw sheetsError("Google Sheets повернув пошкоджену відповідь", 502, "SHEETS_BAD_BODY");
    }
    return data;
  }

  async function once(cancel) {
    const { res, data } = await execute(cancel);
    if (REDIRECT_CODES.has(res.status)) {
      const location = res.headers && res.headers.get ? res.headers.get("location") : "";
      if (!location) throw sheetsError("Google Sheets не повернув адресу відповіді", 502, "SHEETS_BAD_REDIRECT");
      return ensureBody(await collect(location, cancel));
    }
    if (!res.ok) {
      throw sheetsError((data && data.message) || `Sheets HTTP ${res.status}`, 502, "SHEETS_HTTP", { details: data });
    }
    return ensureBody(data);
  }

  // Читання: кілька спроб із випередженням, перемагає перша успішна.
  function hedgedRead() {
    return new Promise((resolve, reject) => {
      const cancel = new AbortController();
      let launched = 0, failed = 0, done = false, lastError = null, timer = null;

      const finish = (fn, value) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        cancel.abort();   // решта спроб більше не потрібна
        fn(value);
      };
      const canLaunch = () => !done && launched < TIMING.maxReadAttempts && left() > 5000;
      const scheduleHedge = () => {
        clearTimeout(timer);
        if (canLaunch()) timer = setTimeout(launch, TIMING.hedgeAfterMs);
      };
      function launch() {
        if (!canLaunch()) return;
        launched += 1;
        scheduleHedge();
        once(cancel.signal).then(
          (data) => finish(resolve, data),
          (err) => {
            if (done) return;
            failed += 1;
            lastError = err;
            if (failed < launched) return;           // ще хтось у дорозі — чекаємо
            if (canLaunch()) {                        // усі впали швидко — ще одна спроба
              clearTimeout(timer);
              setTimeout(launch, 500);
              return;
            }
            finish(reject, lastError);
          }
        );
      }
      launch();
    });
  }

  let data;
  if (readAction) {
    data = await hedgedRead();
  } else {
    for (let attempt = 1; ; attempt += 1) {
      try {
        data = await once(null);
        break;
      } catch (err) {
        // Другий повний запуск — лише один, лише якщо лишився час і лише коли це безпечно:
        //  • записи з request_id — Apps Script не зробить дубль;
        //  • відкриття сесії завантаження — коли відомо, що перший запуск завершився.
        // Довгі дії після тайм-ауту кроку 1 не повторюємо: вони можуть ще тривати —
        // повторює клієнт тим самим request_id і отримує «pending» або результат.
        const executed = err.code === "SHEETS_RESULT_LOST";
        const safe = repeatable || (executed && RERUN_AFTER_EXECUTION.has(action));
        const longStillRunning = kind === "long" && err.code === "SHEETS_TIMEOUT";
        if (attempt >= 2 || !safe || longStillRunning || left() < 8000) throw err;
        await wait(retryableWrite ? 800 : 600);
      }
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

module.exports = { callAdminSheets, sendError, TIMING };
