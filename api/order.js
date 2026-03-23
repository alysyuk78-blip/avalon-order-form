// api/order.js — Vercel Serverless Function
// Handles secure order submission: Telegram + Google Sheets + Trello
// API keys are stored as Vercel Environment Variables (not in client code)

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '5mb',
    },
  },
};

// ============================================================
// PRICE CALCULATOR (production price for internal use)
// ============================================================
const PRODUCTION_PRICE_PER_M2 = 1920;
const COMPLEX_PATTERNS = ["K3", "K4", "K6", "K8", "K9"];

function calcPriceForMessage(order) {
  const w = Number(order.size_w) || 0;
  const h = Number(order.size_h) || 0;
  const d = Number(order.size_d) || 0;
  const qty = Number(order.quantity) || 1;
  if (!w || !h) return null;
  const areaMm2 = w * h + 2 * d * h;
  const areaM2 = areaMm2 / 1_000_000;
  let pricePerM2 = PRODUCTION_PRICE_PER_M2;
  if (order.basket_type?.toLowerCase().includes("антивандал")) pricePerM2 *= 1.35;
  if (order.construction_type?.toLowerCase().includes("розбірний")) pricePerM2 *= 1.1;
  if (order.pattern && COMPLEX_PATTERNS.includes(order.pattern)) pricePerM2 *= 1.15;
  const perUnit = Math.round(areaM2 * pricePerM2);
  const total = perUnit * qty;
  return { areaM2: areaM2.toFixed(2), pricePerM2: Math.round(pricePerM2), total, perUnit };
}

// ============================================================
// FORMAT HELPERS
// ============================================================
function escHtml(s) {
  return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function formatDeliveryDate(dateStr) {
  if (!dateStr) return "—";
  const d = new Date(dateStr);
  return d.toLocaleDateString("uk-UA", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function formatNow() {
  const now = new Date();
  const days = ["Нд", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];
  const dd = String(now.getDate()).padStart(2, "0");
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const yyyy = now.getFullYear();
  const hh = String(now.getHours()).padStart(2, "0");
  const min = String(now.getMinutes()).padStart(2, "0");
  return `${days[now.getDay()]} ${dd}.${mm}.${yyyy}, ${hh}:${min}`;
}

function generateOrderNumber() {
  const now = new Date();
  const dd = String(now.getDate()).padStart(2, "0");
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const yy = String(now.getFullYear()).slice(-2);
  const xxx = String(Math.floor(Math.random() * 900) + 100);
  return `ORD-${dd}${mm}${yy}-${xxx}`;
}

// ============================================================
// TELEGRAM MESSAGE
// ============================================================
function formatTelegramMessage(order) {
  const e = (v) => escHtml(v);
  const price = calcPriceForMessage(order);
  const basketType = order.basket_type?.includes("Антивандальний") ? "Антивандальний" : order.basket_type;

  let msg = `📌 <b>Замовлення №${order.order_number}</b>\n`;
  msg += `🕐 ${formatNow()}\n`;
  msg += `👤 ${e(order.first_name)} ${e(order.last_name)}\n`;
  msg += `📞 ${e(order.phone)}\n`;
  if (order.city) msg += `🏙 ${e(order.city)}\n`;
  msg += `\n`;
  msg += `• Тип: <b>${e(basketType)}</b>\n`;
  msg += `• Вид конструкції: <b>${e(order.construction_type)}</b>\n`;
  if (order.color) msg += `• Колір: <b>${e(order.color)}${order.color_custom ? " (" + e(order.color_custom) + ")" : ""}</b>\n`;
  if (order.pattern) msg += `• Візерунок: <b>${e(order.pattern)}${order.pattern_custom ? " (" + e(order.pattern_custom) + ")" : ""}</b>\n`;
  msg += `• Розміри:\n`;
  msg += `   Висота — H: <b>${order.size_h}</b> мм\n`;
  msg += `   Ширина — W: <b>${order.size_w}</b> мм\n`;
  msg += `   Глибина — D: <b>${order.size_d}</b> мм\n`;
  msg += `• Кількість: <b>${order.quantity} шт.</b>\n`;
  if (price) {
    msg += `• Площа виробу: <b>${price.areaM2} м²</b>\n`;
    msg += `• Ціна за 1 м²: <b>${price.pricePerM2.toLocaleString("uk-UA")} ₴</b>\n`;
    msg += `• Вартість виробнича: <b>${price.total.toLocaleString("uk-UA")} ₴</b>\n`;
  }
  const transport = order.transport === "Інше" ? order.transport_custom : order.transport;
  if (transport) msg += `• Доставка: ${e(transport)}\n`;
  if (order.delivery_address) msg += `• Адреса: ${e(order.delivery_address)}\n`;
  if (order.delivery_date) msg += `• Дата доставки: <b>${formatDeliveryDate(order.delivery_date)}</b>\n`;
  msg += `• Оплата: <i>${e(order.payment_method)}</i>\n`;
  if (order.how_found) msg += `• Як дізнались: ${e(order.how_found)}${order.how_found === "Інше" ? " (" + e(order.how_found_custom) + ")" : ""}\n`;
  if (order.notes) msg += `• Дод. інформація: <b>${e(order.notes)}</b>\n`;
  return msg;
}

// ============================================================
// TRELLO DESCRIPTION
// ============================================================
function formatTrelloDescription(order, price) {
  let d = `**Клієнт:** ${order.first_name} ${order.last_name}\n`;
  d += `**Телефон:** ${order.phone}\n`;
  if (order.city) d += `**Місто:** ${order.city}\n\n`;
  d += `**Тип:** ${order.basket_type}\n`;
  d += `**Конструкція:** ${order.construction_type}\n`;
  d += `**Колір:** ${order.color}${order.color_custom ? " (" + order.color_custom + ")" : ""}\n`;
  d += `**Візерунок:** ${order.pattern}${order.pattern_custom ? " (" + order.pattern_custom + ")" : ""}\n`;
  d += `**Розміри:** W=${order.size_w}, H=${order.size_h}, D=${order.size_d} мм\n`;
  d += `**Кількість:** ${order.quantity} шт.\n`;
  if (price) d += `**Вартість:** ${price.total.toLocaleString("uk-UA")} ₴\n`;
  d += `\n**Доставка:** ${order.transport}${order.transport_custom ? " (" + order.transport_custom + ")" : ""}\n`;
  if (order.delivery_address) d += `**Адреса:** ${order.delivery_address}\n`;
  if (order.delivery_date) d += `**Дата доставки:** ${formatDeliveryDate(order.delivery_date)}\n`;
  d += `**Оплата:** ${order.payment_method}\n`;
  if (order.notes) d += `\n**Примітки:** ${order.notes}\n`;
  return d;
}

// ============================================================
// MAIN HANDLER
// ============================================================

// Simple in-memory rate limiter (per Vercel instance)
const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX = 5; // max 5 orders per minute per IP

function isRateLimited(ip) {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now - entry.start > RATE_LIMIT_WINDOW) {
    rateLimitMap.set(ip, { start: now, count: 1 });
    return false;
  }
  entry.count++;
  if (entry.count > RATE_LIMIT_MAX) return true;
  return false;
}

// Allowed origins (update with your actual domain)
const ALLOWED_ORIGINS = [
  "https://avalon-order-form.vercel.app",
  "http://localhost:3000",
  "http://localhost:5500",
];

function getCorsOrigin(req) {
  const origin = req.headers?.origin || req.headers?.referer || "";
  for (const allowed of ALLOWED_ORIGINS) {
    if (origin.startsWith(allowed)) return allowed;
  }
  // In production, return the first allowed origin (Vercel same-origin requests may not have origin header)
  return ALLOWED_ORIGINS[0];
}

export default async function handler(req, res) {
  // CORS headers — restrict to known origins
  const corsOrigin = getCorsOrigin(req);
  res.setHeader("Access-Control-Allow-Origin", corsOrigin);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Rate limiting
  const clientIp = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket?.remoteAddress || "unknown";
  if (isRateLimited(clientIp)) {
    return res.status(429).json({ error: "Too many requests. Please wait a moment." });
  }

  try {
    const order = req.body;
    if (!order || !order.first_name || !order.phone) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    // Basic honeypot check — if hidden field is filled, likely a bot
    if (order._hp_field) {
      return res.status(200).json({ ok: true, order_number: "BOT-DETECTED" });
    }

    // Generate order number
    const orderNumber = generateOrderNumber();
    const orderWithNumber = { ...order, order_number: orderNumber };

    // Read secrets from environment variables
    const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    const TG_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
    const SHEETS_URL = process.env.GOOGLE_SHEET_URL;
    const TRELLO_KEY = process.env.TRELLO_API_KEY;
    const TRELLO_TOKEN = process.env.TRELLO_TOKEN;
    const TRELLO_LIST = process.env.TRELLO_LIST_ID;

    const results = [];

    // --- Telegram ---
    if (TG_TOKEN && TG_CHAT_ID) {
      try {
        const text = formatTelegramMessage(orderWithNumber);
        const tgRes = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: TG_CHAT_ID, text, parse_mode: "HTML" }),
        });
        const tgData = await tgRes.json();
        results.push(tgData.ok ? "tg:ok" : "tg:err");
      } catch (err) {
        console.error("Telegram error:", err);
        results.push("tg:err");
      }
    }

    // --- Google Sheets ---
    if (SHEETS_URL) {
      try {
        await fetch(SHEETS_URL, {
          method: "POST",
          headers: { "Content-Type": "text/plain" },
          body: JSON.stringify({ timestamp: new Date().toISOString(), ...orderWithNumber }),
        });
        results.push("gs:ok");
      } catch (err) {
        console.error("Google Sheets error:", err);
        results.push("gs:err");
      }
    }

    // --- Trello ---
    if (TRELLO_KEY && TRELLO_TOKEN && TRELLO_LIST) {
      try {
        const price = calcPriceForMessage(order);
        const name = `${orderNumber} — ${order.first_name} ${order.last_name} — ${order.quantity} шт.`;
        const desc = formatTrelloDescription(orderWithNumber, price);
        await fetch(`https://api.trello.com/1/cards?key=${TRELLO_KEY}&token=${TRELLO_TOKEN}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ idList: TRELLO_LIST, name, desc }),
        });
        results.push("trello:ok");
      } catch (err) {
        console.error("Trello error:", err);
        results.push("trello:err");
      }
    }

    if (results.includes("tg:ok") || results.includes("gs:ok") || results.includes("trello:ok")) {
      return res.status(200).json({ ok: true, order_number: orderNumber, results });
    }

    if (results.length === 0) {
      return res.status(500).json({ error: "No integrations configured. Set environment variables." });
    }

    return res.status(500).json({ error: "All integrations failed", results });
  } catch (err) {
    console.error("Handler error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
