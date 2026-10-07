// Ставки підрядника: перегляд, зміна з дати початку дії, скасування останньої зміни.
// Підключається з api/admin/order.js за параметром resource=rates — окремий файл в api/
// перевищив би ліміт Vercel Hobby: не більше 12 серверних функцій на розгортання.
//
//   GET    — БЕЗ входу: чинні ставки потрібні калькулятору ще до входу в кабінет. Примітки
//            власника до змін без входу не віддаються — лише дати й числа.
//   POST   — зберегти нові ставки з дати (після входу).
//   DELETE — скасувати останню зміну (після входу).
const { requireAdmin, isAdmin, setAdminCors, handleOptions } = require("./admin-auth");
const { callAdminSheets, sendError } = require("./admin-sheets");
const { AVALON_RATE_FIELDS } = require("./avalon-pricing");

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Лише відомі ставки; число або короткий рядок («2 150,5» розбере єдиний алгоритм).
function cleanRates(raw) {
  const out = {};
  if (!raw || typeof raw !== "object") return out;
  AVALON_RATE_FIELDS.forEach((field) => {
    const value = raw[field.key];
    if (typeof value === "number" && Number.isFinite(value)) out[field.key] = value;
    else if (typeof value === "string" && value.trim()) out[field.key] = value.trim().slice(0, 20);
  });
  return out;
}

// Без входу — тільки те, що потрібно для розрахунку.
function publicPricing(pricing) {
  const p = pricing || {};
  return {
    versions: (Array.isArray(p.versions) ? p.versions : []).map((v) => ({ from: v.from, rates: v.rates })),
    today: p.today || "",
    current_from: p.current_from || "",
    ...(p.error ? { error: p.error } : {}),
  };
}

module.exports = async function ratesHandler(req, res) {
  setAdminCors(req, res);
  if (req.method === "OPTIONS") return handleOptions(req, res);

  try {
    if (req.method === "GET") {
      const data = await callAdminSheets("rates_get", {});
      return res.status(200).json({ status: "ok", pricing: isAdmin(req) ? data.pricing : publicPricing(data.pricing) });
    }

    if (!requireAdmin(req, res)) return;
    const body = req.body || {};
    const from = String(body.from || (req.query && req.query.from) || "").trim().slice(0, 10);
    if (!DATE_RE.test(from)) return res.status(400).json({ error: "Вкажіть дату, з якої діють ставки" });

    if (req.method === "POST") {
      const data = await callAdminSheets("rates_save", {
        rates_change: {
          from,
          rates: cleanRates(body.rates),
          note: String(body.note || "").trim().slice(0, 160),
          ...(body.confirm_large === true ? { confirm_large: true } : {}),
        },
      });
      return res.status(200).json(data);
    }
    if (req.method === "DELETE") {
      const data = await callAdminSheets("rates_delete", { rates_change: { from } });
      return res.status(200).json(data);
    }
    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.error("admin/rates:", err);
    return sendError(res, err);
  }
};
module.exports.publicPricing = publicPricing;
module.exports.cleanRates = cleanRates;
