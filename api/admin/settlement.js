// Акт звірки з підрядником: XLSX збирається тут, PDF — в Apps Script (експорт одного
// аркуша, щоб у файл не потрапили інші аркуші книги), надсилання в Telegram — теж
// у Apps Script, бо саме там зберігається chat_id групи підрядника.
const ExcelJS = require("exceljs");
const { requireAdmin, setAdminCors, handleOptions } = require("../../lib/admin-auth");
const { callAdminSheets, sendError } = require("../../lib/admin-sheets");

const MONEY = "#,##0 ₴";
const HEADER_FILL = "FF383E42";

// «2026-08-01» → «01.08.2026»: у документі для підрядника службовий формат недоречний.
function uaDate(iso) {
  const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : String(iso || "");
}

function periodLabel(from, to) {
  if (from && to) return `${uaDate(from)} — ${uaDate(to)}`;
  if (from) return `з ${uaDate(from)}`;
  if (to) return `до ${uaDate(to)}`;
  return "усі періоди";
}

function fileBase(from, to) {
  const p = [from, to].filter(Boolean).join("_");
  return `Akt-zvirky-Avalon${p ? "_" + p : ""}`;
}

function styleHeader(row) {
  row.height = 30;
  row.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_FILL } };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  });
}

function styleSection(row) {
  row.eachCell((cell) => {
    cell.font = { bold: true };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEFF2F0" } };
  });
}

async function buildXlsx(d) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Avalon Metal Design";
  wb.created = new Date();
  const ws = wb.addWorksheet("Акт звірки", {
    pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });
  ws.columns = [
    { width: 18 }, { width: 12 }, { width: 34 }, { width: 14 },
    { width: 16 }, { width: 14 }, { width: 13 }, { width: 14 },
  ];

  const title = ws.addRow(["АКТ ЗВІРКИ З ПІДРЯДНИКОМ"]);
  title.font = { bold: true, size: 14 };
  ws.mergeCells(title.number, 1, title.number, 8);
  const sub = ws.addRow(["Avalon Metal Design"]);
  sub.font = { color: { argb: "FF66716B" } };
  ws.mergeCells(sub.number, 1, sub.number, 8);
  const meta = ws.addRow([`Період: ${periodLabel(d.from, d.to)}`, "", "", "", `Сформовано: ${d.generated_at || ""}`]);
  ws.mergeCells(meta.number, 1, meta.number, 4);   // інакше сусідня клітинка обрізає текст
  ws.mergeCells(meta.number, 5, meta.number, 8);
  ws.addRow([]);

  // ── До виплати: лише замовлення, оплачені клієнтом на 100% ──
  styleSection(ws.addRow(["МАРЖА ДО ВИПЛАТИ (клієнт сплатив 100%)"]));
  styleHeader(ws.addRow([
    "№ замовлення", "Дата", "Клієнт / місто", "Сплатив клієнт",
    "Підряднику", "Маржа Avalon", "Отримано", "До виплати",
  ]));
  (d.due || []).forEach((r) => {
    ws.addRow([
      r.order_number,
      r.date_label || "",
      [r.client, r.city].filter(Boolean).join(" · "),
      r.revenue, r.cost_total, r.profit, r.margin_received, r.margin_left,
    ]);
  });
  const t = d.totals || {};
  const dueTotal = ws.addRow([
    "", "", "РАЗОМ ДО ВИПЛАТИ:", t.due_revenue || 0, t.due_cost || 0,
    t.due_margin || 0, t.due_received || 0, t.due_left || 0,
  ]);
  dueTotal.font = { bold: true };
  dueTotal.eachCell((cell) => { cell.border = { top: { style: "thin" } }; });

  // ── Довідково: недоплачені клієнтом — у борг НЕ входять (правило власника) ──
  if ((d.waiting || []).length) {
    ws.addRow([]);
    styleSection(ws.addRow(["ДОВІДКОВО: очікує повної оплати клієнтом — у борг НЕ входить"]));
    styleHeader(ws.addRow([
      "№ замовлення", "Дата", "Клієнт / місто", "Сплатив клієнт",
      "Не сплачено клієнтом", "Маржа Avalon", "Отримано", "Потенційно",
    ]));
    d.waiting.forEach((r) => {
      ws.addRow([
        r.order_number,
        r.date_label || "",
        [r.client, r.city].filter(Boolean).join(" · "),
        r.client_paid, r.client_left, r.profit, r.margin_received, r.margin_left,
      ]);
    });
    const wRow = ws.addRow([
      "", "", "Разом (довідково):", "", t.waiting_client_left || 0, "", "", t.waiting_margin_left || 0,
    ]);
    wRow.font = { bold: true, italic: true };
  }

  // ── Що вже отримано від підрядника за період ──
  if ((d.payments || []).length) {
    ws.addRow([]);
    styleSection(ws.addRow(["ОТРИМАНО ВІД ПІДРЯДНИКА ЗА ПЕРІОД"]));
    styleHeader(ws.addRow(["Дата", "№ замовлення", "Спосіб", "Примітка", "Сума"]));
    d.payments.forEach((p) => {
      ws.addRow([String(p.date || "").slice(0, 10), p.order_number, p.method || "—", p.note || "", p.amount]);
    });
    const pRow = ws.addRow(["", "", "", "Разом отримано:", t.payments_sum || 0]);
    pRow.font = { bold: true };
  }

  ws.addRow([]);
  ws.addRow(["Avalon Metal Design: ____________________", "", "", "", "Підрядник: ____________________"]);

  // Грошові формати
  ws.eachRow((row) => {
    for (let c = 4; c <= 8; c++) {
      const cell = row.getCell(c);
      if (typeof cell.value === "number") cell.numFmt = MONEY;
    }
  });

  // Місто/ПІБ переносимо в межах клітинки — інакше текст обрізає сусідня колонка.
  ws.eachRow((row) => { row.getCell(3).alignment = { vertical: "middle", wrapText: true }; });

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

module.exports = async function handler(req, res) {
  setAdminCors(req, res);
  if (req.method === "OPTIONS") return handleOptions(req, res);
  if (!requireAdmin(req, res)) return;

  try {
    const src = req.method === "GET" ? (req.query || {}) : (req.body || {});
    const from = String(src.from || "").slice(0, 10);
    const to = String(src.to || "").slice(0, 10);
    const format = String(src.format || "xlsx").toLowerCase();

    if (format === "send") {
      const out = await callAdminSheets("settlement_send", { from, to });
      return res.status(200).json(out);
    }

    if (format === "pdf") {
      const out = await callAdminSheets("settlement_pdf", { from, to });
      return res.status(200).json(out);
    }

    const data = await callAdminSheets("settlement_data", { from, to });
    const buf = await buildXlsx(data);
    return res.status(200).json({
      status: "ok",
      filename: `${fileBase(from, to)}.xlsx`,
      mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      base64: buf.toString("base64"),
      totals: data.totals || {},
    });
  } catch (err) {
    console.error("admin/settlement:", err);
    return sendError(res, err);
  }
};
