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

// Рядок аркуша «Замовлення» для recalcRow_: { номер колонки: значення }.
function recalcSheet(cells) {
  const row = new Array(46).fill("");
  Object.keys(cells).forEach((col) => { row[Number(col) - 1] = cells[col]; });
  const writes = {};
  return {
    writes,
    sheet: {
      getMaxColumns: () => 50,
      getRange(_row, column, _rows, columns) {
        if (column === 1 && columns >= 43) return { getValues: () => [row.slice(0, columns)] };
        return { setValues(values) { writes[column] = Array.from(values[0]); return this; } };
      },
    },
  };
}

// Перерахунок рядка = калькулятор: ті самі числа, що в «Перевірці розрахунків» (ORD-051026-001).
function testRecalculationMatchesCalculator() {
  const context = loadAppsScript();
  const run = (cells) => { const s = recalcSheet(cells); context.recalcRow_(s.sheet, 2); return s.writes; };
  const avl05 = { 9: "Розбірний (з 3-х частин) · AVL-05", 14: 750, 15: 700, 16: 440, 17: 14, 41: "Розбірний", 42: "Кошик" };

  // 14 шт. зі знижкою 10 %: знижка НЕ губиться під час перерахунку.
  const w = run(Object.assign({}, avl05, { 36: 10 }));
  assert.deepEqual(w[18], [1.14, 2476, 34664, 3009, 42122, 7458, 17.7]);
  assert.deepEqual(w[35], [46802, 10, 4680], "прайс 3 343 × 14, знижка 10 % = 4 680 ₴");
  // Знижка, записана лише сумою (так було до єдиного алгоритму), теж лишається.
  assert.deepEqual(run(Object.assign({}, avl05, { 35: 46802, 37: 4680 }))[35], [46802, 10, 4680]);
  assert.deepEqual(run(avl05)[35], [46802, 0, 0]);

  // ТОВ / партнер: комісія 30 % з маржі → націнка 50 %, щоб чистими лишилось планові 35 %.
  const tov = run(Object.assign({}, avl05, { 46: 30 }));
  assert.equal(tov[18][3], 3714, "2 475,97 × 1,5 = 3 713,96 → 3 714 ₴ за од.");
  assert.equal(tov[18][4], 51996);
  const margin = tov[18][4] - tov[18][2];
  assert.ok(Math.abs(margin * 0.7 - 34664 * 0.35) < 14, "після комісії лишається ≈ 35 % собівартості");

  // Звичайний візерунок ціну не змінює.
  const plain = run({ 9: "Суцільний · AVL-01", 14: 1000, 15: 1000, 16: 500, 17: 2, 42: "Кошик" });
  const fancy = run({ 8: "Декоративний", 9: "Суцільний · AVL-01", 11: "K1", 14: 1000, 15: 1000, 16: 500, 17: 2, 42: "Кошик" });
  assert.deepEqual(fancy[18], plain[18]);
  // Складний візерунок дорожчий, а на скільки — рахується індивідуально: формула суми не чіпає.
  ["K3", "K4", "K6", "K8", "K9", "К3"].forEach((pattern) =>
    assert.deepEqual(run({ 9: "Суцільний · AVL-01", 11: pattern, 14: 1000, 15: 1000, 16: 500, 17: 2, 42: "Кошик" }), {}, pattern));
  // Антивандальний кошик теж рахується індивідуально.
  assert.deepEqual(run({ 8: "Антивандальний (більша товщина металу+ каркас)", 9: "Суцільний · AVL-01", 14: 1000, 15: 1000, 16: 500, 17: 2, 42: "Кошик" }), {});
  assert.equal(plain[18][2], 8120, "2 м² × 2 030 × 2");
  assert.equal(plain[18][4], 10962, "5 481 × 2 — націнка рівно 35 %");

  // Розміри округлюються вгору до 10 мм до площі: 805 рахується як 810.
  assert.deepEqual(run({ 9: "Суцільний · AVL-01", 14: 805, 15: 550, 16: 500, 17: 2, 42: "Кошик" })[18],
    run({ 9: "Суцільний · AVL-01", 14: 810, 15: 550, 16: 500, 17: 2, 42: "Кошик" })[18]);

  // Моделі за правилами калькулятора.
  const cost = (cells) => run(Object.assign({ 14: 800, 15: 500, 16: 500, 17: 1, 42: "Кошик" }, cells))[18][2];
  assert.equal(cost({ 9: "Суцільний · AVL-07" }), 2821, "закритий: 4 стінки × 2 170");
  assert.equal(cost({ 9: "Суцільний · AVL-03" }), 2497, "універсальний: 0,9 × 2 030 + кронштейни 800 × 1800/2150");
  assert.equal(cost({ 9: "Суцільний · AVL-03", 43: "Стінки: розбірні\nЗнімна бокова частина" }), 3130, "+ розбірні стінки й знімна боковина");
  assert.equal(cost({ 9: "Розбірна · AVL-02", 14: 800, 15: 540, 16: 100 }), 2796, "екран: 0,54 × 2 030 + кріплення 1 700");
  assert.equal(cost({ 9: "Суцільний · AVL-01 + кришка" }), 2595, "верхня кришка не перфорована: + 0,4 × 1 920");
  assert.equal(cost({ 9: "Суцільний · AVL-01", 43: "Верхня кришка: перфорована\nНижня кришка: не перфорована" }), 3407);
  assert.equal(cost({ 9: "Суцільний · AVL-01", 43: "Матеріал: Оцинкований метал" }), 3227, "+ 1 400 ₴");
  assert.equal(cost({ 9: "Суцільний · AVL-01", 43: "Матеріал: Алюміній" }), 3654, "× 2");

  // Не кошик і рядок без розмірів — не чіпаємо.
  assert.deepEqual(run({ 9: "Ковш", 14: 800, 15: 500, 17: 1, 42: "Інший виріб" }), {});
  assert.deepEqual(run({ 9: "Суцільний · AVL-01", 17: 1, 42: "Кошик" }), {});
}

// Гроші перераховуються лише коли змінилось те, від чого залежить ціна.
function testPricingSignature() {
  const context = loadAppsScript();
  const base = { construction: "Суцільний · AVL-01", model: "Суцільний", kind: "Кошик", specs: "Блок кондиціонера: 500×700×300", width: 800, height: 550, depth: 500, quantity: 2 };
  const sig = (extra) => context.pricingSignature_(Object.assign({}, base, extra));
  assert.equal(sig({}), sig({ specs: "Кронштейн: K2" }), "текст характеристик без опцій ціну не змінює");
  assert.equal(sig({}), sig({ width: 795 }), "795 і 800 — той самий розмір після округлення до 10 мм");
  ["width", "height", "depth", "quantity"].forEach((key) => assert.notEqual(sig({}), sig({ [key]: 990 }), key));
  assert.notEqual(sig({}), sig({ construction: "Суцільний · AVL-01 + кришка" }));
  assert.notEqual(sig({}), sig({ construction: "Суцільний · AVL-04" }));
  assert.notEqual(sig({}), sig({ specs: "Матеріал: Алюміній" }));
  assert.notEqual(sig({}), sig({ specs: "Нижня кришка: перфорована" }));
  // Тип і візерунок важать лише як перехід «за формулою» ⇄ «індивідуально».
  assert.equal(sig({ pattern: "K1" }), sig({ pattern: "K10" }));
  assert.equal(sig({ basketType: "Декоративний" }), sig({ basketType: "Стандарт" }));
  assert.notEqual(sig({ pattern: "K1" }), sig({ pattern: "K3" }));
  assert.notEqual(sig({}), sig({ basketType: "Антивандальний" }));
  assert.equal(sig({ kind: "Послуга" }), "not-basket");
}

// Знижка у фінансах картки округлюється як у калькуляторі: спершу ціна, знижка — доповнення.
function testDiscountRoundingMatchesCalculator() {
  const context = loadAppsScript();
  const cells = { 17: 1, 20: 3, 22: 0 };
  const writes = {};
  const sheet = {
    getRange(_row, column) {
      return {
        getValue: () => (cells[column] == null ? "" : cells[column]),
        setValues(values) { writes[column] = Array.from(values[0]); return this; },
        setNumberFormat() { return this; },
        setFormula() { return this; },
      };
    },
  };
  context.applyFinanceToRow_(sheet, 2, { list_price: 5, discount_pct: 10 });
  assert.deepEqual(writes[35], [5, 10, 0], "5 × 0,9 = 4,5 → 5 ₴, знижка 0 (раніше виходило 4 і 1)");
  context.applyFinanceToRow_(sheet, 2, { list_price: 46802, discount_pct: 10 });
  assert.deepEqual(writes[35], [46802, 10, 4680]);
  assert.equal(writes[19][3], 42122);
  context.applyFinanceToRow_(sheet, 2, { list_price: 4000, discount_pct: 0, discount_uah: 290 });
  assert.deepEqual(writes[35], [4000, 7.25, 290], "відсоток із суми — до сотих");
}

// AVL-04 «Зі знімною боковиною»: + бічна панель (висота × глибина), як у калькуляторі.
function testRemovableSidePanelPricing() {
  const context = loadAppsScript();
  const recalc = (construction, model) => {
    const s = recalcSheet({ 9: construction, 11: "K1", 14: 800, 15: 550, 16: 500, 17: 2, 41: model, 42: "Кошик" });
    context.recalcRow_(s.sheet, 2);
    return s.writes[18];
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
  assert.ok(!precise.includes("округленими"), "розміри вже кратні 10 мм — примітки немає");

  // Розмір не кратний 10 мм: площа — за округленим угору, і це видно в повідомленні.
  const rounded = ctx.buildProductionMsg_({
    order_number: "X",
    items: [{ product_type: "basket", construction_type: "Суцільний · AVL-01", size_w: 805, size_h: 550, size_d: 500, quantity: 2, unit: "шт." }],
  }, { finance: true });
  assert.ok(rounded.includes("• Кошик: 0.9955 м² × <b>2 030 ₴/м²</b> × 2 шт. = <b>4 042 ₴</b>"));
  assert.ok(rounded.includes("• Площа — за розмірами, округленими до 10 мм: 550×810×500 мм"));

  // Антивандальний: розкладки за площею немає — лише собівартість, яку вписав менеджер.
  const antivandal = ctx.buildProductionMsg_({
    order_number: "X",
    items: [{ product_type: "basket", basket_type: "Антивандальний", construction_type: "Суцільний · AVL-01", size_w: 800, size_h: 550, size_d: 500, quantity: 2, unit: "шт.", cost_total: 7300 }],
  }, { finance: true });
  assert.ok(!antivandal.includes("₴/м²") && !antivandal.includes("Коригування"), "антивандальний — без формули за площею");
  assert.ok(antivandal.includes("• Вартість виробнича: <b>7 300 ₴</b>"));
  const complex = ctx.buildProductionMsg_({
    order_number: "X",
    items: [{ product_type: "basket", pattern: "K6", construction_type: "Суцільний · AVL-01", size_w: 800, size_h: 550, size_d: 500, quantity: 1, unit: "шт.", cost_total: 2600 }],
  }, { finance: true });
  assert.ok(!complex.includes("₴/м²") && complex.includes("• Вартість виробнича: <b>2 600 ₴</b>"), "складний візерунок — теж без формули");

  // Усі складники собівартості — окремими рядками, і вони сходяться з підсумком.
  const full = ctx.buildProductionMsg_({
    order_number: "X",
    items: [
      { product_type: "basket", construction_type: "Суцільний · AVL-03", basket_model_name: "Універсальний",
        specs: "Матеріал: Оцинкований метал\nСтінки: суцільні\nЗнімна бокова частина\nВерхня кришка: перфорована\nНижня кришка: не перфорована",
        size_w: 800, size_h: 500, size_d: 500, quantity: 2, unit: "шт." },
      { product_type: "basket", construction_type: "Розбірна · AVL-02", size_w: 800, size_h: 540, size_d: 100, quantity: 1, unit: "шт." },
    ],
  }, { finance: true }).replace(/<[^>]+>/g, "");
  [
    "• Кошик 1: 0.9 м² × 2 030 ₴/м² × 2 шт. = 3 654 ₴",
    "  Знімна бічна панель: 0.25 м² × 2 030 ₴/м² × 2 шт. = 1 015 ₴",
    "  Верхня кришка (перфорована): 0.4 м² × 2 030 ₴/м² × 2 шт. = 1 624 ₴",
    "  Нижня кришка: 0.4 м² × 1 920 ₴/м² × 2 шт. = 1 536 ₴",
    "  Кронштейни: 669,77 ₴ × 2 шт. = 1 340 ₴",
    "  Оцинкований метал: 1 400 ₴ × 2 шт. = 2 800 ₴",
    "• Кошик 2: 0.54 м² × 2 030 ₴/м² = 1 096 ₴",
    "  Система кріплення: 1 700 ₴",
    "• Разом виробнича: 14 765 ₴",
  ].forEach((line) => assert.ok(full.includes(line), line + "\n---\n" + full));
  assert.ok(!full.includes("Коригування"), "різниця в гривню — це округлення, а не правка менеджера");
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
  const row = new Array(50).fill("");
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
      if (r === 7 && c === 1 && rows === 1 && cols === 50) {
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
  // Ставка партнера — «за кошик»: рядок-послуга (монтаж, доставка, доплата за колір) її не нараховує.
  assert.ok(formulas[25].includes('IF($AP7="Послуга";0;$Q7*VLOOKUP('), formulas[25]);
  assert.equal(formulas[25],
    '=IFERROR(IF(N($AT7)>0;IF($W7>0;ROUND($W7*$AT7/100;2);0);IF($AP7="Послуга";0;$Q7*VLOOKUP($D7;Дропшипери!$A:$E;5;0)));0)');
  assert.ok(context.dropSoldFormula_().includes('Замовлення!AP:AP;"<>Послуга"'), "«Кошиків продано» не рахує послуги");
  // Підсумки партнера — окремо для кожного рядка (BYROW): SUMIFS у ARRAYFORMULA не розгортається
  // по рядках і давав усім партнерам цифри першого.
  assert.equal(context.dropSumFormula_("V", ""),
    '=BYROW(A2:A;LAMBDA(partner;IF(partner="";"";SUMIFS(Замовлення!V:V;Замовлення!D:D;partner;Замовлення!C:C;"<>Скасовано"))))');
  assert.equal(context.dropSoldFormula_(),
    '=BYROW(A2:A;LAMBDA(partner;IF(partner="";"";SUMIFS(Замовлення!Q:Q;Замовлення!D:D;partner;Замовлення!C:C;"<>Скасовано";Замовлення!AP:AP;"<>Послуга"))))');
  assert.equal(formulas[26], '=IF($W7="";"";$W7-$Y7)', "чистий прибуток = валовий − комісія");

  // Схема таблиці розширена до AT (46) — інакше читання картки впаде.
  assert.equal(context.ADMIN_ORDER_COLS, 50);  // …AW — причина скасування
  assert.equal(context.COMMISSION_PCT_COL, 46);

  // mapOrderRow_ має віддавати ставку в CRM.
  const row = new Array(50).fill("");
  row[0] = "ORD-010126-001";
  row[45] = 30;
  assert.equal(context.mapOrderRow_(7, row).commission_pct, 30);
}

// Одноразове оновлення: формула Y лише в рядках-послугах, F2 «Дропшиперів» — лише стандартна стара.
function testCommissionFormulaMigration() {
  const OLD = {
    F2: '=ARRAYFORMULA(IF(A2:A="";"";SUMIFS(Замовлення!Q:Q;Замовлення!D:D;A2:A;Замовлення!C:C;"<>Скасовано")))',
    G2: '=ARRAYFORMULA(IF(A2:A="";"";SUMIFS(Замовлення!V:V;Замовлення!D:D;A2:A;Замовлення!C:C;"<>Скасовано")))',
    H2: '=ARRAYFORMULA(IF(A2:A="";"";SUMIFS(Замовлення!Y:Y;Замовлення!D:D;A2:A;Замовлення!C:C;"<>Скасовано")))',
    I2: '=ARRAYFORMULA(IF(A2:A="";"";SUMIF(Виплати!B:B;A2:A;Виплати!D:D)))',
  };
  const run = (dropFormulas) => {
    const props = {};
    const set = {};
    const dropSet = {};
    const kinds = [["Кошик"], ["Послуга"], [""], ["Кронштейни"], ["Послуга"]];
    const orders = {
      getLastRow: () => 6, getMaxColumns: () => 50,
      getRange: (row, column) => ({
        getValues: () => kinds,
        setFormula(f) { (set[row] = set[row] || {})[column] = f; return this; },
        setNumberFormat() { return this; },
      }),
    };
    const drop = { getRange: (a1) => ({ getFormula: () => dropFormulas[a1] || "", setFormula(f) { dropSet[a1] = f; return this; } }) };
    const context = loadAppsScript({
      PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => props[k] || null, setProperty: (k, v) => { props[k] = v; } }) },
      SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheetByName: (name) => (name === "Дропшипери" ? drop : null) }) },
    });
    context.ensureCommissionFormulaV2Once_(orders);
    const first = { rows: Object.keys(set).map(Number), dropSet: Object.assign({}, dropSet), flag: props.COMMISSION_FORMULA_V2_READY };
    Object.keys(set).forEach((k) => delete set[k]); Object.keys(dropSet).forEach((k) => delete dropSet[k]);
    context.ensureCommissionFormulaV2Once_(orders);
    return Object.assign(first, { secondRows: Object.keys(set).length, secondDrop: Object.keys(dropSet).length });
  };
  const a = run(OLD);
  assert.deepEqual(a.rows, [3, 6], "формулу Y переставлено лише в рядках-послугах");
  assert.deepEqual(Object.keys(a.dropSet).sort(), ["F2", "G2", "H2"], "I2 (SUMIF) розгортається правильно — її не чіпаємо");
  assert.ok(a.dropSet.F2.startsWith("=BYROW(A2:A;LAMBDA(partner;") && a.dropSet.F2.includes('AP:AP;"<>Послуга"'));
  assert.ok(a.dropSet.G2.includes("Замовлення!V:V") && a.dropSet.H2.includes("Замовлення!Y:Y"));
  assert.equal(a.flag, "1");
  assert.deepEqual([a.secondRows, a.secondDrop], [0, 0], "удруге нічого не чіпаємо");
  // Власні формули власника лишаються як є.
  assert.deepEqual(run({ F2: "=SUM(Z:Z)", G2: "", H2: "=BYROW(A2:A;LAMBDA(c;SUMIFS(Замовлення!Y:Y;Замовлення!D:D;c)))" }).dropSet, {});
}

// Маржа після комісії буває з копійками (8 492,40), а платежі — цілі гривні: залишок 0,40 ₴
// не має тримати замовлення в боржниках.
function testMarginLeftIgnoresKopecks() {
  const context = loadAppsScript();
  assert.equal(context.marginLeft_(8492.4, 8492), 0);
  assert.equal(context.marginLeft_(8492.4, 8493), 0);
  assert.equal(context.marginLeft_(2000, 1000), 1000);
  assert.equal(context.marginLeft_(8492.4, 8491), 1.4, "справжній залишок лишається");
  const order = { order_number: "ORD-010126-001", status: "Виготовлення", quantity: 14, revenue: 46796, profit: 12132, commission: 3639.6, commission_pct: 30 };
  const paid = (amount) => context.adminGroupOrders_([order], [{ order_number: order.order_number, type: "Маржа від підрядника", amount }])[0];
  assert.equal(paid(8492).margin_due, 8492.4);
  assert.equal(paid(8492).margin_left, 0, "8 492 з 8 492,40 — маржу отримано");
  assert.equal(paid(5000).margin_left, 3492.4);
  // Кабінет рахує так само.
  const metrics = groupPaymentMetrics(Object.assign({}, order, { client_left: 0, margin_due: 8492.4, margin_received: 8492 }));
  assert.equal(metrics.marginLeft, 0);
  assert.equal(metrics.marginDebt, 0);
  assert.equal(groupPaymentMetrics(Object.assign({}, order, { client_left: 0, margin_due: 8492.4, margin_received: 8492, margin_left: 0.4 })).marginDebt, 0);
  assert.equal(groupPaymentMetrics(Object.assign({}, order, { client_left: 0, margin_due: 8492.4, margin_received: 5000 })).marginDebt, 3492.4);
}

testPaymentMetrics();
testCommissionFromMargin();
testContractorDebtIsNetOfCommission();
testSheetCommissionFormula();
testCommissionFormulaMigration();
testMarginLeftIgnoresKopecks();
testSheetMarginDue();
testProductionMessageSkipsBasketRateForOtherProducts();
testContractorMessageShowsMarginToPay();
testRecalculationMatchesCalculator();
testPricingSignature();
testDiscountRoundingMatchesCalculator();
testRemovableSidePanelPricing();
testPaymentDeletionChecksStableIdentity();
testBootstrapReadsPaymentsOnce();
testOrderDetailReadsOnlyMatchedRows();
console.log("admin-finance tests: OK");
