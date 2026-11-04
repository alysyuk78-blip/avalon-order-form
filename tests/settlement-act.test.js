// Акт звірки: комісію утримує підрядник, тож у документі має бути видно і суму
// комісії, і зменшений на неї борг. Без комісії акт лишається таким, як був.
const assert = require("assert");
const path = require("path");
const ExcelJS = require("exceljs");

process.env.ADMIN_API_SECRET = "test-secret";
process.env.GOOGLE_SHEET_URL = "https://example.test/exec";

// Підміняємо проксі до Apps Script — тест перевіряє саме побудову XLSX.
let sheetsPayload = null;
const sheetsPath = require.resolve("../lib/admin-sheets");
require(sheetsPath);
require.cache[sheetsPath].exports = {
  callAdminSheets: async () => sheetsPayload,
  sendError: (res, err) => res.status(err.status || 500).json({ error: err.message }),
};

const authPath = require.resolve("../lib/admin-auth");
require(authPath);
require.cache[authPath].exports = {
  requireAdmin: () => true,
  roleOf: () => "owner",
  setAdminCors: () => {},
  handleOptions: (req, res) => res.status(204).end(),
};

const handler = require("../api/admin/settlement");

function response() {
  return {
    statusCode: 200,
    body: null,
    setHeader() {},
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    end() { return this; },
  };
}

async function buildAct(payload) {
  sheetsPayload = payload;
  const res = response();
  await handler({ method: "GET", query: { from: "2026-09-01", to: "2026-09-30" }, headers: {} }, res);
  assert.equal(res.statusCode, 200, "акт має будуватися без помилки");
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(res.body.base64, "base64"));
  const ws = wb.getWorksheet(1);
  const rows = [];
  ws.eachRow((row) => rows.push(row.values.slice(1).map(v => (v == null ? "" : v))));
  return rows;
}

const baseOrder = {
  order_number: "ORD-010926-001", date_label: "01.09.2026", client: "Тест", city: "Київ",
  revenue: 12545, cost_total: 9650, profit: 2895,
  client_paid: 12545, client_left: 0, margin_received: 0,
};

async function run() {
  // ── З комісією: зʼявляється колонка «Комісія», борг = 2895 − 868,5 ──
  const withCom = await buildAct({
    from: "2026-09-01", to: "2026-09-30", generated_at: "10.09.2026 12:00",
    due: [{ ...baseOrder, commission: 868.5, margin_due: 2026.5, margin_left: 2026.5 }],
    waiting: [], payments: [],
    totals: {
      due_revenue: 12545, due_cost: 9650, due_margin: 2895, due_commission: 868.5,
      due_margin_net: 2026.5, due_received: 0, due_left: 2026.5,
      waiting_commission: 0, waiting_margin_left: 0, waiting_client_left: 0, payments_sum: 0,
    },
  });
  const header = withCom.find(r => r[0] === "№ замовлення");
  assert.deepEqual(header, [
    "№ замовлення", "Дата", "Клієнт / місто", "Сплатив клієнт",
    "Підряднику", "Маржа Avalon", "Комісія", "Отримано", "До виплати",
  ]);
  const dataRow = withCom.find(r => r[0] === "ORD-010926-001");
  assert.equal(dataRow[5], 2895, "маржа Avalon — валова");
  assert.equal(dataRow[6], 868.5, "комісія показана окремим рядком");
  assert.equal(dataRow[8], 2026.5, "до виплати = валова маржа мінус комісія");
  assert.equal(dataRow[5] - dataRow[6] - dataRow[7], dataRow[8], "акт має сходитися по рядку");
  const totalRow = withCom.find(r => r[2] === "РАЗОМ ДО ВИПЛАТИ:");
  assert.equal(totalRow[8], 2026.5);

  // ── Без комісії: акт лишається у старому вигляді, 8 колонок ──
  const noCom = await buildAct({
    from: "2026-09-01", to: "2026-09-30", generated_at: "10.09.2026 12:00",
    due: [{ ...baseOrder, commission: 0, margin_due: 2895, margin_left: 2895 }],
    waiting: [], payments: [],
    totals: {
      due_revenue: 12545, due_cost: 9650, due_margin: 2895, due_commission: 0,
      due_margin_net: 2895, due_received: 0, due_left: 2895,
      waiting_commission: 0, waiting_margin_left: 0, waiting_client_left: 0, payments_sum: 0,
    },
  });
  const plainHeader = noCom.find(r => r[0] === "№ замовлення");
  assert.deepEqual(plainHeader, [
    "№ замовлення", "Дата", "Клієнт / місто", "Сплатив клієнт",
    "Підряднику", "Маржа Avalon", "Отримано", "До виплати",
  ], "без комісії колонки не додаються");
  const plainRow = noCom.find(r => r[0] === "ORD-010926-001");
  assert.equal(plainRow[7], 2895);

  // ── Акт взаєморозрахунку за одним замовленням (Excel) ──
  sheetsPayload = {
    status: "ok", single_order: "ORD-110926-009", generated_at: "04.11.2026 10:00",
    order_acts: [{ order_number: "ORD-110926-009", client: "Олександр", city: "Хмельницький", date_label: "11.09.2026",
      rows: [{ k: "line", d: "", t: "Сума замовлення", v: 81396 },
             { k: "section", d: "", t: "3. ВЗАЄМОРОЗРАХУНОК", v: null },
             { k: "total", d: "", t: "= частка підрядника", v: 32964 },
             { k: "line", d: "2026-11-03", t: "− залік: маржа Avalon за ORD-031126-001", v: -1045 },
             { k: "note", d: "", t: "Маржу Avalon отримано повністю.", v: null }] }],
  };
  const res1 = response();
  await handler({ method: "POST", query: {}, body: { order: "ORD-110926-009", format: "xlsx" }, headers: {} }, res1);
  assert.equal(res1.statusCode, 200);
  assert.equal(res1.body.filename, "Akt-vzaiemorozrakhunku-ORD-110926-009.xlsx");
  const wb1 = new ExcelJS.Workbook();
  await wb1.xlsx.load(Buffer.from(res1.body.base64, "base64"));
  const rows1 = [];
  wb1.getWorksheet(1).eachRow((row) => rows1.push(row.values.slice(1).map(v => (v == null ? "" : v))));
  assert.equal(rows1[0][0], "АКТ ВЗАЄМОРОЗРАХУНКУ З ПІДРЯДНИКОМ");
  const shareRow = rows1.find(r => r[1] === "= частка підрядника");
  assert.equal(shareRow[3], 32964);
  const offRow = rows1.find(r => String(r[1]).indexOf("− залік") === 0);
  assert.deepEqual([offRow[0], offRow[3]], ["03.11.2026", -1045]);
  // Невірний номер — 400.
  const res2 = response();
  await handler({ method: "POST", query: {}, body: { order: "<script>", format: "xlsx" }, headers: {} }, res2);
  assert.equal(res2.statusCode, 400);

  console.log("settlement-act tests: OK");
}

run().catch((err) => { console.error(err); process.exit(1); });
