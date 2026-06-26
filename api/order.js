// api/order.js — Vercel Serverless Function
// Handles secure order submission: Telegram + Google Sheets
// API keys are stored as Vercel Environment Variables (not in client code)

const config = {
  api: {
    bodyParser: {
      sizeLimit: '5mb',
    },
  },
};

module.exports.config = config;

// ============================================================
// PRICE CALCULATOR (production price for internal use)
// ============================================================
const COMPLEX_PATTERNS = ["K3", "K4", "K6", "K8", "K9"];
const MARKUP = 1 / (1 - 0.2593); // ~1.3503 — та сама націнка, що у формі

function calcPriceForMessage(order) {
  // Єдине джерело правди — числа, пораховані формою. Якщо передані — беремо їх (форма = Telegram = Sheets).
  if (order.price_total != null) {
    return {
      areaM2: order.area_m2 != null ? Number(order.area_m2).toFixed(2) : "—",
      pricePerM2: order.price_per_m2 != null ? Math.round(Number(order.price_per_m2)) : null,
      total: Math.round(Number(order.price_total)),                                  // клієнтська ціна
      perUnit: order.price_per_unit != null ? Math.round(Number(order.price_per_unit)) : null,
      costTotal: order.cost_total != null ? Math.round(Number(order.cost_total)) : null,
      profit: order.profit != null ? Math.round(Number(order.profit)) : null,
    };
  }
  // Фолбек для старих замовлень (без переданих чисел): рахуємо клієнтську ціну тією ж формулою.
  const w = Number(order.size_w) || 0;
  const h = Number(order.size_h) || 0;
  const d = Number(order.size_d) || 0;
  const qty = Number(order.quantity) || 1;
  if (!w || !h) return null;
  const areaM2 = (w * h + 2 * d * h) / 1_000_000;
  let costPerM2 = order.construction_type?.toLowerCase().includes("розбірний") ? 2170 : 2030;
  let pricePerM2 = Math.round(costPerM2 * MARKUP);
  if (order.basket_type?.toLowerCase().includes("антивандал")) pricePerM2 = Math.round(pricePerM2 * 1.35);
  if (order.pattern && COMPLEX_PATTERNS.includes(order.pattern)) pricePerM2 = Math.round(pricePerM2 * 1.15);
  const perUnit = Math.round(areaM2 * pricePerM2);
  const total = perUnit * qty;
  const costTotal = Math.round(total / MARKUP);
  return { areaM2: areaM2.toFixed(2), pricePerM2, total, perUnit, costTotal, profit: total - costTotal };
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

// Дата/час у поясі Europe/Kyiv (сервер Vercel працює в UTC — не покладаємось на локаль).
function kyivParts(date) {
  const fmt = new Intl.DateTimeFormat("uk-UA", {
    timeZone: "Europe/Kyiv",
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
  const p = {};
  for (const part of fmt.formatToParts(date)) p[part.type] = part.value;
  return p; // { day, month, year, hour, minute }
}

// Формат «Чт 11.06.2026, 12:36», київський час.
function formatNow() {
  const now = new Date();
  const p = kyivParts(now);
  const days = { Sun: "Нд", Mon: "Пн", Tue: "Вт", Wed: "Ср", Thu: "Чт", Fri: "Пт", Sat: "Сб" };
  const en = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Kyiv", weekday: "short" }).format(now);
  const wd = days[en] || "";
  return `${wd} ${p.day}.${p.month}.${p.year}, ${p.hour}:${p.minute}`;
}

function generateOrderNumber() {
  const p = kyivParts(new Date());
  const yy = p.year.slice(-2);
  const xxx = String(Math.floor(Math.random() * 900) + 100);
  return `ORD-${p.day}${p.month}${yy}-${xxx}`;
}

// ============================================================
// TELEGRAM MESSAGE
// ============================================================
function formatTelegramMessage(order) {
  const e = (v) => escHtml(v);
  const num = (v) => Number(v || 0).toLocaleString("uk-UA");
  const items = (Array.isArray(order.items) && order.items.length) ? order.items : [{
    basket_type: order.basket_type, construction_type: order.construction_type,
    color: order.color, color_custom: order.color_custom, pattern: order.pattern, pattern_custom: order.pattern_custom,
    size_w: order.size_w, size_h: order.size_h, size_d: order.size_d, quantity: order.quantity,
    ac_brand: order.ac_brand, ac_model: order.ac_model,
    price_total: order.price_total, area_m2: order.area_m2, cost_total: order.cost_total,
  }];
  const multi = items.length > 1;

  // ── Заголовок ──
  let msg = `📌 <b>Замовлення №${e(order.order_number)}</b>\n`;
  msg += `🕐 ${formatNow()}\n`;

  // ── ЗАМОВНИК ──
  msg += `\n👤 <b>ЗАМОВНИК</b>\n`;
  msg += `${e(order.first_name)} ${e(order.last_name)}\n`;
  if (order.phone) msg += `📞 ${e(order.phone)}\n`;
  if (order.city) msg += `🏙 ${e(order.city)}\n`;

  // ── ВИРОБНИЦТВО (специфікація) ──
  msg += `\n🏭 <b>ВИРОБНИЦТВО</b>\n`;
  items.forEach((it, i) => {
    const color = it.color ? e(it.color) + (it.color_custom ? " (" + e(it.color_custom) + ")" : "") : "";
    const pattern = it.pattern ? e(it.pattern) + (it.pattern_custom ? " (" + e(it.pattern_custom) + ")" : "") : "";
    if (multi) msg += `\n🧺 <b>Кошик ${i + 1}</b>\n`;
    msg += `• Тип: <b>${e(it.basket_type)}</b>\n`;
    msg += `• Конструкція: <b>${e(it.construction_type)}</b>\n`;
    if (it.has_cover) msg += `• Верхня кришка: <b>Так</b>\n`;
    if (color) msg += `• Колір: <b>${color}</b>\n`;
    if (pattern) msg += `• Візерунок: <b>${pattern}</b>\n`;
    if (it.ac_brand || it.ac_model) msg += `• Кондиціонер: <b>${e([it.ac_brand, it.ac_model].filter(Boolean).join(" "))}</b>\n`;
    if (Number(it.size_w) > 0) {
      msg += `• Розміри (мм):\n   Висота — <b>${it.size_h}</b>\n   Ширина — <b>${it.size_w}</b>\n   Глибина — <b>${it.size_d}</b>\n`;
    } else {
      msg += `• Розміри: <i>розрахує менеджер</i>\n`;
    }
    msg += `• Кількість: <b>${Number(it.quantity) || 1} шт.</b>\n`;
  });

  // ── ФІНАНСИ (виробнича вартість + оплата) ──
  msg += `\n💰 <b>ФІНАНСИ</b>\n`;
  const perM2of = (it) => {
    const qty = Number(it.quantity) || 1, area = Number(it.area_m2) || 0, cost = Number(it.cost_total) || 0;
    return (area > 0 && qty > 0 && cost > 0) ? Math.round(cost / (area * qty)) : 0;
  };
  let grandCost = 0;
  if (multi) {
    items.forEach((it, i) => {
      const area = Number(it.area_m2) || 0, cost = Number(it.cost_total) || 0, p = perM2of(it);
      grandCost += cost;
      if (cost > 0) msg += `• Кошик ${i + 1}: ${area ? area.toFixed(2) + " м² × " + num(p) + " ₴ = " : ""}<b>${num(cost)} ₴</b>\n`;
    });
    if (grandCost > 0) msg += `• <b>Разом виробнича: ${num(grandCost)} ₴</b>\n`;
  } else {
    const it = items[0], area = Number(it.area_m2) || 0, cost = Number(it.cost_total) || 0, p = perM2of(it);
    if (area > 0) msg += `• Площа виробу: <b>${area.toFixed(2)}</b> м²\n`;
    if (p > 0) msg += `• Ціна за 1 м²: <b>${num(p)} ₴</b>\n`;
    if (cost > 0) msg += `• Вартість виробнича: <b>${num(cost)} ₴</b>\n`;
  }
  if (order.payment_method) msg += `• Оплата: <b>${e(order.payment_method)}</b>\n`;

  // ── ДОСТАВКА ──
  msg += `\n🚚 <b>ДОСТАВКА</b>\n`;
  const transport = order.transport === "Інше" ? (order.transport_custom || "") : order.transport;
  if (transport) msg += `• Спосіб: <b>${e(transport)}</b>\n`;
  if (order.delivery_address) msg += `• Адреса: ${e(order.delivery_address)}\n`;
  if (order.delivery_date) msg += `• Дата: <b>${formatDeliveryDate(order.delivery_date)}</b>\n`;
  if (order.notes) msg += `• Примітка: ${e(order.notes)}\n`;

  // ── Джерело (мета) ──
  msg += `\n🔖 Джерело заявки: ${e(order.referral_source || "direct")}\n`;
  return msg;
}

// ============================================================
// PRODUCTION MESSAGE (чисте, для пересилання підряднику)
// ============================================================
function formatProductionMessage(order) {
  const e = (v) => escHtml(v);
  const items = (Array.isArray(order.items) && order.items.length) ? order.items : [{
    basket_type: order.basket_type, construction_type: order.construction_type,
    color: order.color, color_custom: order.color_custom, pattern: order.pattern, pattern_custom: order.pattern_custom,
    size_w: order.size_w, size_h: order.size_h, size_d: order.size_d, quantity: order.quantity,
    ac_brand: order.ac_brand, ac_model: order.ac_model,
  }];
  let msg = `🏭 <b>ДЛЯ ВИРОБНИЦТВА</b> · ${e(order.order_number)}\n`;
  items.forEach((it, i) => {
    const constr = (it.construction_type || "").split("(")[0].trim() || it.construction_type || "";
    const color = (it.color === "Інші кольори" || it.color === "Інший") ? (it.color_custom || it.color) : it.color;
    const pattern = it.pattern === "Інший" ? (it.pattern_custom || it.pattern) : it.pattern;
    const size = Number(it.size_w) > 0
      ? `${it.size_w}×${it.size_h}×${it.size_d} мм (Ш×В×Г)`
      : `⚠️ розмір визначити${(it.ac_brand || it.ac_model) ? " — " + e([it.ac_brand, it.ac_model].filter(Boolean).join(" ")) : ""}`;
    msg += `\n${i + 1}. <b>${size}</b>\n   ${e(constr)}, ${e(color)}, візерунок ${e(pattern)}${it.has_cover ? ", <b>з верхньою кришкою</b>" : ""}, <b>${it.quantity} шт.</b>\n`;
  });
  return msg;
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

module.exports = async function handler(req, res) {
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

    // Read secrets from environment variables
    const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    const TG_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
    const SHEETS_URL = process.env.GOOGLE_SHEET_URL;

    const results = [];

    // --- Google Sheets (першим: Apps Script присвоює послідовний № ORD-ДДММРР-NNN і повертає його) ---
    let orderNumber = null;
    if (SHEETS_URL) {
      try {
        const shRes = await fetch(SHEETS_URL, {
          method: "POST",
          headers: { "Content-Type": "text/plain" },
          body: JSON.stringify({ timestamp: new Date().toISOString(), ...order }),
        });
        const shData = await shRes.json().catch(() => null);
        if (shData && shData.order_number) orderNumber = shData.order_number;
        results.push("gs:ok");
      } catch (err) {
        console.error("Google Sheets error:", err);
        results.push("gs:err");
      }
    }
    // Фолбек: Sheets не налаштовано/недоступний → локальний номер (без гарантії послідовності).
    if (!orderNumber) orderNumber = generateOrderNumber();
    const orderWithNumber = { ...order, order_number: orderNumber };

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

    if (results.includes("tg:ok") || results.includes("gs:ok")) {
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
