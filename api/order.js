// api/order.js — Vercel Serverless Function
// Handles secure order submission: Telegram + Google Sheets
// API keys are stored as Vercel Environment Variables (not in client code)

const { randomUUID } = require("crypto");

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
const COVER_COST_PER_M2 = 1920;

function productionBreakdown(it) {
  const qty = Number(it.quantity) || 1;
  const w = Number(it.size_w) || 0, h = Number(it.size_h) || 0, d = Number(it.size_d) || 0;
  const hasCover = Boolean(it.has_cover) || String(it.construction_type || "").toLowerCase().includes("кришка");
  const basketArea = Number(it.basket_area_m2) || ((w && h) ? (w * h + 2 * d * h) / 1_000_000 : 0);
  const coverArea = hasCover ? (Number(it.cover_area_m2) || ((w && d) ? w * d / 1_000_000 : 0)) : 0;
  let basketRate = Number(it.basket_cost_per_m2) || (String(it.construction_type || "").toLowerCase().includes("розбірний") ? 2170 : 2030);
  if (!Number(it.basket_cost_per_m2) && String(it.basket_type || "").toLowerCase().includes("антивандал")) basketRate = Math.round(basketRate * 1.35);
  if (!Number(it.basket_cost_per_m2) && COMPLEX_PATTERNS.includes(it.pattern)) basketRate = Math.round(basketRate * 1.15);
  const coverRate = Number(it.cover_cost_per_m2) || COVER_COST_PER_M2;
  const basketCost = Number(it.basket_cost_total) || Math.round(basketArea * basketRate * qty);
  const coverCost = hasCover ? (Number(it.cover_cost_total) || Math.round(coverArea * coverRate * qty)) : 0;
  return { hasCover, basketArea, coverArea, basketRate, coverRate, basketCost, coverCost, total: basketCost + coverCost };
}

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

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function getPatternFile(order) {
  const file = order && order.pattern_file;
  if (!file || !file.data || !file.name) return null;
  const size = Number(file.size) || 0;
  if (size > 4 * 1024 * 1024) return null;
  return {
    name: String(file.name).replace(/[^\w.\- а-яА-ЯіїєґІЇЄҐ]/g, "_").slice(0, 120) || "pattern-file",
    type: String(file.type || "application/octet-stream").slice(0, 120),
    size,
    data: String(file.data),
  };
}

async function sendPatternFileToTelegram(token, chatId, order) {
  const file = getPatternFile(order);
  if (!file) return null;
  const bytes = Buffer.from(file.data, "base64");
  if (!bytes.length || bytes.length > 4 * 1024 * 1024) return null;

  const fd = new FormData();
  fd.append("chat_id", chatId);
  fd.append("document", new Blob([bytes], { type: file.type }), file.name);
  fd.append("caption", `📎 Файл візерунку до замовлення №${order.order_number || "—"}`);

  const res = await fetchWithTimeout(`https://api.telegram.org/bot${token}/sendDocument`, {
    method: "POST",
    body: fd,
  }, 15000);
  return await res.json().catch(() => null);
}

// ============================================================
// TELEGRAM MESSAGE
// ============================================================
function getCustomerContact(order) {
  const allowed = ["phone", "telegram", "viber", "whatsapp", "email"];
  const method = allowed.includes(order?.contact_method) ? order.contact_method : "phone";
  const labels = { phone: "Телефон", telegram: "Telegram", viber: "Viber", whatsapp: "WhatsApp", email: "E-mail" };
  const value = method === "telegram" ? order?.contact_telegram : method === "email" ? order?.contact_email : order?.phone;
  return { method, label: labels[method], value: String(value || "").trim() };
}

function formatTelegramMessage(order) {
  const e = (v) => escHtml(v);
  const num = (v) => Number(v || 0).toLocaleString("uk-UA");
  const contact = getCustomerContact(order);
  const items = (Array.isArray(order.items) && order.items.length) ? order.items : [{
    basket_model: order.basket_model, basket_model_name: order.basket_model_name,
    product_type: order.product_type, bracket_length: order.bracket_length, vibro_pads: order.vibro_pads,
    basket_type: order.basket_type, construction_type: order.construction_type,
    color: order.color, color_custom: order.color_custom, pattern: order.pattern, pattern_custom: order.pattern_custom,
    size_w: order.size_w, size_h: order.size_h, size_d: order.size_d, quantity: order.quantity,
    ac_brand: order.ac_brand, ac_model: order.ac_model, ac_model_url: order.ac_model_url,
    bracket_model_from: order.bracket_model_from, bracket_model_to: order.bracket_model_to, model_comment: order.model_comment,
    price_total: order.price_total, area_m2: order.area_m2, cost_total: order.cost_total,
    has_cover: order.has_cover, basket_area_m2: order.basket_area_m2, cover_area_m2: order.cover_area_m2,
    basket_cost_per_m2: order.basket_cost_per_m2, cover_cost_per_m2: order.cover_cost_per_m2,
    basket_cost_total: order.basket_cost_total, cover_cost_total: order.cover_cost_total,
  }];
  const multi = items.length > 1;

  // ── Заголовок ──
  let msg = `📌 <b>Замовлення №${e(order.order_number)}</b>\n`;
  msg += `🕐 ${formatNow()}\n`;

  // ── ЗАМОВНИК ──
  msg += `\n👤 <b>ЗАМОВНИК</b>\n`;
  msg += `${e(order.first_name)} ${e(order.last_name)}\n`;
  if (contact.value) msg += `${contact.method === "phone" ? "📞" : "💬"} ${e(contact.label)}: ${e(contact.method === "telegram" ? "@" + contact.value.replace(/^@/, "") : contact.value)}\n`;
  if (order.phone && ["telegram", "email"].includes(contact.method)) msg += `📞 Телефон: ${e(order.phone)}\n`;
  if (order.city) msg += `🏙 ${e(order.city)}\n`;

  // ── ВИРОБНИЦТВО (специфікація) ──
  msg += `\n🏭 <b>ВИРОБНИЦТВО</b>\n`;
  items.forEach((it, i) => {
    const color = it.color ? e(it.color) + (it.color_custom ? " (" + e(it.color_custom) + ")" : "") : "";
    const pattern = it.pattern ? e(it.pattern) + (it.pattern_custom ? " (" + e(it.pattern_custom) + ")" : "") : "";
    if (multi) msg += `\n🧺 <b>${it.product_type === "bracket" ? "Кронштейни" : "Кошик"} ${i + 1}</b>\n`;
    if (it.product_type === "bracket") {
      if (it.basket_model_name || it.basket_model) msg += `• Модель: <b>${e(it.basket_model_name || it.basket_model)}</b>\n`;
      if (it.bracket_length) msg += `• Довжина: <b>${e(it.bracket_length)}</b>\n`;
      msg += `• Віброподушки: <b>${it.vibro_pads ? "Так" : "Ні"}</b>\n`;
      if (color) msg += `• Колір: <b>${color}</b>\n`;
      if (it.model_comment) msg += `• Коментар до моделі: ${e(it.model_comment)}\n`;
      msg += `• Кількість: <b>${Number(it.quantity) || 1} компл.</b>\n`;
      return;
    }
    if (it.basket_model_name || it.basket_model) msg += `• Модель: <b>${e(it.basket_model_name || it.basket_model)}</b>\n`;
    msg += `• Тип: <b>${e(it.basket_type)}</b>\n`;
    msg += `• Конструкція: <b>${e(it.construction_type)}</b>\n`;
    if (it.has_cover) msg += `• Верхня кришка: <b>Так</b>\n`;
    if (color) msg += `• Колір: <b>${color}</b>\n`;
    if (pattern) msg += `• Візерунок: <b>${pattern}</b>\n`;
    if (it.bracket_model_from || it.bracket_model_to) msg += `• Потужність кондиціонера: <b>${e(it.bracket_model_from)} — ${e(it.bracket_model_to)}</b>\n`;
    if (it.ac_brand || it.ac_model) msg += `• Кондиціонер: <b>${e([it.ac_brand, it.ac_model].filter(Boolean).join(" "))}</b>\n`;
    if (it.ac_model_url) msg += `• Посилання на кондиціонер: ${e(it.ac_model_url)}\n`;
    if (Number(it.size_w) > 0) {
      msg += `• Розміри (мм):\n   Висота — <b>${it.size_h}</b>\n   Ширина — <b>${it.size_w}</b>\n   Глибина — <b>${it.size_d}</b>\n`;
    } else if (it.bracket_model_from || it.bracket_model_to) {
      msg += `• Розміри: <i>підбираються за діапазоном BTU</i>\n`;
    } else {
      msg += `• Розміри: <i>розрахує менеджер</i>\n`;
    }
    if (it.model_comment) msg += `• Коментар до моделі: ${e(it.model_comment)}\n`;
    msg += `• Кількість: <b>${Number(it.quantity) || 1} шт.</b>\n`;
  });

  // ── ФІНАНСИ (виробнича вартість + оплата) ──
  msg += `\n💰 <b>ФІНАНСИ</b>\n`;
  let grandCost = 0;
  if (multi) {
    items.forEach((it, i) => {
      const b = productionBreakdown(it), cost = Number(it.cost_total) || b.total;
      grandCost += cost;
      if (b.basketCost > 0) msg += `• Кошик ${i + 1}: ${b.basketArea.toFixed(2)} м² × ${num(b.basketRate)} ₴ = <b>${num(b.basketCost)} ₴</b>\n`;
      if (b.coverCost > 0) msg += `  Верхня кришка: ${b.coverArea.toFixed(2)} м² × ${num(b.coverRate)} ₴ = <b>${num(b.coverCost)} ₴</b>\n`;
    });
    if (grandCost > 0) msg += `• <b>Разом виробнича: ${num(grandCost)} ₴</b>\n`;
  } else {
    const it = items[0], b = productionBreakdown(it), cost = Number(it.cost_total) || b.total;
    grandCost = cost;
    if (b.basketCost > 0) msg += `• Кошик: ${b.basketArea.toFixed(2)} м² × <b>${num(b.basketRate)} ₴/м²</b> = <b>${num(b.basketCost)} ₴</b>\n`;
    if (b.coverCost > 0) msg += `• Верхня кришка: ${b.coverArea.toFixed(2)} м² × <b>${num(b.coverRate)} ₴/м²</b> = <b>${num(b.coverCost)} ₴</b>\n`;
    if (cost > 0) msg += `• Вартість виробнича: <b>${num(cost)} ₴</b>\n`;
  }
  if (grandCost === 0) msg += `• <i>Потрібен індивідуальний прорахунок менеджера</i>\n`;
  if (order.payment_method) msg += `• Оплата: <b>${e(order.payment_method)}</b>\n`;

  // ── ДОСТАВКА ──
  msg += `\n🚚 <b>ДОСТАВКА</b>\n`;
  const transport = order.transport === "Інше" ? (order.transport_custom || "") : order.transport;
  if (transport) msg += `• Спосіб: <b>${e(transport)}</b>\n`;
  if (order.delivery_address) msg += `• Адреса: ${e(order.delivery_address)}\n`;
  if (order.delivery_date) msg += `• Дата: <b>${formatDeliveryDate(order.delivery_date)}</b>\n`;
  const howFound = order.how_found === "Інше" ? order.how_found_custom : order.how_found;
  if (howFound) msg += `• Як дізналися про нас: ${e(howFound)}\n`;
  if (order.notes) msg += `• Примітка: ${e(order.notes)}\n`;
  if (order.pattern_file?.name) msg += `• Файл візерунку: <b>${e(order.pattern_file.name)}</b>\n`;

  // ── Джерело (мета) ──
  msg += `\n🔖 Джерело заявки: ${e(order.referral_source || "direct")}\n`;
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
  "https://avalon-ac-baskets.active-sloth-1989.chatgpt.site",
  "https://avalon-ac-baskets.vercel.app",
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
    if (!order || !String(order.first_name || "").trim() || !getCustomerContact(order).value) {
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
    if (!SHEETS_URL) {
      return res.status(503).json({ error: "Сервіс замовлень тимчасово не налаштований. Зателефонуйте нам або спробуйте пізніше." });
    }

    const results = [];
    const patternFileForSheets = getPatternFile(order);
    const patternFileMeta = patternFileForSheets ? {
      name: patternFileForSheets.name,
      type: patternFileForSheets.type,
      size: patternFileForSheets.size,
      data_length: patternFileForSheets.data.length,
    } : null;

    // --- Google Sheets (першим: Apps Script присвоює послідовний № ORD-ДДММРР-NNN і повертає його) ---
    let orderNumber = null;
    const requestId = (String(order.request_id || "").trim() || randomUUID()).slice(0, 120);
    try {
      const shRes = await fetchWithTimeout(SHEETS_URL, {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: JSON.stringify({ timestamp: new Date().toISOString(), ...order, request_id: requestId, pattern_file_meta: patternFileMeta }),
      }, 25000);
      const shData = await shRes.json().catch(() => null);
      if (!shRes.ok || !shData || shData.status !== "ok" || !shData.order_number) {
        throw new Error((shData && shData.message) || `Sheets HTTP ${shRes.status}`);
      }
      orderNumber = shData.order_number;
      results.push(shData.duplicate ? "gs:duplicate" : "gs:ok");
    } catch (err) {
      console.error("Google Sheets error:", err);
      return res.status(502).json({
        error: "Не вдалося надійно записати замовлення. Спробуйте ще раз — повтор не створить дубль.",
      });
    }
    const orderWithNumber = { ...order, order_number: orderNumber };

    // --- Telegram ---
    if (TG_TOKEN && TG_CHAT_ID) {
      try {
        const text = formatTelegramMessage(orderWithNumber);
        const tgRes = await fetchWithTimeout(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: TG_CHAT_ID, text, parse_mode: "HTML" }),
        }, 15000);
        const tgData = await tgRes.json();
        results.push(tgData.ok ? "tg:ok" : "tg:err");

        if (tgData.ok && getPatternFile(orderWithNumber)) {
          try {
            const docData = await sendPatternFileToTelegram(TG_TOKEN, TG_CHAT_ID, orderWithNumber);
            results.push(docData && docData.ok ? "tg_file:ok" : "tg_file:err");
          } catch (fileErr) {
            console.error("Telegram file error:", fileErr);
            results.push("tg_file:err");
          }
        }
      } catch (err) {
        console.error("Telegram error:", err);
        results.push("tg:err");
      }
    }

    if (results.includes("gs:ok") || results.includes("gs:duplicate")) {
      return res.status(200).json({ ok: true, order_number: orderNumber, results });
    }

    return res.status(500).json({ error: "Замовлення не записано", results });
  } catch (err) {
    console.error("Handler error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
