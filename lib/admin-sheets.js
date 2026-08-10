// Proxy helpers: Vercel admin APIs → Google Apps Script (admin_action + secret)

// Дії, що ЗМІНЮЮТЬ дані: їх не можна повторювати автоматично.
const WRITE_ACTIONS = new Set([
  "create_order", "update_order", "upsert_partner",
  "add_expense", "update_expense", "add_payout",
  "add_payment", "delete_payment",
  "settlement_pdf", "settlement_send",
]);
const READ_TIMEOUT_MS = 40000;
const WRITE_TIMEOUT_MS = 25000;

async function callAdminSheets(action, payload) {
  const url = process.env.GOOGLE_SHEET_URL;
  const secret = process.env.ADMIN_API_SECRET;
  if (!url) {
    const err = new Error("GOOGLE_SHEET_URL is not configured");
    err.status = 503;
    throw err;
  }
  if (!secret) {
    const err = new Error("ADMIN_API_SECRET is not configured");
    err.status = 503;
    throw err;
  }

  const body = JSON.stringify({
    admin_action: action,
    admin_secret: secret,
    ...(payload || {}),
  });

  // Apps Script інколи віддає 404/500 або зависає на редиректі googleusercontent.
  // Читання можна повторити завжди. Із записів повторюємо лише платіж або створення
  // замовлення з request_id: Apps Script впізнає повтор і не створить дубль.
  const retryablePayment = action === "add_payment" && !!(
    payload && payload.payment && String(payload.payment.request_id || "").trim()
  );
  const retryableOrder = action === "create_order" && !!(
    payload && payload.order && String(payload.order.request_id || "").trim()
  );
  const retryableWrite = retryablePayment || retryableOrder;
  const readAction = !WRITE_ACTIONS.has(action);
  const retryableAction = readAction || retryableWrite;
  const timeoutMs = readAction ? READ_TIMEOUT_MS : WRITE_TIMEOUT_MS;

  async function send() {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  async function sendWithReadableTimeout() {
    try {
      return await send();
    } catch (err) {
      if (err && err.name === "AbortError") {
        const timeoutError = new Error(`Google Sheets не відповів за ${timeoutMs / 1000} секунд`);
        timeoutError.status = 504;
        timeoutError.code = "SHEETS_TIMEOUT";
        throw timeoutError;
      }
      throw err;
    }
  }

  let res;
  try {
    res = await sendWithReadableTimeout();
  } catch (err) {
    // Повтор після повного тайм-ауту читання створює ще одну довгу Apps Script
    // операцію. Мережеві збої та ідемпотентні записи повторювати безпечно.
    if (!retryableAction || (readAction && err && err.code === "SHEETS_TIMEOUT")) throw err;
    await new Promise((r) => setTimeout(r, retryableWrite ? 800 : 600));
    res = await sendWithReadableTimeout();
  }
  if (!res.ok && retryableAction) {
    await new Promise((r) => setTimeout(r, 600));
    res = await sendWithReadableTimeout();
  }

  let data = null;
  try {
    data = await res.json();
  } catch (_) {
    data = null;
  }

  if (!res.ok) {
    const err = new Error((data && data.message) || `Sheets HTTP ${res.status}`);
    err.status = 502;
    err.details = data;
    throw err;
  }

  if (!data || data.status === "error") {
    const err = new Error((data && data.message) || "Apps Script admin error");
    err.status = data && data.code === 401 ? 401 : 502;
    err.details = data;
    throw err;
  }

  return data;
}

function sendError(res, err) {
  const status = err.status || 500;
  return res.status(status).json({
    error: err.message || "Internal error",
    details: err.details || undefined,
  });
}

module.exports = { callAdminSheets, sendError };
