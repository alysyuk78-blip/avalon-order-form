const { requireAdmin, setAdminCors, handleOptions } = require("../../lib/admin-auth");
const { callAdminSheets, sendError } = require("../../lib/admin-sheets");

module.exports = async function handler(req, res) {
  setAdminCors(req, res);
  if (req.method === "OPTIONS") return handleOptions(req, res);
  if (!requireAdmin(req, res)) return;

  try {
    if (req.method === "GET") {
      const data = await callAdminSheets("list_partners", {});
      return res.status(200).json(data);
    }
    if (req.method === "POST") {
      const body = req.body || {};
      const data = await callAdminSheets("upsert_partner", { partner: body });
      return res.status(200).json(data);
    }
    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.error("admin/partners:", err);
    return sendError(res, err);
  }
};
