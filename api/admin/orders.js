const { requireAdmin, setAdminCors, handleOptions } = require("../../lib/admin-auth");
const { callAdminSheets, sendError } = require("../../lib/admin-sheets");

module.exports = async function handler(req, res) {
  setAdminCors(req, res);
  if (req.method === "OPTIONS") return handleOptions(req, res);
  if (!requireAdmin(req, res)) return;

  try {
    if (req.method === "GET") {
      const q = (req.query && req.query.q) || "";
      const status = (req.query && req.query.status) || "";
      const data = await callAdminSheets("list_orders", { q, status });
      return res.status(200).json(data);
    }

    // POST = ручне внесення замовлення з кабінету (телефон, Instagram, повторний клієнт).
    if (req.method === "POST") {
      const body = req.body || {};
      const order = body.order || body;
      if (!String(order.client || order.first_name || "").trim()) {
        return res.status(400).json({ error: "Вкажіть імʼя клієнта" });
      }
      const data = await callAdminSheets("create_order", { order });
      return res.status(201).json(data);
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.error("admin/orders:", err);
    return sendError(res, err);
  }
};
