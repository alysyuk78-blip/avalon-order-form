const { checkPassword, issueToken, setAdminCors, handleOptions } = require("../../lib/admin-auth");

const loginAttempts = new Map();
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000;

function clientKey(req) {
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd.trim()) return fwd.split(",")[0].trim();
  return req.socket && req.socket.remoteAddress ? req.socket.remoteAddress : "unknown";
}

function isRateLimited(key) {
  const now = Date.now();
  const entry = loginAttempts.get(key);
  if (!entry || now - entry.start > WINDOW_MS) {
    loginAttempts.set(key, { start: now, count: 0 });
    return false;
  }
  return entry.count >= MAX_ATTEMPTS;
}

function recordFailedAttempt(key) {
  const now = Date.now();
  const entry = loginAttempts.get(key) || { start: now, count: 0 };
  if (now - entry.start > WINDOW_MS) {
    loginAttempts.set(key, { start: now, count: 1 });
    return;
  }
  entry.count += 1;
  loginAttempts.set(key, entry);
}

module.exports = async function handler(req, res) {
  setAdminCors(req, res);
  if (req.method === "OPTIONS") return handleOptions(req, res);
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  if (!process.env.ADMIN_PASSWORD) {
    return res.status(503).json({
      error: "ADMIN_PASSWORD is not configured. Add it in Vercel Environment Variables.",
    });
  }

  const password = req.body && req.body.password;
  const key = clientKey(req);
  if (isRateLimited(key)) {
    return res.status(429).json({ error: "Забагато спроб. Спробуйте через 15 хвилин." });
  }
  if (!checkPassword(password)) {
    recordFailedAttempt(key);
    return res.status(401).json({ error: "Невірний пароль" });
  }

  loginAttempts.delete(key);

  const token = issueToken();
  const maxAge = 12 * 60 * 60;
  const secure = process.env.NODE_ENV === "production" || process.env.VERCEL ? "; Secure" : "";
  res.setHeader(
    "Set-Cookie",
    `avalon_admin=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`
  );
  return res.status(200).json({ ok: true, token, expires_in: maxAge });
};
