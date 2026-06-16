// api/alert.js — миттєві сповіщення власнику про проблеми з формою.
// Викликається клієнтом (sendBeacon/fetch) при: білому екрані, JS-помилці,
// невдалій відправці замовлення. Пересилає в Telegram.
// Канал незалежний від /api/order, тож працює навіть коли відправка падає.

// Best-effort троттл на інстанс: не частіше 1 повідомлення типу / 5 хв.
const rl = new Map();
function throttled(key, ms) {
  const now = Date.now();
  const last = rl.get(key) || 0;
  if (now - last < ms) return true;
  rl.set(key, now);
  return false;
}

function esc(s) {
  return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    let body = req.body;
    if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = {}; } }
    body = body || {};
    const type = String(body.type || "unknown").slice(0, 40);

    if (throttled("t_" + type, 5 * 60 * 1000)) return res.status(200).json({ ok: true, throttled: true });

    const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    const TG_CHAT = process.env.TELEGRAM_ALERT_CHAT_ID || process.env.TELEGRAM_CHAT_ID;
    if (!TG_TOKEN || !TG_CHAT) return res.status(200).json({ ok: false, reason: "no_tg" });

    const titles = {
      not_rendered: "🚨 <b>ФОРМА НЕ ВІДКРИВАЄТЬСЯ</b> (білий екран).\nКлієнти НЕ можуть оформити замовлення!",
      submit_failed: "🚨 <b>НЕ ВДАЛОСЬ НАДІСЛАТИ ЗАМОВЛЕННЯ</b>\nКлієнт намагався відправити, але не вийшло. Дані нижче — передзвони:",
      js_error: "⚠️ <b>Помилка в формі</b>",
      js_reject: "⚠️ <b>Помилка в формі</b> (promise)"
    };

    let text = (titles[type] || ("⚠️ <b>Проблема з формою</b> (" + esc(type) + ")")) + "\n";
    if (body.message) text += "\n" + esc(body.message);
    if (body.details) text += "\n<code>" + esc(String(body.details).slice(0, 1800)) + "</code>";
    if (body.url) text += "\n🔗 " + esc(body.url);
    if (body.ua) text += "\n📱 " + esc(String(body.ua).slice(0, 120));
    text += "\n🕐 " + new Date().toISOString();

    await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: TG_CHAT, text, parse_mode: "HTML", disable_web_page_preview: true })
    });
    return res.status(200).json({ ok: true });
  } catch (err) {
    return res.status(200).json({ ok: false, error: String(err) });
  }
};
