const { requireAdmin, setAdminCors, handleOptions } = require("../../lib/admin-auth");
const { callAdminSheets, sendError } = require("../../lib/admin-sheets");

module.exports = async function handler(req, res) {
  setAdminCors(req, res);
  if (req.method === "OPTIONS") return handleOptions(req, res);
  if (!requireAdmin(req, res)) return;

  try {
    if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
    const data = await callAdminSheets("dashboard", {});
    return res.status(200).json(data);
  } catch (err) {
    console.error("admin/dashboard:", err);
    return sendError(res, err);
  }
};
