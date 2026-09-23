const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const {
  groupPaymentMetrics,
  commissionRate,
  marginBreakdown,
  requiredPriceForNetMargin,
} = require("../lib/admin-finance");

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
      owed: true,
      marginDue: 1000,
      marginForecast: 0,
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

  // До погодження («Нове», «В опрацюванні підрядником») маржа — прогноз, а не борг.
  ["Нове", "В опрацюванні підрядником", "Скасовано"].forEach((status) => {
    const m = groupPaymentMetrics({ status, revenue: 5000, profit: 1000, client_left: 0, margin_received: 0, margin_left: 1000 });
    assert.equal(m.owed, false, status + ": маржа ще не до виплати");
    assert.equal(m.marginLeft, 0, status + ": без «до отримання»");
    assert.equal(m.marginDebt, 0, status + ": без боргу підрядника");
    assert.equal(m.marginReady, 0);
    assert.equal(m.marginDue, 0, status + ": не входить у суму до виплати");
    assert.equal(m.marginForecast, 1000, status + ": лишається як прогноз");
  });
  ["Виготовлення", "В роботі", "Готове", "Відправлено", "Завершено"].forEach((status) => {
    const m = groupPaymentMetrics({ status, revenue: 5000, profit: 1000, client_left: 0, margin_received: 0, margin_left: 1000 });
    assert.equal(m.owed, true, status + ": з цього етапу маржа до виплати");
    assert.equal(m.marginDebt, 1000);
  });
  assert.equal(groupPaymentMetrics({ status: "Нове", margin_owed: true, revenue: 5000, profit: 1000, client_left: 0, margin_left: 1000 }).marginDebt, 1000,
    "явний прапорець із сервера має пріоритет");
}

function loadAppsScript(extra) {
  const code = fs.readFileSync(path.join(__dirname, "..", "google-apps-script-v2.js"), "utf8");
  const context = vm.createContext(Object.assign({ console }, extra || {}));
  vm.runInContext(code, context);
  return context;
}

// Ковш, пергола, стенд — не кошики: ціну веде менеджер, тож розкладка «м² × ₴/м²»
// у повідомленні підряднику для них не має зʼявлятися.
// Підрядник має одразу бачити, скільки перерахувати Avalon, — без власних розрахунків.
function testContractorMessageShowsMarginToPay() {
  const context = loadAppsScript({ Utilities: { formatDate: () => "11.09.2026, 10:18" }, Date });
  const plain = (o) => context.buildProductionMsg_(Object.assign({
    order_number: "ORD-070926-003", first_name: "Олександр", phone: "+380000000000",
  }, o)).replace(/<[^>]+>/g, "");
  const other = (extra) => Object.assign({ product_type: "other", basket_model_name: "Ковш", quantity: 1 }, extra);

  // Ковш через ТОВ, 30% від маржі — цифри з реального ORD-070926-003.
  const tov = plain({ commission_pct: 30, payment_method: "На рахунок ТОВ",
    items: [other({ cost_total: 9650, revenue: 13790, profit: 4140, commission: 1242 })] });
  assert.ok(tov.includes("Ціна для клієнта: 13 790 ₴"));
  assert.ok(tov.includes("Маржа: 13 790 − 9 650 = 4 140 ₴"), "маржа показана разом з арифметикою");
  assert.ok(tov.includes("Комісія (30% від маржі): − 1 242 ₴"));
  assert.ok(tov.includes("До виплати Avalon: 2 898 ₴"));
  assert.ok(tov.includes("після повної оплати клієнтом"));
  assert.equal(tov.split("Вартість виробнича").length - 1, 1, "собівартість не дублюється");
  assert.ok(tov.indexOf("Оплата: На рахунок ТОВ") < tov.indexOf("МАРЖА AVALON"),
    "спосіб оплати — у фінансах, а не всередині блоку маржі");

  // Половина гривні: рядки мають сходитися до копійки.
  const half = plain({ commission_pct: 30,
    items: [other({ cost_total: 9650, revenue: 12545, profit: 2895, commission: 868.5 })] });
  assert.ok(half.includes("− 868,50 ₴"));
  assert.ok(half.includes("До виплати Avalon: 2 026,50 ₴"));

  // Дропшиперська комісія (ставки AT немає) борг підрядника не зменшує і не показується.
  const drop = plain({ items: [other({ cost_total: 3500, revenue: 5000, profit: 1500, commission: 150 })] });
  assert.ok(!drop.includes("Комісія ("), "дропшиперську комісію підряднику не показуємо");
  assert.ok(drop.includes("До виплати Avalon: 1 500 ₴"));

  // Ціну ще не погоджено — блоку маржі немає.
  const noPrice = plain({ items: [other({ cost_total: 0, revenue: 0, profit: 0, commission: 0 })] });
  assert.ok(!noPrice.includes("МАРЖА AVALON"));

  // Збиткова угода: виплати немає.
  const loss = plain({ commission_pct: 30,
    items: [other({ cost_total: 10000, revenue: 9000, profit: -1000, commission: 0 })] });
  assert.ok(loss.includes("Маржі до виплати немає"));
  assert.ok(!loss.includes("До виплати Avalon"));
}

function testProductionMessageSkipsBasketRateForOtherProducts() {
  const context = loadAppsScript({
    Utilities: { formatDate: () => "11.09.2026, 10:18" },
    Date,
  });
  const base = { order_number: "ORD-070926-003", first_name: "Олександр", phone: "+380000000000" };

  const other = context.buildProductionMsg_(Object.assign({}, base, {
    items: [{
      product_type: "other", basket_model_name: "Ковш для трактора",
      size_w: 1000, size_h: 500, size_d: 660, quantity: 1, unit: "шт.", cost_total: 9650,
    }],
  }));
  assert.ok(!/₴\/м²/.test(other), "для довільного виробу не має бути ціни за м²");
  assert.ok(!/Кошик:/.test(other), "довільний виріб не можна називати кошиком");
  assert.ok(/Вартість виробнича/.test(other) && /9\s*650/.test(other), "собівартість менеджера лишається");

  const bracket = context.buildProductionMsg_(Object.assign({}, base, {
    items: [{
      product_type: "bracket", basket_model_name: "AVL-K-01",
      size_w: 500, size_h: 500, size_d: 500, quantity: 3, unit: "комп.", cost_total: 1800,
    }],
  }));
  assert.ok(!/₴\/м²/.test(bracket), "кронштейни теж не рахуються за площею кошика");

  // Кошик рахується як раніше.
  const basket = context.buildProductionMsg_(Object.assign({}, base, {
    items: [{
      product_type: "basket", basket_type: "Стандарт",
      construction_type: "Суцільний · AVL-01 + кришка", has_cover: true,
      size_w: 1000, size_h: 500, size_d: 300, quantity: 2, unit: "шт.",
    }],
  }));
  assert.ok(/Кошик: 0\.8 м² × <b>2 030 ₴\/м²<\/b> × 2 шт\. = <b>3 248 ₴<\/b>/.test(basket),
    "кошик має лишитись із розкладкою по м², з кількістю у формулі");
  assert.ok(/Верхня кришка: 0\.3 м² × <b>1 920 ₴\/м²<\/b> × 2 шт\./.test(basket));
  assert.ok(!/Знімна бічна панель/.test(basket), "AVL-01 — без знімної панелі");
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
    getMaxColumns: () => 48,
    getRange(_row, column, _rows, columns) {
      if (column === 42) return { getValue: () => "Кошик" };
      if (column === 41) return { getValue: () => "" };
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

// AVL-04 «Зі знімною боковиною»: + бічна панель (висота × глибина), як у калькуляторі.
function testRemovableSidePanelPricing() {
  const context = loadAppsScript();
  const recalc = (construction, model) => {
    const writes = {};
    const row = new Array(17).fill("");
    row[8] = construction; row[10] = "K1"; row[13] = 800; row[14] = 550; row[15] = 500; row[16] = 2;
    context.recalcRow_({
      getMaxColumns: () => 49,
      getRange(_r, column, _rows, columns) {
        if (column === 42) return { getValue: () => "Кошик" };
        if (column === 41) return { getValue: () => model };
        if (column === 1 && columns === 17) return { getValues: () => [row] };
        return { setValues(values) { writes[column] = values[0]; return this; } };
      },
    }, 2);
    return writes[18];
  };
  const avl04 = recalc("Суцільний · AVL-04", "Зі знімною боковиною");
  assert.equal(avl04[0], 1.27, "площа: 0,99 (лицева + 2 боковини) + 0,275 (знімна панель), до сотих");
  assert.equal(avl04[2], 5136, "собівартість 2 кошиків: 4 019 + 1 117 = 5 136, як у калькуляторі");
  const byName = recalc("Суцільний", "Зі знімною боковиною");
  assert.equal(byName[2], 5136, "модель впізнається і за назвою");
  const avl01 = recalc("Суцільний · AVL-01", "Суцільний");
  assert.equal(avl01[2], 4019, "інші моделі — без знімної панелі");

  // Контекстний тест повідомлення підряднику: окремий рядок і сума, що сходиться.
  const ctx = loadAppsScript({ Utilities: { formatDate: () => "23.09.2026, 18:21" }, Date });
  const msg = ctx.buildProductionMsg_({
    order_number: "ORD-210926-016",
    items: [{ product_type: "basket", construction_type: "Суцільний · AVL-04", basket_model_name: "Зі знімною боковиною",
      size_w: 800, size_h: 550, size_d: 500, quantity: 2, unit: "шт.", cost_total: 5136 }],
  }, { finance: true });
  assert.ok(msg.includes("• Кошик: 0.99 м² × <b>2 030 ₴/м²</b> × 2 шт. = <b>4 019 ₴</b>"));
  assert.ok(msg.includes("• Знімна бічна панель: 0.275 м² × <b>2 030 ₴/м²</b> × 2 шт. = <b>1 117 ₴</b>"));
  assert.ok(msg.includes("• Вартість виробнича: <b>5 136 ₴</b>"));
  assert.ok(!msg.includes("Коригування"), "рядки сходяться — без коригування");

  // Менеджер вписав іншу суму — різниця видна окремим рядком.
  const edited = ctx.buildProductionMsg_({
    order_number: "X",
    items: [{ product_type: "basket", construction_type: "Суцільний · AVL-01", size_w: 800, size_h: 550, size_d: 500, quantity: 2, unit: "шт.", cost_total: 4500 }],
  }, { finance: true });
  assert.ok(edited.includes("• Коригування менеджера: <b>+481 ₴</b>"), "4 019 + 481 = 4 500");

  // Площа з повною точністю: показані множники дають показану суму (810×550×500).
  const precise = ctx.buildProductionMsg_({
    order_number: "X",
    items: [{ product_type: "basket", construction_type: "Суцільний · AVL-01", size_w: 810, size_h: 550, size_d: 500, quantity: 2, unit: "шт." }],
  }, { finance: true });
  assert.ok(precise.includes("• Кошик: 0.9955 м² × <b>2 030 ₴/м²</b> × 2 шт. = <b>4 042 ₴</b>"), "0,9955 × 2 030 × 2 = 4 041,73 → 4 042");
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
  const row = new Array(49).fill("");
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
      if (r === 7 && c === 1 && rows === 1 && cols === 49) {
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

// ── Комісія з маржі (ТОВ): 4 кейси з ТЗ власника ───────────────────────────
function round2(n) { return Math.round(n * 100) / 100; }

function testCommissionFromMargin() {
  // 1. Прямий розрахунок: 30% від маржі, а не від ціни.
  const direct = marginBreakdown({ cost: 9650, price: 12545, commissionPct: 30 });
  assert.equal(direct.grossMargin, 2895);
  assert.equal(round2(direct.commission), 868.5);
  assert.equal(round2(direct.netMargin), 2026.5);
  assert.equal(direct.loss, false);

  // 2. Зворотний: щоб чистими лишилось 2895 ₴, ціна росте лише на 9,89%.
  const back = requiredPriceForNetMargin({ cost: 9650, price: 12545, targetNetMargin: 2895, commissionPct: 30 });
  assert.equal(round2(back.requiredGrossMargin), 4135.71);
  assert.equal(round2(back.requiredPrice), 13785.71);
  assert.equal(back.requiredPriceRounded, 13790, "прайс округляємо ВГОРУ до 10 ₴");
  assert.equal(Math.round(back.priceUplift * 10000) / 100, 9.89);
  assert.equal(Math.round(back.marginUplift * 10000) / 100, 42.86);
  // Головна перевірка з ТЗ: (13785.71 − 9650) × 0.7 = 2895
  assert.equal(round2((back.requiredPrice - 9650) * 0.7), 2895);
  // І типова помилка, якої не робимо: ділити всю ціну.
  assert.notEqual(round2(back.requiredPrice), round2(12545 / 0.7));

  // 3. Вироджений випадок cost = 0: комісія з маржі = комісія з ціни (+42,86%).
  const zeroCost = requiredPriceForNetMargin({ cost: 0, price: 3000, targetNetMargin: 3000, commissionPct: 30 });
  assert.equal(round2(zeroCost.requiredPrice), 4285.71);
  assert.equal(Math.round(zeroCost.priceUplift * 10000) / 100, 42.86);

  // 4. Збиткова угода: комісії немає, чиста маржа = брутто, прапорець «збиткова».
  const loss = marginBreakdown({ cost: 10000, price: 9000, commissionPct: 30 });
  assert.equal(loss.grossMargin, -1000);
  assert.equal(loss.commission, 0);
  assert.equal(loss.netMargin, -1000);
  assert.equal(loss.loss, true);

  // Валідація ставки
  assert.equal(commissionRate(0), 0);
  assert.equal(commissionRate(""), 0, "порожня ставка = 0%, а не помилка");
  assert.equal(commissionRate(-1), null);
  assert.equal(commissionRate(100), null, "ставка 100% не лишає маржі");
  assert.equal(commissionRate(150), null);
  assert.equal(requiredPriceForNetMargin({ cost: 100, targetNetMargin: 50, commissionPct: 100 }).valid, false);
  assert.equal(marginBreakdown({ cost: 100, price: 200, commissionPct: 120 }).rateValid, false);
  assert.equal(marginBreakdown({ cost: 100, price: 200, commissionPct: 120 }).commission, 0,
    "некоректна ставка не має тихо зменшувати маржу");

  // Без ставки поведінка не змінюється (усі наявні замовлення).
  const noRate = marginBreakdown({ cost: 9650, price: 12545 });
  assert.equal(noRate.commission, 0);
  assert.equal(noRate.netMargin, 2895);
}

// Комісію утримує підрядник → на неї зменшується саме ЙОГО борг.
function testContractorDebtIsNetOfCommission() {
  const withCommission = groupPaymentMetrics({
    revenue: 12545, profit: 2895, commission: 868.5, commission_pct: 30, client_left: 0,
  });
  assert.equal(withCommission.marginDue, 2026.5, "підрядник винен валовий мінус комісія");
  assert.equal(withCommission.marginReady, 2026.5);
  assert.equal(withCommission.marginLeft, 2026.5);
  assert.equal(withCommission.marginDebt, 2026.5);

  // Часткове надходження зменшує саме чистий борг.
  const partly = groupPaymentMetrics({
    revenue: 12545, profit: 2895, commission: 868.5, commission_pct: 30, client_left: 0, margin_received: 1000,
  });
  assert.equal(partly.marginLeft, 1026.5);

  // Стара галочка «Маржу отримано» закриває чистий борг, а не валовий.
  const legacyPaid = groupPaymentMetrics({
    revenue: 12545, profit: 2895, commission: 868.5, commission_pct: 30, client_paid: true, margin_paid: true,
  });
  assert.equal(legacyPaid.marginReceived, 2026.5);
  assert.equal(legacyPaid.marginDebt, 0);

  // Готовий margin_due з таблиці має пріоритет над локальним обчисленням.
  assert.equal(groupPaymentMetrics({ revenue: 100, profit: 40, commission: 10, commission_pct: 25, margin_due: 25 }).marginDue, 25);

  // ⚠️ Комісія дропшипера (без ставки) НЕ зменшує борг підрядника: її платить Avalon.
  const dropshipper = groupPaymentMetrics({ revenue: 5000, profit: 1000, commission: 150, client_left: 0 });
  assert.equal(dropshipper.marginDue, 1000, "комісія дропшипера не зменшує борг підрядника");
  assert.equal(dropshipper.marginDebt, 1000);

  // Замовлення без комісії рахуються рівно як раніше.
  const plain = groupPaymentMetrics({ revenue: 5000, profit: 1000, client_left: 0 });
  assert.equal(plain.marginDue, 1000);
  assert.equal(plain.marginDebt, 1000);

  // Збиткова угода: комісії немає, борг від'ємним не стає.
  const loss = groupPaymentMetrics({ revenue: 9000, profit: -1000, commission: 0, commission_pct: 30, client_left: 0 });
  assert.equal(loss.marginDue, -1000);
  assert.equal(loss.marginLeft, 0, "від'ємний борг підрядника не нараховуємо");
}

// Та сама арифметика в Apps Script.
function testSheetMarginDue() {
  const context = loadAppsScript();
  assert.equal(context.marginDue_(2895, 868.5, 30), 2026.5);
  assert.equal(context.marginDue_(2895, 0, 30), 2895);
  assert.equal(context.marginDue_(2895, null, 30), 2895);
  assert.equal(context.marginDue_(-1000, 300, 30), -1000, "зі збиткової угоди комісію не віднімаємо");
  assert.equal(context.marginDue_(500, 900, 30), 0, "борг не може стати відʼємним");
  // Без ставки AT комісія в Y — дропшиперська, борг підрядника вона не зменшує.
  assert.equal(context.marginDue_(1000, 150, null), 1000);
  assert.equal(context.marginDue_(1000, 150, 0), 1000);
}

// Формула в таблиці має давати ті самі цифри, що й розрахунок у CRM.
function testSheetCommissionFormula() {
  const context = loadAppsScript();

  assert.equal(context.normalizeCommissionPct_(""), null);
  assert.equal(context.normalizeCommissionPct_(null), null);
  assert.equal(context.normalizeCommissionPct_(30), 30);
  assert.equal(context.normalizeCommissionPct_("12.345"), 12.35);
  assert.throws(() => context.normalizeCommissionPct_(-1), /відʼємною/);
  assert.throws(() => context.normalizeCommissionPct_(100), /меншою за 100/);
  assert.throws(() => context.normalizeCommissionPct_("abc"), /числом/);

  const formulas = {};
  const sheet = {
    getRange: (_row, column) => ({
      setFormula(f) { formulas[column] = f; return this; },
      setNumberFormat() { return this; },
    }),
  };
  context.setCommissionFormulas_(sheet, 7);
  // Зі ставкою в AT — % від валового прибутку (W); без неї — стара логіка дропшиперів.
  assert.ok(formulas[25].includes("N($AT7)>0"), "формула має дивитись на ставку в AT");
  assert.ok(formulas[25].includes("$W7*$AT7/100"), "комісія = валовий прибуток × ставка");
  assert.ok(formulas[25].includes("$W7>0"), "зі збиткової угоди комісії немає");
  assert.ok(formulas[25].includes("VLOOKUP($D7;Дропшипери!$A:$E;5;0)"), "без ставки — як раніше");
  assert.equal(formulas[26], '=IF($W7="";"";$W7-$Y7)', "чистий прибуток = валовий − комісія");

  // Схема таблиці розширена до AT (46) — інакше читання картки впаде.
  assert.equal(context.ADMIN_ORDER_COLS, 49);  // …AW — причина скасування
  assert.equal(context.COMMISSION_PCT_COL, 46);

  // mapOrderRow_ має віддавати ставку в CRM.
  const row = new Array(49).fill("");
  row[0] = "ORD-010126-001";
  row[45] = 30;
  assert.equal(context.mapOrderRow_(7, row).commission_pct, 30);
}

testPaymentMetrics();
testCommissionFromMargin();
testContractorDebtIsNetOfCommission();
testSheetCommissionFormula();
testSheetMarginDue();
testProductionMessageSkipsBasketRateForOtherProducts();
testContractorMessageShowsMarginToPay();
testStandardRecalculationClearsStaleDiscount();
testRemovableSidePanelPricing();
testPaymentDeletionChecksStableIdentity();
testBootstrapReadsPaymentsOnce();
testOrderDetailReadsOnlyMatchedRows();
console.log("admin-finance tests: OK");
