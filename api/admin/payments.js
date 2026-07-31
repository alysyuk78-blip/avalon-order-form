const { requireAdmin, setAdminCors, handleOptions } = require("../../lib/admin-auth");
const { callAdminSheets, sendError } = require("../../lib/admin-sheets");

module.exports = async function handler(req, res) {
  setAdminCors(req, res);
  if (req.method === "OPTIONS") return handleOptions(req, res);
  if (!requireAdmin(req, res)) return;

  try {
    if (req.method === "GET") {
      const orderNumber = (req.query && req.query.order_number) || "";
      const data = await callAdminSheets("list_payments", { order_number: orderNumber });
      return res.status(200).json(data);
    }

    // Внесення передоплати / доплати клієнта або виплати маржі підрядником.
    if (req.method === "POST") {
      const body = req.body || {};
      const payment = body.payment || body;
      if (!String(payment.order_number || "").trim()) {
        return res.status(400).json({ error: "order_number required" });
      }
      if (!(Number(payment.amount) > 0)) {
        return res.status(400).json({ error: "Сума платежу мусить бути більшою за нуль" });
      }
      const data = await callAdminSheets("add_payment", { payment });
      return res.status(201).json(data);
    }

    if (req.method === "DELETE") {
      const row = Number((req.query && req.query.row) || (req.body && req.body.row) || 0);
      if (!(row >= 2)) return res.status(400).json({ error: "row required" });
      const data = await callAdminSheets("delete_payment", { row });
      return res.status(200).json(data);
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.error("admin/payments:", err);
    return sendError(res, err);
  }
};
