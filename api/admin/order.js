const { requireAdmin, setAdminCors, handleOptions } = require("../../lib/admin-auth");
const { callAdminSheets, sendError } = require("../../lib/admin-sheets");

module.exports = async function handler(req, res) {
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

    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.error("admin/order:", err);
    return sendError(res, err);
  }
};
