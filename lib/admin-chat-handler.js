// Чати з клієнтами через бота Telegram Business. Підключається з api/admin/order.js за
// параметром resource=chat — окремий файл в api/ перевищив би ліміт Vercel Hobby (12 функцій).
//
// Бот — ОКРЕМИЙ, новий (власник створює його в @BotFather і вмикає Business Mode); його токен
// власник сам вносить у Vercel: TELEGRAM_BUSINESS_BOT_TOKEN. Бот заявок (@avalon_order_bot,
// вебхук Make.com) тут не використовується й не чіпається: кнопка «Підключити» відмовиться
// ставити вебхук на бота, в якого вже є чужий вебхук.
//
//   POST ?resource=chat&hook=telegram — Telegram надсилає оновлення (без входу, але з
//        секретним заголовком, який знає лише Telegram: виводиться з токена бота);
//   GET  view=list | messages | status | file — переписка для кабінету (вхід обовʼязковий);
//   POST action=send | link — відповісти клієнту, привʼязати чат до замовлення;
//   POST action=setup | forget — підключити вебхук, прибрати чат із CRM: ЛИШЕ ВЛАСНИК.
const crypto = require("crypto");
const { requireAdmin, requireOwner, setAdminCors, handleOptions } = require("./admin-auth");
const { callAdminSheets, sendError } = require("./admin-sheets");

const TOKEN_ENV = "TELEGRAM_BUSINESS_BOT_TOKEN";
const PROD_ORIGIN = "https://avalon-order-form.vercel.app";
const HOOK_PATH = "/api/admin/order?resource=chat&hook=telegram";
const ALLOWED_UPDATES = ["business_connection", "business_message", "edited_business_message", "deleted_business_messages"];
const TEXT_MAX = 4096;               // ліміт Telegram на одне повідомлення
const FILE_MAX_BYTES = 4 * 1024 * 1024;   // відповідь функції Vercel — до 4,5 МБ
const CHAT_ID_RE = /^-?\d{1,20}$/;
const ORDER_RE = /^[A-Za-zА-Яа-яІіЇїЄєҐґ0-9_\-]{3,40}$/;

function botToken() {
  return String(process.env[TOKEN_ENV] || "").trim();
}
/** Секрет вебхука: Telegram повертає його в заголовку, а сторонній запит його не знає. */
function webhookSecret(token) {
  return crypto.createHmac("sha256", token).update("avalon-business-webhook-v1").digest("hex");
}
function sameSecret(given, expected) {
  const a = Buffer.from(String(given || ""));
  const b = Buffer.from(String(expected || ""));
  if (!b.length || a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
function hookUrl() {
  return PROD_ORIGIN + HOOK_PATH;
}

async function tg(token, method, payload, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload || {}),
      signal: controller.signal,
    });
    const data = await res.json().catch(() => ({}));
    return data && typeof data === "object" ? data : { ok: false };
  } catch (err) {
    return { ok: false, description: err && err.name === "AbortError" ? "Telegram не відповів" : "Немає звʼязку з Telegram" };
  } finally {
    clearTimeout(timer);
  }
}

function fail(status, message, code) {
  const err = new Error(message);
  err.status = status;
  if (code) err.code = code;
  return err;
}

/** Зрозуміле пояснення, чому Telegram не прийняв відповідь. */
function sendErrorText(description) {
  const d = String(description || "");
  if (/BUSINESS_PEER_USAGE_MISSING|BUSINESS_PEER_INVALID|24 hours|not allowed to send|PEER_ID_INVALID|chat not found/i.test(d)) {
    return "Telegram дозволяє відповідати з кабінету лише протягом 24 годин після останнього повідомлення клієнта"
      + " — напишіть йому з Telegram на телефоні";
  }
  if (/BUSINESS_CONNECTION_INVALID|business connection|BOT_BUSINESS_MISSING|rights/i.test(d)) {
    return "Бот не має права відповідати від цього акаунта — у Telegram: Налаштування → Telegram для бізнесу"
      + " → Чат-боти → увімкніть «Відповідати на повідомлення»";
  }
  return "Telegram не прийняв повідомлення: " + (d || "невідома помилка");
}

// Лише потрібне з оновлення: менше даних іде в скрипт таблиці.
function pickUpdate(body) {
  const out = {};
  ALLOWED_UPDATES.forEach((key) => { if (body && body[key]) out[key] = body[key]; });
  return Object.keys(out).length ? out : null;
}

async function handleHook(req, res) {
  const token = botToken();
  if (!token) return res.status(404).json({ error: "Not found" });
  const given = req.headers && (req.headers["x-telegram-bot-api-secret-token"] || req.headers["X-Telegram-Bot-Api-Secret-Token"]);
  if (!sameSecret(given, webhookSecret(token))) return res.status(401).json({ error: "Unauthorized" });
  const update = pickUpdate(req.body || {});
  if (!update) return res.status(200).json({ ok: true, skipped: true });
  try {
    await callAdminSheets("chat_ingest", { update });
    return res.status(200).json({ ok: true });
  } catch (err) {
    // Помилка — Telegram повторить доставку пізніше; дубль скрипт упізнає за ключем.
    console.error("chat hook:", err && err.message);
    return res.status(500).json({ ok: false });
  }
}

async function botStatus() {
  const token = botToken();
  if (!token) return { configured: false };
  const [me, info] = await Promise.all([tg(token, "getMe", {}), tg(token, "getWebhookInfo", {})]);
  const hook = (info && info.result) || {};
  return {
    configured: true,
    bot: me && me.ok ? { username: me.result.username || "", name: me.result.first_name || "", business: !!me.result.can_connect_to_business } : null,
    bot_error: me && me.ok ? "" : String((me && me.description) || "Токен не підходить"),
    webhook_ok: hook.url === hookUrl(),
    webhook_foreign: !!hook.url && hook.url !== hookUrl(),
    pending: Number(hook.pending_update_count || 0),
    last_error: hook.last_error_message ? String(hook.last_error_message) : "",
    last_error_at: hook.last_error_date ? new Date(hook.last_error_date * 1000).toISOString() : "",
  };
}

async function setupWebhook() {
  const token = botToken();
  if (!token) throw fail(400, "У Vercel ще немає токена бота (TELEGRAM_BUSINESS_BOT_TOKEN)", "NO_TOKEN");
  if (token === String(process.env.TELEGRAM_BOT_TOKEN || "").trim()) {
    throw fail(409, "Це токен бота заявок — для чатів потрібен окремий, новий бот", "SAME_BOT");
  }
  const info = await tg(token, "getWebhookInfo", {});
  if (!info.ok) throw fail(502, "Telegram не прийняв токен: " + (info.description || "невідома помилка"), "BAD_TOKEN");
  const current = String((info.result && info.result.url) || "");
  if (current && current !== hookUrl()) {
    // Чужий вебхук (наприклад, Make.com) не перезаписуємо: інакше той сценарій зупиниться.
    throw fail(409, "У цього бота вже є інше підключення (" + current.split("/")[2] + ") — для чатів потрібен окремий, новий бот", "FOREIGN_WEBHOOK");
  }
  const set = await tg(token, "setWebhook", {
    url: hookUrl(),
    secret_token: webhookSecret(token),
    allowed_updates: ALLOWED_UPDATES,
    max_connections: 4,
  });
  if (!set.ok) throw fail(502, "Telegram не підключив бота: " + (set.description || "невідома помилка"), "SETUP_FAILED");
  return botStatus();
}

async function sendFile(req, res) {
  const token = botToken();
  if (!token) throw fail(404, "Бот чатів не налаштований");
  const fileId = String((req.query && req.query.file_id) || "").trim();
  if (!/^[A-Za-z0-9_\-]{10,200}$/.test(fileId)) throw fail(400, "Не вказано файл");
  const meta = await tg(token, "getFile", { file_id: fileId });
  if (!meta.ok || !meta.result || !meta.result.file_path) throw fail(404, "Telegram не віддав файл: " + (meta.description || ""));
  if (Number(meta.result.file_size || 0) > FILE_MAX_BYTES) throw fail(413, "Файл завеликий для кабінету — відкрийте його в Telegram", "TOO_LARGE");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const file = await fetch(`https://api.telegram.org/file/bot${token}/${meta.result.file_path}`, { signal: controller.signal });
    if (!file.ok) throw fail(502, "Telegram не віддав файл");
    const buf = Buffer.from(await file.arrayBuffer());
    if (buf.length > FILE_MAX_BYTES) throw fail(413, "Файл завеликий для кабінету — відкрийте його в Telegram", "TOO_LARGE");
    const type = /\.(jpe?g)$/i.test(meta.result.file_path) ? "image/jpeg"
      : /\.png$/i.test(meta.result.file_path) ? "image/png"
      : /\.webp$/i.test(meta.result.file_path) ? "image/webp"
      : /\.pdf$/i.test(meta.result.file_path) ? "application/pdf"
      : "application/octet-stream";
    res.setHeader("Content-Type", type);
    res.setHeader("Cache-Control", "private, max-age=86400");
    return res.status(200).send(buf);
  } finally {
    clearTimeout(timer);
  }
}

async function sendText(body) {
  const token = botToken();
  if (!token) throw fail(400, "Бот чатів ще не налаштований — див. «Інструкція → Чати»", "NO_TOKEN");
  const chatId = String(body.chat_id || "").trim();
  const connectionId = String(body.connection_id || "").trim();
  const text = String(body.text || "").trim();
  if (!CHAT_ID_RE.test(chatId)) throw fail(400, "Не вказано чат");
  if (!connectionId || connectionId.length > 200) throw fail(400, "Невідомо, з якого акаунта відповідати — дочекайтесь повідомлення клієнта");
  if (!text) throw fail(400, "Порожнє повідомлення");
  if (text.length > TEXT_MAX) throw fail(400, `Задовге повідомлення — до ${TEXT_MAX} символів`);
  const sent = await tg(token, "sendMessage", { business_connection_id: connectionId, chat_id: Number(chatId), text });
  if (!sent.ok) throw fail(409, sendErrorText(sent.description), "SEND_FAILED");
  // Записуємо в таблицю. Не вийшло — повідомлення все одно пішло клієнту: кажемо про це.
  try {
    await callAdminSheets("chat_log_out", { message: sent.result });
    return { status: "ok", message_id: sent.result.message_id, logged: true };
  } catch (err) {
    console.error("chat log:", err && err.message);
    return { status: "ok", message_id: sent.result.message_id, logged: false };
  }
}

module.exports = async function chatHandler(req, res) {
  if (req.method === "POST" && req.query && req.query.hook === "telegram") return handleHook(req, res);

  setAdminCors(req, res);
  if (req.method === "OPTIONS") return handleOptions(req, res);

  try {
    if (req.method === "GET") {
      const view = String((req.query && req.query.view) || "list");
      if (view === "status") {
        if (!requireOwner(req, res)) return;
        const [bot, sheet] = await Promise.all([
          botStatus(),
          callAdminSheets("chat_status", {}).catch((err) => ({ error: err.message })),
        ]);
        return res.status(200).json({
          status: "ok", bot, hook_url: hookUrl(),
          connections: sheet.connections || {}, messages: Number(sheet.messages || 0),
          last_at: sheet.last_at || "", sheet_error: sheet.error || "",
        });
      }
      if (!requireAdmin(req, res)) return;
      // Бот ще не підключений — скрипт таблиці не смикаємо (кабінет питає щохвилини).
      if (!botToken() && (view === "list" || view === "messages")) {
        return res.status(200).json({ status: "ok", configured: false, chats: [], messages: [], connections: {} });
      }
      if (view === "file") return await sendFile(req, res);
      if (view === "messages") {
        const chatId = String((req.query && req.query.chat_id) || "").trim();
        const orderNumber = String((req.query && req.query.order_number) || "").trim();
        if (chatId && !CHAT_ID_RE.test(chatId)) return res.status(400).json({ error: "Не вказано чат" });
        if (!chatId && !ORDER_RE.test(orderNumber)) return res.status(400).json({ error: "Не вказано чат чи замовлення" });
        const data = await callAdminSheets("chat_messages", chatId ? { chat_id: chatId } : { order_number: orderNumber });
        return res.status(200).json({ ...data, configured: !!botToken() });
      }
      const data = await callAdminSheets("chat_list", {});
      return res.status(200).json({ ...data, configured: !!botToken() });
    }

    if (req.method === "POST") {
      const body = req.body || {};
      const action = String(body.action || "");
      if (action === "setup" || action === "forget") {
        if (!requireOwner(req, res)) return;
        if (action === "setup") return res.status(200).json({ status: "ok", bot: await setupWebhook() });
        const chatId = String(body.chat_id || "").trim();
        if (!CHAT_ID_RE.test(chatId)) return res.status(400).json({ error: "Не вказано чат" });
        return res.status(200).json(await callAdminSheets("chat_forget", { chat_id: chatId }));
      }
      if (!requireAdmin(req, res)) return;
      if (action === "send") return res.status(200).json(await sendText(body));
      if (action === "link") {
        const chatId = String(body.chat_id || "").trim();
        const orderNumber = String(body.order_number || "").trim();
        if (!CHAT_ID_RE.test(chatId)) return res.status(400).json({ error: "Не вказано чат" });
        if (!ORDER_RE.test(orderNumber)) return res.status(400).json({ error: "Не вказано замовлення" });
        return res.status(200).json(await callAdminSheets("chat_link", {
          chat_id: chatId, order_number: orderNumber, ...(body.remove === true ? { remove: true } : {}),
        }));
      }
      return res.status(400).json({ error: "Невідома дія" });
    }
    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.error("admin/chat:", err && err.message);
    return sendError(res, err);
  }
};
module.exports.webhookSecret = webhookSecret;
module.exports.sendErrorText = sendErrorText;
module.exports.hookUrl = hookUrl;
module.exports.ALLOWED_UPDATES = ALLOWED_UPDATES;
