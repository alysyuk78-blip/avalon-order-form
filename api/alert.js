// api/alert.js — миттєві сповіщення власнику про проблеми з формою.
// Викликається клієнтом (sendBeacon/fetch) при: білому екрані, JS-помилці,
// невдалій відправці замовлення. Пересилає в Telegram з причиною + рекомендацією.
// Канал незалежний від /api/order, тож працює навіть коли відправка падає.

const VERCEL_PROJECT = "https://vercel.com/alysyuk78-blips-projects/avalon-order-form";

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

// Діагноз + що робити для кожного типу
const DIAG = {
  not_rendered: {
    title: "🚨 <b>ФОРМА НЕ ВІДКРИВАЄТЬСЯ</b> (білий екран).\nКлієнти НЕ можуть оформити замовлення!",
    cause: "Ймовірно, зовнішній CDN (React/Babel/Tailwind) віддав нову несумісну версію, або повний збій рендеру. Саме так було з Babel 8.",
    fix: "1) Відкрий сайт → F12 → вкладка Console — там буде помилка.\n2) Якщо згадує Babel/React/Tailwind — треба запінити версію CDN.\n3) Передай Claude текст помилки з консолі + це повідомлення."
  },
  submit_failed: {
    title: "🚨 <b>НЕ ВДАЛОСЬ НАДІСЛАТИ ЗАМОВЛЕННЯ</b>\nКлієнт намагався відправити, але не вийшло — дані нижче:",
    cause: "Функція /api/order недоступна, або впала інтеграція (Telegram/Sheets/Trello), або проблема з env-ключем.",
    fix: "1) Дані клієнта ⬇️ — ПЕРЕДЗВОНИ, щоб не втратити замовлення.\n2) Vercel → Logs → функція order: подивись помилку.\n3) Перевір env-ключі (TELEGRAM/SHEET/TRELLO)."
  },
  js_error: {
    title: "⚠️ <b>Помилка в формі</b>",
    cause: "Помилка в коді форми під час роботи.",
    fix: "Передай Claude текст помилки нижче — він виправить."
  },
  js_reject: {
    title: "⚠️ <b>Помилка в формі</b> (необроблений promise)",
    cause: "Помилка в коді форми (асинхронна).",
    fix: "Передай Claude текст помилки нижче."
  }
};

// Жива перевірка: які версії CDN зараз підключені (щоб одразу бачити причину білого екрана)
async function cdnList(host) {
  try {
    const r = await fetch("https://" + host + "/?cb=" + Date.now(), { method: "GET" });
    const html = await r.text();
    const m = html.match(/https?:\/\/(?:unpkg\.com|cdn\.jsdelivr\.net|cdn\.tailwindcss\.com)[^"'\s]*/g) || [];
    return [...new Set(m)].slice(0, 8).join("\n");
  } catch (e) { return ""; }
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

    const d = DIAG[type] || { title: "⚠️ <b>Проблема з формою</b> (" + esc(type) + ")", cause: "", fix: "Передай це повідомлення Claude." };

    let text = d.title + "\n";
    if (body.message) text += "\n" + esc(body.message);
    if (body.details) text += "\n<code>" + esc(String(body.details).slice(0, 1500)) + "</code>";
    if (d.cause) text += "\n\n🔎 <b>Ймовірна причина:</b> " + esc(d.cause);
    if (d.fix) text += "\n🛠 <b>Що зробити:</b>\n" + esc(d.fix);

    // Для білого екрана — додаємо живі версії CDN, щоб одразу видно винуватця
    if (type === "not_rendered") {
      const cdns = await cdnList(req.headers.host || "avalon-order-form.vercel.app");
      if (cdns) text += "\n\n📦 <b>Підключені CDN зараз:</b>\n<code>" + esc(cdns) + "</code>";
    }

    if (body.url) text += "\n\n🔗 Сторінка: " + esc(body.url);
    text += "\n🔧 Vercel: " + VERCEL_PROJECT;
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
