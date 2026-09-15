const { requireAdmin, setAdminCors, handleOptions } = require("../../lib/admin-auth");
const { callAdminSheets, sendError } = require("../../lib/admin-sheets");
const { readSnapshot, saveSnapshot } = require("../../lib/admin-snapshot");

// GET /api/admin/bootstrap          — одразу: знімок зі сховища (якщо є), інакше таблиця.
// GET /api/admin/bootstrap?fresh=1  — свіжі дані з таблиці; вони ж оновлюють знімок.
module.exports = async function handler(req, res) {
  setAdminCors(req, res);
  if (req.method === "OPTIONS") return handleOptions(req, res);
  if (!requireAdmin(req, res)) return;
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const fresh = String((req.query && req.query.fresh) || "") === "1";
  try {
    if (!fresh) {
      const snap = await readSnapshot();
      if (snap) {
        return res.status(200).json({
          ...snap.data,
          snapshot: { source: "snapshot", saved_at: snap.saved_at, age_ms: Math.max(0, Date.now() - snap.saved_at) },
        });
      }
    }
    const readAt = Date.now();
    const data = await callAdminSheets("bootstrap", {});
    const stored = await saveSnapshot(data, readAt);
    return res.status(200).json({ ...data, snapshot: { source: "sheets", saved_at: readAt, age_ms: 0, stored } });
  } catch (err) {
    console.error("admin/bootstrap:", err);
    return sendError(res, err);
  }
};
