// Надсилання замовлення підряднику з CRM: перегляд, текст повідомлення (з пташками,
// що саме показувати) і вибрані файли — по одному запиту на файл, щоб великі файли
// не впиралися в ліміт часу однієї функції.
const { requireAdmin, setAdminCors, handleOptions } = require("../../lib/admin-auth");
const { callAdminSheets, sendError } = require("../../lib/admin-sheets");

const ORDER_RE = /^ORD-\d{6}-\d{3}$/;
// Лише відомі пташки і лише true/false — зайве в Apps Script не потрапляє.
const OPTION_KEYS = ["client_name", "phone", "telegram", "email", "city", "address", "finance", "notes"];

function cleanOptions(raw) {
  const out = {};
  OPTION_KEYS.forEach((key) => {
    if (raw && typeof raw[key] === "boolean") out[key] = raw[key];
  });
  return out;
}

module.exports = async function handler(req, res) {
  setAdminCors(req, res);
  if (req.method === "OPTIONS") return handleOptions(req, res);
  if (!requireAdmin(req, res)) return;
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const body = req.body || {};
    const orderNumber = String(body.order_number || "").trim();
    if (!ORDER_RE.test(orderNumber)) return res.status(400).json({ error: "order_number required" });
    const requestId = String(body.request_id || "").trim().slice(0, 120);
    const action = String(body.action || "");

    if (action === "preview") {
      const data = await callAdminSheets("contractor_preview", {
        order_number: orderNumber,
        options: cleanOptions(body.options),
      });
      return res.status(200).json(data);
    }
    if (action === "send") {
      const data = await callAdminSheets("contractor_send", {
        order_number: orderNumber,
        options: cleanOptions(body.options),
        request_id: requestId,
      });
      return res.status(200).json(data);
    }
    if (action === "send_file") {
      const fileId = String(body.file_id || "").trim();
      if (!fileId) return res.status(400).json({ error: "file_id required" });
      const data = await callAdminSheets("contractor_send_file", {
        order_number: orderNumber,
        file_id: fileId,
        request_id: requestId,
      });
      return res.status(200).json(data);
    }
    return res.status(400).json({ error: "Unknown action" });
  } catch (err) {
    console.error("admin/contractor:", err.message);
    return sendError(res, err);
  }
};
