// Shared auth helpers for /api/admin/*
// Token = base64url(payload).base64url(hmac), payload = { exp, iat }

const crypto = require("crypto");

const TOKEN_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours
// «Запамʼятати вхід» на своєму компʼютері: кабінет відкривається одразу, без пароля.
const REMEMBER_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function b64url(buf) {
  return Buffer.from(buf)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function fromB64url(str) {
  const pad = str.length % 4 === 0 ? "" : "=".repeat(4 - (str.length % 4));
  const b64 = str.replace(/-/g, "+").replace(/_/g, "/") + pad;
  return Buffer.from(b64, "base64");
}

function sessionSecret() {
  return process.env.ADMIN_SESSION_SECRET || process.env.ADMIN_PASSWORD || "";
}

function signToken(payload) {
  const secret = sessionSecret();
  if (!secret) throw new Error("ADMIN_PASSWORD is not configured");
  const body = b64url(JSON.stringify(payload));
  const sig = b64url(crypto.createHmac("sha256", secret).update(body).digest());
  return `${body}.${sig}`;
}

function verifyToken(token) {
  if (!token || typeof token !== "string" || !token.includes(".")) return null;
  const secret = sessionSecret();
  if (!secret) return null;
  const [body, sig] = token.split(".");
  const expected = b64url(crypto.createHmac("sha256", secret).update(body).digest());
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(fromB64url(body).toString("utf8"));
    if (!payload || !payload.exp || Date.now() > Number(payload.exp)) return null;
    // Вхід менеджера чинний, лише доки чинний САМЕ ТОЙ пароль менеджера, з яким він увійшов:
    // власник змінив або прибрав пароль — усі входи менеджера одразу перестають діяти.
    if (payload.role === "manager" && (!managerLoginEnabled() || payload.ms !== managerStamp())) return null;
    return payload;
  } catch (_) {
    return null;
  }
}

// ── Два входи в кабінет ──
//   • ADMIN_PASSWORD   — власник: усе, зокрема зміна ставок підрядника;
//   • MANAGER_PASSWORD — менеджер: приймає й веде замовлення; ставки бачить, але не змінює.
// Пароль менеджера власник задає сам у Vercel (Settings → Environment Variables). Немає його,
// він коротший за 8 символів або збігається з паролем власника — входу менеджера немає
// (однаковий пароль інакше тихо зробив би власника «менеджером» або менеджера — власником).
const MANAGER_PASSWORD_MIN = 8;

function samePassword(given, expected) {
  if (!expected || typeof given !== "string") return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  if (a.length !== b.length) {
    crypto.timingSafeEqual(Buffer.alloc(32), Buffer.alloc(32));
    return false;
  }
  return crypto.timingSafeEqual(a, b);
}

function managerPassword() {
  const value = process.env.MANAGER_PASSWORD || "";
  if (value.length < MANAGER_PASSWORD_MIN || value === (process.env.ADMIN_PASSWORD || "")) return "";
  return value;
}

function managerLoginEnabled() {
  return !!managerPassword() && !!sessionSecret();
}

// Відбиток чинного пароля менеджера — кладеться в його вхід (сам пароль з нього не відновити).
function managerStamp() {
  return crypto.createHmac("sha256", sessionSecret()).update("manager:" + managerPassword()).digest("hex").slice(0, 16);
}

/** Чий це пароль: "owner", "manager" або null. */
function roleForPassword(password) {
  if (samePassword(password, process.env.ADMIN_PASSWORD || "")) return "owner";
  if (managerLoginEnabled() && samePassword(password, managerPassword())) return "manager";
  return null;
}

function issueToken(remember, role) {
  const now = Date.now();
  const ttl = remember ? REMEMBER_TTL_MS : TOKEN_TTL_MS;
  if (role === "manager") return signToken({ iat: now, exp: now + ttl, role: "manager", ms: managerStamp() });
  return signToken({ iat: now, exp: now + ttl, role: "owner" });
}

function checkPassword(password) {
  return samePassword(password, process.env.ADMIN_PASSWORD || "");
}

function getBearerToken(req) {
  const h = req.headers?.authorization || req.headers?.Authorization || "";
  if (typeof h === "string" && h.toLowerCase().startsWith("bearer ")) {
    return h.slice(7).trim();
  }
  const cookie = req.headers?.cookie || "";
  const m = String(cookie).match(/(?:^|;\s*)avalon_admin=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : "";
}

function requireAdmin(req, res) {
  const token = getBearerToken(req);
  const payload = verifyToken(token);
  if (!payload) {
    res.status(401).json({ error: "Unauthorized" });
    return null;
  }
  return payload;
}

/** Лише власник (зміна ставок підрядника). Менеджерові — 403 зі зрозумілим поясненням. */
function requireOwner(req, res) {
  const payload = requireAdmin(req, res);
  if (!payload) return null;
  if (payload.role === "manager") {
    res.status(403).json({ error: "Це може зробити лише власник — увійдіть паролем власника", code: "OWNER_ONLY" });
    return null;
  }
  return payload;
}

/** Хто увійшов: "owner", "manager" або "" (входу немає). Старі входи без ролі — власник. */
function roleOf(req) {
  const payload = verifyToken(getBearerToken(req));
  if (!payload) return "";
  return payload.role === "manager" ? "manager" : "owner";
}

/** Чи запит прийшов із чинним входом — без відповіді 401 (для того, що видно й без входу). */
function isAdmin(req) {
  return !!verifyToken(getBearerToken(req));
}

// Калькулятор (окремий сайт) записує розрахунок у замовлення через це ж API — з тим
// самим паролем і токеном, що й кабінет; без токена доступу немає з будь-якої адреси.
const ALLOWED_ORIGINS = [
  "https://avalon-order-form.vercel.app",
  "https://avalon-calculator.vercel.app",
  "http://localhost:5173",
  "http://localhost:3000",
  "http://localhost:5500",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:5500",
];

function getCorsOrigin(req) {
  const origin = req.headers?.origin || "";
  for (const allowed of ALLOWED_ORIGINS) {
    if (origin === allowed) return allowed;
  }
  return ALLOWED_ORIGINS[0];
}

function setAdminCors(req, res) {
  const corsOrigin = getCorsOrigin(req);
  res.setHeader("Access-Control-Allow-Origin", corsOrigin);
  res.setHeader("Vary", "Origin");   // відповідь залежить від адреси, з якої прийшов запит
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
}

function handleOptions(req, res) {
  setAdminCors(req, res);
  return res.status(200).end();
}

module.exports = {
  checkPassword,
  issueToken,
  TOKEN_TTL_MS,
  REMEMBER_TTL_MS,
  requireAdmin,
  requireOwner,
  roleOf,
  roleForPassword,
  managerLoginEnabled,
  isAdmin,
  setAdminCors,
  handleOptions,
  TOKEN_TTL_MS,
};
