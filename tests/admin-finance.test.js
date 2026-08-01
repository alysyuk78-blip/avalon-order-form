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

testPaymentMetrics();
testStandardRecalculationClearsStaleDiscount();
testPaymentDeletionChecksStableIdentity();
console.log("admin-finance tests: OK");
