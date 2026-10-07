const { requireAdmin, setAdminCors, handleOptions } = require("../../lib/admin-auth");
const { callAdminSheets, sendError } = require("../../lib/admin-sheets");
const filesHandler = require("../../lib/admin-files-handler");
const contractorHandler = require("../../lib/admin-contractor-handler");
const ratesHandler = require("../../lib/admin-rates-handler");

// Тариф Vercel Hobby дозволяє не більше 12 серверних функцій, і в проєкті їх
// рівно 12. Тому файли замовлення, надсилання підряднику й ставки підрядника живуть тут:
// /api/admin/order?resource=files|contractor|rates.
// Лише поля, за якими звіряємо позицію, і лише рядки/числа.
const EXPECT_KEYS = ["basket_type", "construction", "quantity", "basket_model", "product_kind"];
function cleanExpect(raw) {
  const out = {};
  EXPECT_KEYS.forEach((key) => {
    const value = raw[key];
    if (typeof value === "string") out[key] = value.slice(0, 300);
    else if (typeof value === "number" && isFinite(value)) out[key] = value;
  });
  return out;
}

// Позиція з калькулятора: лише відомі поля, текст — обрізаний, числа — невідʼємні.
const ITEM_TEXT_KEYS = ["product_type", "basket_model", "basket_model_name", "basket_type", "construction_type",
  "color", "pattern", "unit", "specs", "item_comment"];
const ITEM_NUM_KEYS = ["size_w", "size_h", "size_d", "quantity", "cost_total", "price_total", "list_price", "discount_pct", "discount_uah"];
function cleanItem(raw) {
  if (!raw || typeof raw !== "object") return null;
  const out = {};
  ITEM_TEXT_KEYS.forEach((key) => {
    if (typeof raw[key] === "string") out[key] = raw[key].slice(0, key === "specs" || key === "item_comment" ? 1000 : 300);
  });
  ITEM_NUM_KEYS.forEach((key) => {
    if (raw[key] === "" || raw[key] == null) return;
    const value = Number(raw[key]);
    if (Number.isFinite(value) && value >= 0) out[key] = value;
  });
  if (typeof raw.has_cover === "boolean") out.has_cover = raw.has_cover;
  return out;
}

function resourceOf(req) {
  return String((req.query && req.query.resource) || (req.body && req.body.resource) || "");
}

module.exports = async function handler(req, res) {
  const resource = resourceOf(req);
  if (resource === "files") return filesHandler(req, res);
  if (resource === "contractor") return contractorHandler(req, res);
  if (resource === "rates") return ratesHandler(req, res);

  setAdminCors(req, res);
  if (req.method === "OPTIONS") return handleOptions(req, res);
  if (!requireAdmin(req, res)) return;

  try {
    if (req.method === "GET") {
      const orderNumber = (req.query && req.query.order_number) || "";
      if (!orderNumber) return res.status(400).json({ error: "order_number required" });
      const data = await callAdminSheets("get_order", { order_number: orderNumber });
      return res.status(200).json(data);
    }

    if (req.method === "PATCH" || req.method === "POST") {
      const body = req.body || {};
      const orderNumber = body.order_number || (req.query && req.query.order_number);
      if (!orderNumber) return res.status(400).json({ error: "order_number required" });
      // Додати позицію до наявного замовлення (розрахунок із калькулятора).
      if (req.method === "POST" && body.action === "add_item") {
        const item = cleanItem(body.item);
        if (!item) return res.status(400).json({ error: "item required" });
        const data = await callAdminSheets("add_order_item", {
          order_number: String(orderNumber).trim(),
          item,
          request_id: String(body.request_id || "").trim().slice(0, 120),
          // Менеджер у калькуляторі відмовився від доплати за колір для цього замовлення.
          ...(body.waive_color_surcharge === true ? { waive_color_surcharge: true } : {}),
        });
        return res.status(200).json(data);
      }
      // Перевести замовлення на чинні ставки й перерахувати його кошики.
      if (req.method === "POST" && body.action === "reprice") {
        const data = await callAdminSheets("order_reprice", { order_number: String(orderNumber).trim() });
        return res.status(200).json(data);
      }
      const data = await callAdminSheets("update_order", {
        order_number: orderNumber,
        row: body.row,
        patch: body.patch || body,
        // Що кабінет бачить у цій позиції — щоб не правити сусідню після зсуву рядків.
        ...(body.expect && typeof body.expect === "object" ? { expect: cleanExpect(body.expect) } : {}),
      });
      return res.status(200).json(data);
    }

    if (req.method === "DELETE") {
      // Прибрати одну позицію замовлення (рядок таблиці) — з картки замовлення.
      const query = req.query || {};
      const orderNumber = String(query.order_number || (req.body && req.body.order_number) || "").trim();
      const row = Number(query.row || (req.body && req.body.row) || 0);
      if (!orderNumber) return res.status(400).json({ error: "order_number required" });
      if (!(row >= 2)) return res.status(400).json({ error: "row required" });
      const expect = req.body && req.body.expect && typeof req.body.expect === "object" ? cleanExpect(req.body.expect) : null;
      const data = await callAdminSheets("delete_order_item", { order_number: orderNumber, row, ...(expect ? { expect } : {}) });
      return res.status(200).json(data);
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.error("admin/order:", err);
    return sendError(res, err);
  }
};
