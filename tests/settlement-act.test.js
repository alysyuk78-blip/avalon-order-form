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

  console.log("settlement-act tests: OK");
}

run().catch((err) => { console.error(err); process.exit(1); });
