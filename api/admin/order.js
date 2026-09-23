const { requireAdmin, setAdminCors, handleOptions } = require("../../lib/admin-auth");
const { callAdminSheets, sendError } = require("../../lib/admin-sheets");
const filesHandler = require("../../lib/admin-files-handler");
const contractorHandler = require("../../lib/admin-contractor-handler");

// Тариф Vercel Hobby дозволяє не більше 12 серверних функцій, і в проєкті їх
// рівно 12. Тому файли замовлення й надсилання підряднику живуть тут:
// /api/admin/order?resource=files|contractor.
function resourceOf(req) {
  return String((req.query && req.query.resource) || (req.body && req.body.resource) || "");
}

module.exports = async function handler(req, res) {
  const resource = resourceOf(req);
  if (resource === "files") return filesHandler(req, res);
  if (resource === "contractor") return contractorHandler(req, res);

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
      const data = await callAdminSheets("update_order", {
        order_number: orderNumber,
        row: body.row,
        patch: body.patch || body,
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
      const data = await callAdminSheets("delete_order_item", { order_number: orderNumber, row });
      return res.status(200).json(data);
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.error("admin/order:", err);
    return sendError(res, err);
  }
};
