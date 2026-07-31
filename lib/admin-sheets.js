// Proxy helpers: Vercel admin APIs → Google Apps Script (admin_action + secret)

// Дії, що ЗМІНЮЮТЬ дані: їх не можна повторювати автоматично.
const WRITE_ACTIONS = new Set([
  "create_order", "update_order", "upsert_partner",
  "add_expense", "update_expense", "add_payout",
  "add_payment", "delete_payment",
]);

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

  // Apps Script інколи віддає 404/500 на протермінованому редиректі googleusercontent
  // (особливо коли кабінет робить кілька запитів разом). Один тихий повтор це прибирає,
  // АЛЕ лише для читань: запис міг уже виконатись у таблиці, і повтор створив би
  // другий платіж / друге замовлення (немає ключа ідемпотентності).
  async function send() {
    return fetch(url, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body,
    });
  }
  let res = await send();
  if (!res.ok && !WRITE_ACTIONS.has(action)) {
    await new Promise((r) => setTimeout(r, 600));
    res = await send();
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
