const { requireAdmin, setAdminCors, handleOptions } = require("../../lib/admin-auth");
const { callAdminSheets, sendError } = require("../../lib/admin-sheets");

module.exports = async function handler(req, res) {
  const startedAt = Date.now();
  const requestId = req.headers && req.headers["x-vercel-id"];
  console.log(JSON.stringify({ level: "info", msg: "start", route: "/api/admin/payments", method: req.method, requestId }));
  setAdminCors(req, res);
  if (req.method === "OPTIONS") return handleOptions(req, res);
  if (!requireAdmin(req, res)) return;

  try {
    if (req.method === "GET") {
      const orderNumber = (req.query && req.query.order_number) || "";
      const data = await callAdminSheets("list_payments", { order_number: orderNumber });
      console.log(JSON.stringify({ level: "info", msg: "done", route: "/api/admin/payments", method: req.method, ms: Date.now() - startedAt, requestId }));
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
      console.log(JSON.stringify({ level: "info", msg: "done", route: "/api/admin/payments", method: req.method, ms: Date.now() - startedAt, requestId }));
      return res.status(201).json(data);
    }

    if (req.method === "DELETE") {
      const row = Number((req.query && req.query.row) || (req.body && req.body.row) || 0);
      const orderNumber = (req.query && req.query.order_number) || (req.body && req.body.order_number) || "";
      if (!(row >= 2)) return res.status(400).json({ error: "row required" });
      if (!String(orderNumber).trim()) return res.status(400).json({ error: "order_number required" });
      const data = await callAdminSheets("delete_payment", { row, order_number: orderNumber });
      console.log(JSON.stringify({ level: "info", msg: "done", route: "/api/admin/payments", method: req.method, ms: Date.now() - startedAt, requestId }));
      return res.status(200).json(data);
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.error(JSON.stringify({ level: "error", msg: "failed", route: "/api/admin/payments", method: req.method, error: err.message, ms: Date.now() - startedAt, requestId }));
    return sendError(res, err);
  }
};
