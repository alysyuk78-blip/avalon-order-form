// Мітки замовлень (як у Trello), 10.11.2026. Підключається з api/admin/order.js за resource=labels —
// окремий файл в api/ перевищив би ліміт Vercel Hobby (12 функцій).
//   GET                                   → словник міток
//   POST { label: { name, color, status } } → нова мітка (власник і менеджер)
//   POST { label: { id, name, color, status } } → змінити мітку (лише власник)
//   DELETE ?id=…                           → прибрати мітку зі словника (лише власник)
// Які мітки стоять на замовленні — звичайна правка замовлення: PATCH /api/admin/order { patch: { labels: [id…] } }.
const { requireAdmin, roleOf, setAdminCors, handleOptions } = require("./admin-auth");
const { callAdminSheets, sendError } = require("./admin-sheets");

const COLORS = ["green", "yellow", "orange", "red", "purple", "blue", "sky", "lime", "pink", "grey"];
const ID_RE = /^lbl-[A-Za-z0-9-]{1,40}$/;
function text(v, max) {
  return String(v == null ? "" : v).replace(/[\u0000-\u001F￾￿]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

module.exports = async function labelsHandler(req, res) {
  setAdminCors(req, res);
  if (req.method === "OPTIONS") return handleOptions(req, res);
  if (!requireAdmin(req, res)) return;
  const isOwner = roleOf(req) !== "manager";
  try {
    if (req.method === "GET") return res.status(200).json(await callAdminSheets("labels_list", {}));
    if (req.method === "POST") {
      const raw = (req.body && req.body.label) || {};
      const label = { name: text(raw.name, 40), color: COLORS.includes(raw.color) ? raw.color : "grey", status: text(raw.status, 60) };
      if (!label.name) return res.status(400).json({ error: "Вкажіть назву мітки" });
      if (raw.id != null && raw.id !== "") {
        if (!ID_RE.test(String(raw.id))) return res.status(400).json({ error: "Невірна мітка" });
        if (!isOwner) return res.status(403).json({ error: "Змінювати мітки може лише власник" });
        label.id = String(raw.id);
      }
      return res.status(200).json(await callAdminSheets("label_upsert", { label, is_owner: isOwner }));
    }
    if (req.method === "DELETE") {
      const id = String((req.query && req.query.id) || (req.body && req.body.id) || "");
      if (!ID_RE.test(id)) return res.status(400).json({ error: "Невірна мітка" });
      if (!isOwner) return res.status(403).json({ error: "Прибрати мітку може лише власник" });
      return res.status(200).json(await callAdminSheets("label_delete", { id, is_owner: isOwner }));
    }
    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    return sendError(res, err);
  }
};
