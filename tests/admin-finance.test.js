const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { groupPaymentMetrics } = require("../lib/admin-finance");

function testPaymentMetrics() {
  assert.deepEqual(
    groupPaymentMetrics({
      revenue: 5000,
      profit: 1000,
      client_left: 0,
      margin_received: 400,
      margin_left: 600,
    }),
    {
      clientSettled: true,
      marginReady: 1000,
      marginReceived: 400,
      marginDebt: 600,
      marginLeft: 600,
    },
    "частково отримана маржа має ділитися на факт і залишок"
  );

  const beforeClientSettlement = groupPaymentMetrics({
    revenue: 5000,
    profit: 1000,
    client_left: 500,
    margin_received: 400,
    margin_left: 600,
  });
  assert.equal(beforeClientSettlement.marginReceived, 400);
  assert.equal(beforeClientSettlement.marginReady, 0);
  assert.equal(beforeClientSettlement.marginDebt, 0);

  const legacy = groupPaymentMetrics({ revenue: 5000, profit: 1000, client_paid: true, margin_paid: true });
  assert.equal(legacy.marginReceived, 1000);
  assert.equal(legacy.marginDebt, 0);

  const repriced = groupPaymentMetrics({
    revenue: 6000,
    profit: 1200,
    client_left: 0,
    margin_received: 1000,
    margin_left: 200,
  });
  assert.equal(repriced.marginDebt, 200, "після перерахунку борг має дорівнювати новому залишку");
}

function loadAppsScript() {
  const code = fs.readFileSync(path.join(__dirname, "..", "google-apps-script-v2.js"), "utf8");
  const context = vm.createContext({ console });
  vm.runInContext(code, context);
  return context;
}

function testStandardRecalculationClearsStaleDiscount() {
  const context = loadAppsScript();
  const writes = {};
  const row = new Array(17).fill("");
  row[7] = "Стандарт";
  row[8] = "Суцільний";
  row[10] = "K1";
  row[13] = 1000;
  row[14] = 1000;
  row[15] = 500;
  row[16] = 2;

  const sheet = {
    getMaxColumns: () => 45,
    getRange(_row, column, _rows, columns) {
      if (column === 42) return { getValue: () => "Кошик" };
      if (column === 1 && columns === 17) return { getValues: () => [row] };
      return {
        setValues(values) {
          writes[column] = values[0];
          return this;
        },
      };
    },
  };

  context.recalcRow_(sheet, 2);
  assert.equal(writes[18].length, 7);
  assert.deepEqual(Array.from(writes[35]), [writes[18][4], 0, 0], "прайс і знижка мають відповідати новій виручці");
}

function testPaymentDeletionChecksStableIdentity() {
  const context = loadAppsScript();
  let deleted = false;
  const sheet = {
    getLastRow: () => 5,
    getRange: () => ({
      getValues: () => [["ORD-010126-001", "Передоплата", 300, "Готівка", "", "payment-1"]],
    }),
    deleteRow: () => { deleted = true; },
  };
  context.paymentsSheet_ = () => sheet;
  context.syncOrderPaymentState_ = () => ({});
  context.readPayments_ = () => [];
  context.SpreadsheetApp = { flush() {} };

  assert.throws(() => context.adminDeletePayment_({
    row: 2,
    order_number: "ORD-010126-001",
    payment_request_id: "another-payment",
  }), /Список платежів змінився/);
  assert.equal(deleted, false);

  context.adminDeletePayment_({
    row: 2,
    order_number: "ORD-010126-001",
    payment_request_id: "payment-1",
  });
  assert.equal(deleted, true);
}

function testBootstrapReadsPaymentsOnce() {
  const context = loadAppsScript();
  let paymentReads = 0;
  context.readPayments_ = () => {
    paymentReads += 1;
    return [{ order_number: "ORD-010126-001", type: "Передоплата", amount: 300 }];
  };
  context.adminListOrders_ = data => {
    assert.equal(Array.isArray(data._payments), true, "bootstrap має передати вже прочитані платежі");
    return { status: "ok", orders: [], groups: [] };
  };
  context.adminListExpenses_ = () => ({ status: "ok", expenses: [] });
  context.adminListPayouts_ = () => ({ status: "ok", payouts: [] });

  const result = context.adminBootstrap_({});
  assert.equal(result.status, "ok");
  assert.equal(result.payments.length, 1);
  assert.equal(paymentReads, 1, "bootstrap не повинен повторно читати журнал платежів");
}

function testOrderDetailReadsOnlyMatchedRows() {
  const context = loadAppsScript();
  const row = new Array(45).fill("");
  row[0] = "ORD-010126-001";
  row[2] = "В роботі";
  row[4] = "Тест";
  row[16] = 1;
  row[19] = 800;
  row[21] = 1000;
  row[22] = 200;
  const fullReads = [];
  const sheet = {
    getLastRow: () => 20,
    getRange(r, c, rows, cols) {
      if (r === 2 && c === 1 && rows === 19 && cols === 1) {
        return {
          createTextFinder: value => ({
            matchEntireCell: exact => ({
              findAll: () => {
                assert.equal(value, "ORD-010126-001");
                assert.equal(exact, true);
                return [{ getRow: () => 7 }];
              },
            }),
          }),
        };
      }
      if (r === 7 && c === 1 && rows === 1 && cols === 45) {
        fullReads.push(r);
        return { getValues: () => [row] };
      }
      throw new Error(`Неочікуване читання ${r}:${c}:${rows}:${cols}`);
    },
  };
  context.adminOrdersSheet_ = () => sheet;
  context.readPayments_ = () => [];

  const result = context.adminGetOrder_({ order_number: "ORD-010126-001" });
  assert.equal(result.status, "ok");
  assert.equal(result.items.length, 1);
  assert.deepEqual(fullReads, [7], "картка має читати лише знайдений рядок");
}

testPaymentMetrics();
testStandardRecalculationClearsStaleDiscount();
testPaymentDeletionChecksStableIdentity();
testBootstrapReadsPaymentsOnce();
testOrderDetailReadsOnlyMatchedRows();
console.log("admin-finance tests: OK");
