// Каса готівки й взаємозалік із підрядником: справжній код Apps Script у VM, таблиця в памʼяті.
// Правила власника (02.11.2026): 1) комісія ТОВ не застосовується до грошей, отриманих власником;
// 2) хто кому винен — лише коли клієнт сплатив повністю; 3) витрати підрядника за замовлення,
// скасоване після виготовлення, несе власник («Частка підряднику» на скасованому замовленні).
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const CODE = fs.readFileSync(path.join(__dirname, "..", "google-apps-script-v2.js"), "utf8");
const W = 50;
const blank = (n) => new Array(n || W).fill("");

function makeSheet(data, width) {
  const w = width || W;
  const sheet = {
    data,
    getLastRow: () => data.length,
    getMaxColumns: () => w, getMaxRows: () => 1000,
    insertColumnsAfter() {}, setColumnWidth() {}, setFrozenRows() {}, setRowHeight() {},
    deleteRow(r) { data.splice(r - 1, 1); },
    getRange(r, c, nr, nc) {
      if (typeof r === "string") return new Proxy({}, { get: () => function () { return this; } });
      const rowsN = nr || 1, colsN = nc || 1;
      const rng = {
        getValues: () => { const out = []; for (let i = 0; i < rowsN; i++) out.push((data[r - 1 + i] || blank(w)).slice(c - 1, c - 1 + colsN)); return out; },
        setValues: (vals) => { vals.forEach((vr, i) => { while (data.length < r + i) data.push(blank(w)); vr.forEach((v, j) => { data[r - 1 + i][c - 1 + j] = v; }); }); return proxy; },
        getValue: () => (data[r - 1] || [])[c - 1],
        setValue: (v) => rng.setValues([[v]]),
      };
      const proxy = new Proxy(rng, { get: (t, p) => (p in t ? t[p] : () => proxy) });
      return proxy;
    },
  };
  return sheet;
}

function setup(orders, payments, cash) {
  const orderRows = [blank()];
  orders.forEach((o) => {
    const r = blank();
    r[0] = o.num; r[1] = o.date || "01.10.2026 10:00"; r[2] = o.status || "Виготовлення";
    r[4] = o.client || "Клієнт"; r[41] = "Кошик";
    r[21] = o.revenue; r[22] = o.profit;
    if (o.pct) { r[45] = o.pct; r[24] = Math.round(o.profit * o.pct) / 100; }
    orderRows.push(r);
  });
  const payRows = [["Дата", "№ Замовлення", "Тип", "Сума, ₴", "Спосіб", "Примітка", "ID запиту", "Хто отримав"]];
  (payments || []).forEach((p, i) => payRows.push([p.date || "2026-10-0" + ((i % 9) + 1), p.num, p.type, p.amount, p.method || "На карту", "", p.id || "", p.me ? "Я" : ""]));
  const sheets = {
    "Замовлення": makeSheet(orderRows),
    "Платежі": makeSheet(payRows, 8),
  };
  if (cash) sheets["Каса"] = makeSheet([["Дата", "Тип", "Сума, ₴", "Примітка", "ID запиту"]].concat(cash.map((x) => ["2026-10-10", x.type, x.amount, "", ""])), 5);
  const ss = { getSheetByName: (n) => sheets[n] || null, insertSheet: (n) => (sheets[n] = makeSheet([blank(5)], 5)) };
  const ctx = vm.createContext({
    console, Date,
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ss, flush() {},
      newDataValidation: () => { const b = { requireValueInList: () => b, setAllowInvalid: () => b, requireCheckbox: () => b, build: () => ({}) }; return b; },
    },
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => null, setProperty() {}, deleteProperty() {}, getProperties: () => ({}) }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    Utilities: { formatDate: (_d, _tz, fmt) => (fmt === "yyyy-MM-dd" ? "2026-11-02" : "02.11.2026 12:00") },
  });
  vm.runInContext(CODE, ctx);
  ctx.adminOrdersSheet_ = () => sheets["Замовлення"];
  return { ctx, sheets };
}
const group = (ctx, num) => ctx.adminListOrders_({}).groups.find((g) => g.order_number === num);
const pay = (num, type, amount, extra) => Object.assign({ num, type, amount }, extra || {});

// ── 1. Робочий приклад власника ──
{
  const { ctx, sheets } = setup(
    [{ num: "ORD-011026-001", revenue: 5000, profit: 1500 },
     { num: "ORD-021026-002", revenue: 4000, profit: 1200 },
     { num: "ORD-031026-003", revenue: 3000, profit: 800 }],
    [pay("ORD-011026-001", "Оплата повністю", 5000, { method: "Готівка", me: true }),
     pay("ORD-021026-002", "Оплата повністю", 4000),
     pay("ORD-031026-003", "Оплата повністю", 3000)]);
  const a = group(ctx, "ORD-011026-001");
  assert.equal(a.margin_left, 0, "гроші клієнта у власника — підрядник маржу не винен");
  assert.equal(a.owner_owes, 3500, "частка підрядника = 5000 − 1500");
  assert.equal(group(ctx, "ORD-021026-002").margin_left, 1200, "без готівки — як раніше");
  let box = ctx.adminCashBox_();
  assert.equal(box.cash.expected, 5000);
  assert.equal(box.contractor_owes, 2000);
  assert.equal(box.owner_owes, 3500);
  assert.equal(box.net, -1500);
  assert.equal(box.cash.free, 1500, "5000 − 3500 частки підрядника");

  // Акт звірки: маржа, яку винен підрядник, і гроші клієнтів у власника — з підсумком взаємозаліку.
  const act = ctx.settlementData_({});
  assert.deepEqual(act.due.map((r) => r.order_number), ["ORD-021026-002", "ORD-031026-003"]);
  assert.equal(act.owner_due.length, 1);
  assert.equal(act.owner_due[0].owner_owes, 3500);
  assert.equal(act.totals.due_left, 2000);
  assert.equal(act.totals.owner_due_left, 3500);
  assert.equal(act.totals.net, -1500);
  // Більше, ніж винні, — відмова.
  assert.throws(() => ctx.adminCashSettle_({ settlement_id: "settle-over", amount: 1600, method: "Готівка" }), /більша/);
  // Розрахунок: взаємозалік 2000 + 1500 готівкою.
  const res = ctx.adminCashSettle_({ settlement_id: "sett-0001", amount: 1500, method: "Готівка" });
  assert.equal(res.netting, 2000);
  assert.equal(res.left, 0);
  box = res.box;
  assert.equal(box.contractor_owes, 0);
  assert.equal(box.owner_owes, 0);
  assert.equal(box.cash.expected, 3500, "у касі лишилась уся маржа власника: 1500 + 2000");
  assert.equal(group(ctx, "ORD-021026-002").margin_left, 0);
  assert.equal(group(ctx, "ORD-011026-001").owner_owes, 0);
  assert.equal(sheets["Замовлення"].data[2][33], true, "«Маржу отримано ✓» для B після взаємозаліку");
  // Повтор із тим самим ID нічого не дублює.
  const rows = sheets["Платежі"].data.length;
  assert.equal(ctx.adminCashSettle_({ settlement_id: "sett-0001", amount: 1500, method: "Готівка" }).duplicate, true);
  assert.equal(sheets["Платежі"].data.length, rows);
  // Записи розрахунку не видаляються поодинці.
  const settleRow = sheets["Платежі"].data.findIndex((r) => String(r[6]).startsWith("settle:")) + 1;
  assert.throws(() => ctx.adminDeletePayment_({ row: settleRow, order_number: sheets["Платежі"].data[settleRow - 1][1] }), /скасуйте весь розрахунок/);
  // Скасування повертає все як було.
  const undo = ctx.adminCashSettleUndo_({ settlement_id: "sett-0001" });
  assert.equal(undo.box.net, -1500);
  assert.equal(undo.box.cash.expected, 5000);
  assert.equal(sheets["Платежі"].data.length, 4);
  // Часткова передача: лишається борг.
  const part = ctx.adminCashSettle_({ settlement_id: "sett-0002", amount: 1000, method: "Готівка" });
  assert.equal(part.left, 500);
  assert.equal(part.box.owner_owes, 500);
  assert.equal(part.box.cash.expected, 4000);
  // Ще раз — решту переказом з картки: каса не змінюється.
  const rest = ctx.adminCashSettle_({ settlement_id: "sett-0003", amount: 500, method: "На карту" });
  assert.equal(rest.box.owner_owes, 0);
  assert.equal(rest.box.cash.expected, 4000);
  assert.equal(rest.box.settlements.length, 2);
}

// ── 2. Підрядник винен більше: він доплачує власнику ──
{
  const { ctx } = setup(
    [{ num: "ORD-011026-001", revenue: 2000, profit: 600 },
     { num: "ORD-021026-002", revenue: 10000, profit: 3000 }],
    [pay("ORD-011026-001", "Оплата повністю", 2000, { method: "Готівка", me: true }),
     pay("ORD-021026-002", "Оплата повністю", 10000)]);
  const box = ctx.adminCashBox_();
  assert.equal(box.owner_owes, 1400);
  assert.equal(box.contractor_owes, 3000);
  assert.equal(box.net, 1600);
  const res = ctx.adminCashSettle_({ settlement_id: "sett-0010", amount: 1600, method: "Готівка" });
  assert.equal(res.direction, "to_owner");
  assert.equal(res.box.net, 0);
  assert.equal(res.box.cash.expected, 2000 + 1600, "підрядник приніс готівку в касу");
}

// ── 3. Правило 1: комісія ТОВ не береться з грошей, отриманих власником ──
{
  const { ctx } = setup(
    [{ num: "ORD-011026-001", revenue: 5000, profit: 1500, pct: 30 },
     { num: "ORD-021026-002", revenue: 10000, profit: 4000, pct: 30 },
     { num: "ORD-031026-003", revenue: 5000, profit: 1500, pct: 30 }],
    [pay("ORD-011026-001", "Оплата повністю", 5000, { method: "Готівка", me: true }),
     pay("ORD-021026-002", "Передоплата", 5000, { method: "Готівка", me: true }),
     pay("ORD-021026-002", "Доплата", 5000, { method: "На рахунок ТОВ" }),
     pay("ORD-031026-003", "Оплата повністю", 5000, { method: "На рахунок ТОВ" })]);
  const full = group(ctx, "ORD-011026-001");
  assert.equal(full.margin_due, 1500, "уся сума у власника — комісії немає");
  assert.equal(full.owner_owes, 3500);
  const mixed = group(ctx, "ORD-021026-002");
  assert.equal(mixed.margin_commission_eff, 600, "комісія лише з половини, що пройшла через ТОВ: 1200 × 0,5");
  assert.equal(mixed.margin_due, 3400);
  assert.equal(mixed.owner_owes, 1600, "підряднику належить 10000 − 3400 = 6600, у нього 5000");
  const tov = group(ctx, "ORD-031026-003");
  assert.equal(tov.margin_due, 1050, "без готівки — як раніше: 1500 − 450");
  assert.equal(tov.margin_left, 1050);
}

// ── 4. Правило 2: часткова оплата — лише прогноз ──
{
  const { ctx } = setup(
    [{ num: "ORD-011026-001", revenue: 10000, profit: 3000, status: "Готове" }],
    [pay("ORD-011026-001", "Передоплата", 2000, { method: "Готівка", me: true })]);
  const g = group(ctx, "ORD-011026-001");
  assert.equal(g.owner_owes, 0, "клієнт не доплатив — власник ще нічого не винен");
  const box = ctx.adminCashBox_();
  assert.equal(box.contractor_owes, 0, "і підрядник теж не винен");
  assert.equal(box.owner_owes, 0);
  assert.equal(box.cash.expected, 2000);
  assert.equal(box.cash.deposits, 2000, "неповна оплата — не вільні гроші");
  assert.equal(box.cash.free, 0);
  assert.throws(() => ctx.adminCashSettle_({ settlement_id: "sett-0020", amount: 0 }), /ніхто нікому не винен/);
}

// ── 5. Передоплата до виробництва, повернення, скасоване замовлення, записи каси ──
{
  const { ctx } = setup(
    [{ num: "ORD-011026-001", revenue: 4000, profit: 1000, status: "Нове" },
     { num: "ORD-021026-002", revenue: 3000, profit: 900, status: "Скасовано" },
     { num: "ORD-031026-003", revenue: 3000, profit: 900, status: "Скасовано" }],
    [pay("ORD-011026-001", "Передоплата", 1000, { method: "Готівка", me: true }),
     pay("ORD-021026-002", "Передоплата", 3000, { method: "Готівка", me: true }),
     pay("ORD-021026-002", "Повернення клієнту", 3000, { method: "Готівка", me: true }),
     pay("ORD-031026-003", "Передоплата", 2000, { method: "Готівка", me: true }),
     pay("ORD-031026-003", "Частка підряднику", 1200, { method: "Готівка" })],
    [{ type: "Взяв собі", amount: 300 }, { type: "Коригування після перерахунку", amount: -50 }]);
  const box = ctx.adminCashBox_();
  assert.equal(box.cash.deposits, 1000, "передоплата до «Виготовлення» — не вільні гроші");
  assert.equal(box.cash.expected, 1000 + 3000 - 3000 + 2000 - 1200 - 300 - 50);
  assert.equal(box.cancelled_held.length, 1, "скасоване ORD-003: 2000 − 1200 компенсації = 800 ще у власника");
  assert.equal(box.cancelled_held[0].amount, 800);
  assert.equal(box.cash.free, box.cash.expected - 1000 - 800, "скасовані з грошима клієнта — не вільні");
  assert.equal(box.owner_owes, 0, "скасовані до боргів не входять");
  // Запис каси: повтор із тим самим ID — без дубля; нуль не приймається.
  const r1 = ctx.adminCashAdd_({ entry: { type: "Взяв собі", amount: 100, request_id: "cash-req-1" } });
  const r2 = ctx.adminCashAdd_({ entry: { type: "Взяв собі", amount: 100, request_id: "cash-req-1" } });
  assert.equal(r2.duplicate, true);
  assert.equal(r1.box.cash.expected, box.cash.expected - 100);
  assert.throws(() => ctx.adminCashAdd_({ entry: { type: "Взяв собі", amount: 0 } }), /суму/);
  assert.throws(() => ctx.adminCashAdd_({ entry: { type: "Подарунок", amount: 10 } }), /Невідомий/);
}

// ── 6. Платіж «Я» на картку — не готівка: у касу не йде, але борг рахується ──
{
  const { ctx } = setup(
    [{ num: "ORD-011026-001", revenue: 5000, profit: 1500 }],
    [pay("ORD-011026-001", "Оплата повністю", 5000, { method: "На карту", me: true })]);
  const box = ctx.adminCashBox_();
  assert.equal(box.cash.expected, 0);
  assert.equal(box.owner_owes, 3500);
  // «Маржа від підрядника» з позначкою «Я» позначку не зберігає (вона лише для грошей клієнта).
  ctx.adminAddPayment_({ payment: { order_number: "ORD-011026-001", type: "Маржа від підрядника", amount: 10, recipient: "Я", method: "На карту" } });
  const last = ctx.readPayments_("ORD-011026-001").pop();
  assert.equal(last.recipient, "");
  // Вручну ID розрахунку підставити не можна.
  assert.throws(() => ctx.adminAddPayment_({ payment: { order_number: "ORD-011026-001", type: "Доплата", amount: 10, request_id: "settle:x:1" } }), /ID/);
}

// ── 8. Зауваження перевірки коду ──
{
  // Копійки: два замовлення з маржею 3002,40 — повний розрахунок проходить точною сумою від сервера.
  const { ctx } = setup(
    [{ num: "ORD-011026-001", revenue: 10000, profit: 3336, pct: 10 },
     { num: "ORD-021026-002", revenue: 10000, profit: 3336, pct: 10 },
     { num: "ORD-031026-003", revenue: 1000, profit: 300 }],
    [pay("ORD-011026-001", "Оплата повністю", 10000, { method: "На рахунок ТОВ" }),
     pay("ORD-021026-002", "Оплата повністю", 10000, { method: "На рахунок ТОВ" }),
     pay("ORD-031026-003", "Оплата повністю", 1000, { method: "Готівка", me: true })]);
  const box = ctx.adminCashBox_();
  assert.equal(box.settle.contractor, 6004, "3002,40 → 3002 по кожному замовленню");
  assert.equal(box.settle.owner, 700);
  assert.equal(box.settle.rest, 5304);
  assert.equal(box.settle.direction, "to_owner");
  // Борги змінились після відкриття «Каси» — розрахунок не проводиться.
  assert.throws(() => ctx.adminCashSettle_({ settlement_id: "sett-0030", amount: 5304, method: "Готівка",
    expect: { contractor: 6004, owner: 0, direction: "to_owner" } }), /змінились/);
  const ok = ctx.adminCashSettle_({ settlement_id: "sett-0031", amount: 5304, method: "Готівка",
    expect: { contractor: 6004, owner: 700, direction: "to_owner" } });
  assert.equal(ok.left, 0);
  assert.equal(ok.box.contractor_owes, 0, "копійки після округлення — не борг");
  assert.equal(ok.box.owner_owes, 0);
}
{
  // Без грошей власника — без його боргу: збиткове замовлення і переплачена маржа.
  const { ctx } = setup(
    [{ num: "ORD-011026-001", revenue: 9500, profit: -500 },
     { num: "ORD-021026-002", revenue: 10000, profit: 2700 }],
    [pay("ORD-011026-001", "Оплата повністю", 9500),
     pay("ORD-021026-002", "Оплата повністю", 10000),
     pay("ORD-021026-002", "Маржа від підрядника", 3000)]);
  assert.equal(group(ctx, "ORD-011026-001").owner_owes, 0);
  assert.equal(group(ctx, "ORD-021026-002").owner_owes, 0);
  assert.equal(ctx.adminCashBox_().owner_owes, 0);
}
{
  // Скасоване: клієнт платив підряднику, повернули ви з каси — підрядник винен вам.
  const { ctx } = setup(
    [{ num: "ORD-011026-001", revenue: 10000, profit: 3000, status: "Скасовано" }],
    [pay("ORD-011026-001", "Оплата повністю", 10000),
     pay("ORD-011026-001", "Повернення клієнту", 10000, { method: "Готівка", me: true })]);
  const box = ctx.adminCashBox_();
  assert.equal(box.cash.expected, -10000);
  assert.equal(box.cancelled_refunded.length, 1);
  assert.equal(box.cancelled_refunded[0].amount, 10000);
}
{
  // До «Виготовлення» «Маржу отримано ✓» не ставиться навіть якщо готівки у вас більше за маржу;
  // прогноз комісії — від суми замовлення, а не від уже сплаченого.
  const { ctx, sheets } = setup(
    [{ num: "ORD-011026-001", revenue: 5000, profit: 1500, status: "Нове" },
     { num: "ORD-021026-002", revenue: 10000, profit: 6000, pct: 30, status: "Виготовлення" }],
    [pay("ORD-011026-001", "Оплата повністю", 5000, { method: "Готівка", me: true }),
     pay("ORD-021026-002", "Передоплата", 5000, { method: "Готівка", me: true })]);
  ctx.syncOrderPaymentState_("ORD-011026-001");
  assert.notEqual(sheets["Замовлення"].data[1][33], true);
  const g = group(ctx, "ORD-021026-002");
  assert.equal(g.margin_commission_eff, 900, "комісія 1800 × (1 − 5000/10000)");
  assert.equal(g.margin_due, 5100);
  assert.equal(g.margin_kept, 0, "клієнт не доплатив — маржа ще не «отримана»");
  // Коли доплатить підряднику — те саме число, без «стрибка».
  const after = setup(
    [{ num: "ORD-021026-002", revenue: 10000, profit: 6000, pct: 30 }],
    [pay("ORD-021026-002", "Передоплата", 5000, { method: "Готівка", me: true }), pay("ORD-021026-002", "Доплата", 5000)]);
  const g2 = group(after.ctx, "ORD-021026-002");
  assert.equal(g2.margin_due, 5100);
  assert.equal(g2.margin_left, 100, "5100 − 5000 у власника");
  assert.equal(g2.margin_kept, 5000, "маржа в готівці власника — уже отримана");
}
{
  // «я» малою літерою — теж власник; запис каси видаляється лише з тим самим типом і сумою.
  const { ctx, sheets } = setup([{ num: "ORD-011026-001", revenue: 5000, profit: 1500 }],
    [pay("ORD-011026-001", "Оплата повністю", 5000, { method: "Готівка" })],
    [{ type: "Взяв собі", amount: 300 }]);
  sheets["Платежі"].data[1][7] = "я";
  assert.equal(ctx.readPayments_("ORD-011026-001")[0].recipient, "Я");
  assert.throws(() => ctx.adminCashDelete_({ row: 2, type: "Взяв собі", amount: 999 }), /змінився/);
  assert.equal(ctx.adminCashDelete_({ row: 2, type: "Взяв собі", amount: 300 }).status, "ok");
  // «Частку підряднику» менеджер не видаляє.
  ctx.adminAddPayment_({ payment: { order_number: "ORD-011026-001", type: "Частка підряднику", amount: 100, method: "Готівка" } });
  const row = ctx.readPayments_("ORD-011026-001").find((p) => p.type === "Частка підряднику").row;
  assert.throws(() => ctx.adminDeletePayment_({ row, order_number: "ORD-011026-001" }), /лише власник/);
  assert.equal(ctx.adminDeletePayment_({ row, order_number: "ORD-011026-001", is_owner: true }).status, "ok");
}
{
  // Акт: колонка «у Avalon» складає рядок; для менеджера — без грошей власника.
  const { ctx } = setup(
    [{ num: "ORD-011026-001", revenue: 10000, profit: 3000 },
     { num: "ORD-021026-002", revenue: 5000, profit: 1500 }],
    [pay("ORD-011026-001", "Передоплата", 1000, { method: "Готівка", me: true }),
     pay("ORD-011026-001", "Доплата", 9000),
     pay("ORD-021026-002", "Оплата повністю", 5000, { method: "Готівка", me: true })]);
  const act = ctx.settlementData_({});
  const r = act.due.find((x) => x.order_number === "ORD-011026-001");
  assert.equal(r.held, 1000);
  assert.equal(r.margin_due - r.margin_received - r.held, r.margin_left, "рядок складається");
  assert.equal(act.owner_due.length, 1);
  const forManager = ctx.settlementData_({ for_manager: true });
  assert.equal(forManager.owner_due.length, 0);
  assert.equal(forManager.due.find((x) => x.order_number === "ORD-011026-001").held, 0);
}

// ── 7. Сервер кабінету: каса — лише власник; «Частка підряднику» — лише власник ──
(async () => {
  process.env.ADMIN_PASSWORD = "owner-password";
  process.env.ADMIN_SESSION_SECRET = "session-secret-for-tests";
  process.env.MANAGER_PASSWORD = "manager-password";
  const sheetsPath = require.resolve("../lib/admin-sheets");
  const real = require(sheetsPath);
  const calls = [];
  require.cache[sheetsPath].exports = {
    sendError: real.sendError, TIMING: real.TIMING,
    callAdminSheets: async (action, payload) => { calls.push({ action, payload }); return { status: "ok" }; },
  };
  delete require.cache[require.resolve("../lib/admin-cash-handler")];
  delete require.cache[require.resolve("../api/admin/payments")];
  const handler = require("../api/admin/payments");
  const { issueToken } = require("../lib/admin-auth");
  const owner = "Bearer " + issueToken(true, "owner");
  const manager = "Bearer " + issueToken(true, "manager");
  async function call(method, query, body, auth) {
    const res = { statusCode: 200, headers: {}, body: null, setHeader(k, v) { this.headers[k] = v; },
      status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; }, end() { return this; } };
    await handler({ method, query: query || {}, body, headers: auth ? { authorization: auth } : {} }, res);
    return res;
  }
  assert.equal((await call("GET", { resource: "cash" })).statusCode, 401);
  assert.equal((await call("GET", { resource: "cash" }, null, manager)).statusCode, 403, "менеджер касу не бачить");
  assert.equal((await call("POST", { resource: "cash" }, { action: "settle", settlement_id: "sett-0001", amount: 10 }, manager)).statusCode, 403);
  assert.equal((await call("GET", { resource: "cash" }, null, owner)).statusCode, 200);
  assert.equal(calls.pop().action, "cash_box");
  // Перевірка введеного.
  assert.equal((await call("POST", { resource: "cash" }, { action: "add", type: "Подарунок", amount: 5 }, owner)).statusCode, 400);
  assert.equal((await call("POST", { resource: "cash" }, { action: "add", type: "Взяв собі", amount: -5 }, owner)).statusCode, 400);
  assert.equal((await call("POST", { resource: "cash" }, { action: "settle", settlement_id: "x", amount: 5 }, owner)).statusCode, 400);
  assert.equal((await call("POST", { resource: "cash" }, { action: "settle", settlement_id: "sett-0001", amount: -5 }, owner)).statusCode, 400);
  const ok = await call("POST", { resource: "cash" }, { action: "settle", settlement_id: "sett-0001", amount: 1500.4, method: "Готівка", date: "2026-11-02" }, owner);
  assert.equal(ok.statusCode, 200);
  assert.deepEqual(calls.pop(), { action: "cash_settle", payload: { settlement_id: "sett-0001", amount: 1500, method: "Готівка", date: "2026-11-02" } });
  // Платежі: менеджер вносить оплату з «Хто отримав: Я», але не «Частку підряднику».
  const mine = await call("POST", {}, { payment: { order_number: "ORD-011026-001", type: "Доплата", amount: 100, recipient: "Я" } }, manager);
  assert.equal(mine.statusCode, 201);
  assert.equal(calls.pop().payload.payment.recipient, "Я");
  assert.equal((await call("POST", {}, { payment: { order_number: "ORD-011026-001", type: "Частка підряднику", amount: 100 } }, manager)).statusCode, 403);
  assert.equal((await call("POST", {}, { payment: { order_number: "ORD-011026-001", type: "Частка підряднику", amount: 100 } }, owner)).statusCode, 201);
  assert.equal((await call("POST", {}, { payment: { order_number: "ORD-011026-001", type: "Доплата", amount: 100, request_id: "settle:a:1" } }, owner)).statusCode, 400);
  console.log("cash tests: OK");
})().catch((err) => { console.error(err); process.exit(1); });
