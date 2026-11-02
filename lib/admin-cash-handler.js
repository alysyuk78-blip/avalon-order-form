// Каса готівки й взаємозалік із підрядником — ЛИШЕ ВЛАСНИК (менеджер може лише внести платіж
// клієнта з «Хто отримав: Я»). Підключається з api/admin/payments.js за параметром resource=cash —
// окремий файл в api/ перевищив би ліміт Vercel Hobby (12 функцій).
//   GET                      — стан каси, хто кому винен, історія розрахунків;
//   POST action=add          — запис каси: «Взяв собі», витрата, внесення, коригування після перерахунку;
//   POST action=delete       — прибрати запис каси (row + request_id);
//   POST action=settle       — провести розрахунок із підрядником (settlement_id, amount, method, date);
//   POST action=undo         — скасувати розрахунок (settlement_id);
//   POST action=take         — забрати маржу за замовленням (order_number, request_id, expect).
const { requireOwner, setAdminCors, handleOptions } = require("./admin-auth");
const { callAdminSheets, sendError } = require("./admin-sheets");

// «Взяв собі» без замовлення більше не вноситься: маржу забирають кнопкою «Забрати» за замовленням.
const CASH_TYPES = ["Витрата з каси", "Внесення в касу", "Коригування після перерахунку"];
const ID_RE = /^[A-Za-z0-9_-]{6,60}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function cleanDate(v) {
  const d = String(v || "").trim().slice(0, 10);
  return DATE_RE.test(d) ? d : "";
}

module.exports = async function cashHandler(req, res) {
  setAdminCors(req, res);
  if (req.method === "OPTIONS") return handleOptions(req, res);
  if (!requireOwner(req, res)) return;
  try {
    if (req.method === "GET") return res.status(200).json(await callAdminSheets("cash_box", {}));
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
    const body = req.body || {};
    const action = String(body.action || "");
    if (action === "add") {
      const type = String(body.type || "").trim();
      if (!CASH_TYPES.includes(type)) return res.status(400).json({ error: "Невідомий запис каси" });
      const amount = Number(body.amount);
      if (!Number.isFinite(amount) || (type === "Коригування після перерахунку" ? amount === 0 : amount <= 0)) {
        return res.status(400).json({ error: "Вкажіть суму" });
      }
      return res.status(200).json(await callAdminSheets("cash_add", {
        entry: { type, amount, note: String(body.note || "").slice(0, 300), date: cleanDate(body.date),
                 request_id: ID_RE.test(String(body.request_id || "")) ? body.request_id : "" },
      }));
    }
    if (action === "delete") {
      const row = Number(body.row);
      if (!(row >= 2)) return res.status(400).json({ error: "Не вказано запис" });
      return res.status(200).json(await callAdminSheets("cash_delete", {
        row, request_id: String(body.request_id || "").slice(0, 80),
        ...(typeof body.type === "string" ? { type: body.type.slice(0, 60) } : {}),
        ...(Number.isFinite(Number(body.amount)) && body.amount !== "" && body.amount != null ? { amount: Number(body.amount) } : {}),
      }));
    }
    if (action === "take") {
      const orderNumber = String(body.order_number || "").trim();
      if (!/^ORD-\d{6}-\d{3}$/.test(orderNumber)) return res.status(400).json({ error: "Не вказано замовлення" });
      if (!ID_RE.test(String(body.request_id || ""))) return res.status(400).json({ error: "Немає ID запиту" });
      return res.status(200).json(await callAdminSheets("cash_take", {
        order_number: orderNumber, request_id: body.request_id, date: cleanDate(body.date),
        // Що бачив власник: скільки його маржі і скільки з грошей підрядника — інакше скрипт не забирає.
        ...(body.expect && typeof body.expect === "object"
          ? { expect: { own: Math.round(Number(body.expect.own) || 0), contractor: Math.round(Number(body.expect.contractor) || 0) } }
          : Number.isFinite(Number(body.expect)) ? { expect: Math.round(Number(body.expect)) } : {}),
      }));
    }
    if (action === "settle" || action === "undo") {
      const sid = String(body.settlement_id || "");
      if (!ID_RE.test(sid)) return res.status(400).json({ error: "Немає ID розрахунку" });
      if (action === "undo") return res.status(200).json(await callAdminSheets("cash_settle_undo", { settlement_id: sid }));
      const amount = Number(body.amount);
      if (!Number.isFinite(amount) || amount < 0) return res.status(400).json({ error: "Вкажіть суму" });
      const method = String(body.method || "Готівка").trim().slice(0, 60);
      return res.status(200).json(await callAdminSheets("cash_settle", {
        settlement_id: sid, amount: Math.round(amount), method, date: cleanDate(body.date),
        // Що бачив власник на екрані: якщо борги змінились, скрипт розрахунок не проведе.
        ...(body.expect && typeof body.expect === "object" ? { expect: {
          contractor: Number(body.expect.contractor) || 0, owner: Number(body.expect.owner) || 0,
          direction: String(body.expect.direction || "").slice(0, 20) } } : {}),
      }));
    }
    return res.status(400).json({ error: "Невідома дія" });
  } catch (err) {
    console.error("admin/cash:", err && err.message);
    return sendError(res, err);
  }
};
