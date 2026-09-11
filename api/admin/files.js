// Файли замовлення: список, завантаження частинами, прибирання. Самі файли лежать
// на Google Диску власника — тут лише перевірка вхідних даних і прохід до Apps Script.
const { requireAdmin, setAdminCors, handleOptions } = require("../../lib/admin-auth");
const { callAdminSheets, sendError } = require("../../lib/admin-sheets");

const ORDER_RE = /^ORD-\d{6}-\d{3}$/;
// Vercel приймає тіло запиту до 4,5 МБ. Браузер шле частини по 3 МБ (≈4 МБ у base64);
// усе, що більше, відсікаємо тут, щоб не отримати незрозумілу помилку платформи.
const MAX_CHUNK_BASE64 = Math.floor(4.3 * 1024 * 1024);

module.exports = async function handler(req, res) {
  setAdminCors(req, res);
  if (req.method === "OPTIONS") return handleOptions(req, res);
  if (!requireAdmin(req, res)) return;

  try {
    const src = (req.method === "GET" || req.method === "DELETE") ? (req.query || {}) : (req.body || {});
    const orderNumber = String(src.order_number || "").trim();
    if (!ORDER_RE.test(orderNumber)) return res.status(400).json({ error: "order_number required" });

    if (req.method === "GET") {
      const data = await callAdminSheets("files_list", { order_number: orderNumber });
      return res.status(200).json(data);
    }

    if (req.method === "DELETE") {
      const fileId = String(src.file_id || "").trim();
      if (!fileId) return res.status(400).json({ error: "file_id required" });
      const data = await callAdminSheets("file_trash", { order_number: orderNumber, file_id: fileId });
      return res.status(200).json(data);
    }

    if (req.method === "POST") {
      const action = String(src.action || "");
      if (action === "init") {
        const data = await callAdminSheets("file_upload_init", {
          order_number: orderNumber,
          name: String(src.name || "").slice(0, 200),
          mime: String(src.mime || "").slice(0, 150),
          size: Number(src.size) || 0,
        });
        return res.status(200).json(data);
      }
      if (action === "chunk") {
        const data = String(src.data || "");
        if (!data) return res.status(400).json({ error: "Порожня частина файлу" });
        if (data.length > MAX_CHUNK_BASE64) return res.status(413).json({ error: "Частина файлу завелика" });
        const out = await callAdminSheets("file_upload_chunk", {
          order_number: orderNumber,
          upload_id: String(src.upload_id || ""),
          offset: Number(src.offset) || 0,
          data,
        });
        return res.status(200).json(out);
      }
      if (action === "status") {
        const out = await callAdminSheets("file_upload_status", {
          order_number: orderNumber,
          upload_id: String(src.upload_id || ""),
        });
        return res.status(200).json(out);
      }
      return res.status(400).json({ error: "Unknown action" });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.error("admin/files:", err.message);
    return sendError(res, err);
  }
};
