// Proxy helpers: Vercel admin APIs → Google Apps Script (admin_action + secret)

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

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body,
  });

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
