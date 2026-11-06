// Рахунок на оплату з картки замовлення (06.11.2026). Підключається з api/admin/order.js за resource=invoice —
// окремий файл в api/ перевищив би ліміт Vercel Hobby (12 функцій). Власник і менеджер.
//   POST { order_number, request_id, seller: "fop"|"tov", amount, buyer, lines, order_total, paid_before }
//   → номер СФ-NNNN і журнал рахунків замовлення. Документ (PDF / Word) кабінет будує сам із цих даних.
const { requireAdmin, setAdminCors, handleOptions } = require("./admin-auth");
const { callAdminSheets, sendError } = require("./admin-sheets");

const ID_RE = /^[A-Za-z0-9_-]{6,60}$/;
const BUYER_KINDS = ["person", "fop", "company"];
const BUYER_FIELDS = { name: 200, code: 20, ipn: 20, iban: 40, bank: 120, address: 300, phone: 40, email: 120 };

function text(v, max) { return String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, max); }
function money(v) { const n = Math.round(Number(v) || 0); return Number.isFinite(n) && n >= 0 && n <= 10000000 ? n : 0; }

function cleanBuyer(raw) {
  const b = raw && typeof raw === "object" ? raw : {};
  const out = { kind: BUYER_KINDS.includes(b.kind) ? b.kind : "person" };
  Object.keys(BUYER_FIELDS).forEach((k) => { const v = text(b[k], BUYER_FIELDS[k]); if (v) out[k] = v; });
  if (out.iban) out.iban = out.iban.replace(/\s/g, "").toUpperCase();
  return out;
}
function cleanLines(raw) {
  return (Array.isArray(raw) ? raw : []).slice(0, 60).map((l) => ({
    name: text(l && l.name, 400), qty: Math.max(0, Number(l && l.qty) || 0) || 1, unit: text(l && l.unit, 12) || "шт.",
    sum: money(l && l.sum),
  })).filter((l) => l.name);
}

module.exports = async function invoiceHandler(req, res) {
  setAdminCors(req, res);
  if (req.method === "OPTIONS") return handleOptions(req, res);
  if (!requireAdmin(req, res)) return;
  try {
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
    const body = req.body || {};
    const order = text(body.order_number, 60);
    if (!/^ORD-[A-Za-z0-9-]{3,40}$/.test(order)) return res.status(400).json({ error: "Невірний номер замовлення" });
    const rid = text(body.request_id, 60);
    if (!ID_RE.test(rid)) return res.status(400).json({ error: "Немає ID запиту" });
    const seller = String(body.seller || "");
    if (!["fop", "tov"].includes(seller)) return res.status(400).json({ error: "Оберіть, кому платити: ФОП чи ТОВ" });
    const amount = money(body.amount);
    if (!(amount >= 1)) return res.status(400).json({ error: "Вкажіть суму рахунку" });
    const buyer = cleanBuyer(body.buyer);
    if (!buyer.name) return res.status(400).json({ error: "Вкажіть покупця" });
    const lines = cleanLines(body.lines);
    if (!lines.length) return res.status(400).json({ error: "У рахунку немає позицій" });
    const out = await callAdminSheets("invoice_create", {
      order_number: order, request_id: rid, seller, amount, buyer, lines,
      order_total: money(body.order_total), paid_before: money(body.paid_before),
    });
    return res.status(200).json(out);
  } catch (err) {
    console.error("admin/invoice:", err);
    return sendError(res, err);
  }
};
