// Єдиний алгоритм ціни (lib/avalon-pricing.js): контрольні числа з калькулятора і перевірка,
// що копії алгоритму в скрипті таблиці та в калькуляторі дослівно ті самі.
const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const P = require("../lib/avalon-pricing");

const START = "// >>> AVALON-PRICING-CORE", END = "// <<< AVALON-PRICING-CORE";
function coreOf(file) {
  const text = fs.readFileSync(file, "utf8");
  const a = text.indexOf(START), b = text.indexOf(END);
  assert.ok(a >= 0 && b > a, "немає блоку алгоритму у " + file);
  return text.slice(a, b + END.length);
}

// Змінив формулу — онови всі копії (npm run sync:pricing) і цю суму. Та сама сума стоїть у
// тесті калькулятора (test/avalonPricing.test.mjs): розбіжність = алгоритми розʼїхались.
const CORE_SHA256 = "53f1d0b07a5462b516d26906d33750e1a00f2990af151c298cdce42ba63ba970";

function testCopiesAreIdentical() {
  const root = path.join(__dirname, "..");
  const core = coreOf(path.join(root, "lib", "avalon-pricing.js"));
  assert.equal(crypto.createHash("sha256").update(core).digest("hex"), CORE_SHA256,
    "алгоритм змінено: запустіть npm run sync:pricing та оновіть контрольну суму тут і в калькуляторі");
  assert.equal(coreOf(path.join(root, "google-apps-script-v2.js")), core, "скрипт таблиці рахує іншим кодом");
  // Синтаксис ES5: блок має без змін працювати в Apps Script.
  assert.ok(!/=>|\bconst\b|\blet\b|`/.test(core.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "")), "у ядрі лише ES5");
  const calc = path.join(root, "..", "avalon-calculator", "src", "lib", "avalonPricing.mjs");
  if (fs.existsSync(calc)) assert.equal(coreOf(calc), core, "калькулятор рахує іншим кодом");
}

function testGoldenValues() {
  const price = (input) => P.avalonPrice(input);
  // Числа з «Перевірки розрахунків» калькулятора.
  let p = price({ type: "sectional", width: 750, height: 700, depth: 440, quantity: 14, discountPct: 10 });
  assert.deepEqual([p.baseUnit, p.unitPrice, p.listTotal, p.discountAmount, p.total, p.costTotal, p.profit],
    [2475.97, 3343, 46802, 4680, 42122, 34664, 7458]);
  p = price({ type: "sectional", width: 750, height: 1200, depth: 440, quantity: 3 });
  assert.deepEqual([p.unitPrice, p.total, p.costTotal], [5730, 17190, 12734], "собівартість = за од. × кількість, а не округлена одиниця");
  assert.equal(price({ type: "solid", width: 800, height: 500, depth: 500, topCover: "perforated", bottomCover: "plain" }).unitPrice, 4599);
  assert.equal(price({ type: "universal", width: 800, height: 500, depth: 500 }).unitPrice, 3371);
  assert.equal(price({ type: "sectional_frame", width: 800, height: 550, depth: 500, quantity: 2 }).costTotal, 5136);
  assert.equal(price({ type: "closed", width: 800, height: 500, depth: 500 }).baseUnit, 2821, "4 стінки × 2 170");
  p = price({ type: "screen", width: 800, height: 540, depth: 100, topCover: "plain" });
  assert.deepEqual([p.baseUnit, p.coverArea], [2796.2, 0], "екран: стінки × 2 030 + кріплення 1 700, без кришок");
  assert.equal(price({ type: "solid", width: 800, height: 500, depth: 500, material: "galvanized" }).baseUnit, 3227);
  assert.equal(price({ type: "solid", width: 800, height: 500, depth: 500, material: "aluminium" }).baseUnit, 3654);
  // Округлення розмірів угору до 10 мм — до площі.
  p = price({ type: "solid", width: 801, height: 541, depth: 499 });
  assert.deepEqual([p.width, p.height, p.depth], [810, 550, 500]);
  // Ставки можна передати явно (для перевірок); калькулятор, кабінет і таблиця беруть типові.
  assert.equal(P.avalonPrice({ type: "solid", width: 1000, height: 1000, depth: 0, markupPct: 40 }, { solidRate: 1000 }).unitPrice, 1400);
}

// ТОВ / партнер: з маржі утримують комісію — націнка така, щоб після неї лишилась планова.
function testCommissionGrossUp() {
  const plain = P.avalonPrice({ type: "sectional", width: 750, height: 700, depth: 440, quantity: 14 });
  const tov = P.avalonPrice({ type: "sectional", width: 750, height: 700, depth: 440, quantity: 14, commissionPct: 30 });
  assert.equal(tov.effectiveMarkup, 50, "35 / (1 − 0,30) = 50 %");
  assert.equal(tov.unitPrice, 3714);
  assert.equal(tov.commission, 5199.6, "30 % від маржі 17 332");
  // Чистими — стільки ж, скільки дає звичайний продаж за плановою націнкою (до округлення ціни).
  assert.ok(Math.abs(tov.netProfit - plain.profit) <= 14, `чиста маржа ТОВ ${tov.netProfit} ≈ планова ${plain.profit}`);
  assert.ok(Math.abs(tov.netProfit - plain.costTotal * 0.35) < 1);
  assert.equal(P.avalonMarkupFactor(0), 1.35);
  assert.equal(P.avalonMarkupFactor(30), 1.5);
  assert.equal(P.avalonMarkupFactor(""), 1.35);
  // Зі збиткової угоди (знижка зʼїла маржу) комісію не беруть.
  assert.equal(P.avalonPrice({ type: "solid", width: 800, height: 500, depth: 500, commissionPct: 30, discountPct: 60 }).commission, 0);
}

function testOrderItemText() {
  const type = P.avalonModelType;
  assert.equal(type("Суцільний · AVL-01", ""), "solid");
  assert.equal(type("Розбірна · AVL-02", ""), "screen");
  assert.equal(type("Суцільний · AVL-03", ""), "universal");
  assert.equal(type("Суцільний", "Зі знімною боковиною"), "sectional_frame");
  assert.equal(type("Розбірний (з 3-х частин) · AVL-05", "Розбірний"), "sectional");
  assert.equal(type("Суцільний · AVL-07 + кришка", ""), "closed");
  // Ламельні моделі й AVL-08 мають власні формули (виконання — суцільне чи розбірне — впливає
  // лише на ставку стінок, тип лишається той самий).
  assert.equal(type("Суцільний · AVL-06/1", "Ламельний"), "lamella_full");
  assert.equal(type("Розбірний · AVL-06/1", "Ламельний кошик"), "lamella_full");
  assert.equal(type("Суцільний · AVL-06-1", ""), "lamella_full", "«06-1» — те саме, що «06/1»");
  assert.equal(type("Суцільний · AVL-08", "Закритий кошик для монтажу на горизонтальну площу"), "four_sided");
  assert.equal(type("Суцільний · AVL-06 + кришка", "Розбірний"), "lamella", "з кодом моделі назва тип не визначає");
  assert.equal(type("Суцільний", "Ламель з кришкою"), "lamella");
  assert.equal(type("Суцільний", "Горизонтальний монтаж"), "four_sided");
  assert.equal(type("Суцільний · AVL-01/2", ""), "solid", "невідомий варіант відомої моделі — як сама модель");
  assert.equal(type("Розбірний · AVL-11", "Щось нове"), "sectional", "невідома модель — за текстом конструкції");
  // Повна назва з форми без коду моделі.
  assert.equal(type("Суцільний", "Суцільний кошик зі знімною боковою частиною"), "sectional_frame");
  assert.equal(type("Суцільний", "Розбірний AVL-05"), "sectional", "код моделі важливіший за текст конструкції");
  assert.equal(type("Розбірний (з 3-х частин)", ""), "sectional", "стара позиція без коду — за текстом конструкції");
  assert.equal(type("", ""), "solid");

  const opts = P.avalonParseOptions("Суцільний · AVL-03 + кришка",
    "Матеріал: Оцинкований метал\nСтінки: розбірні\nЗнімна бокова частина\nНижня кришка: перфорована\nКронштейн: K2");
  assert.deepEqual(opts, { material: "galvanized", topCover: "plain", bottomCover: "perforated", universalSectional: true, universalRemovableSide: true });
  assert.equal(P.avalonParseOptions("Суцільний · AVL-01", "Верхня кришка: не перфорована").topCover, "plain");
  assert.equal(P.avalonParseOptions("Суцільний · AVL-01", "Верхня кришка: перфорована").topCover, "perforated");
  assert.equal(P.avalonParseOptions("Суцільний · AVL-01", "").topCover, "");

  const item = { construction: "Суцільний · AVL-04 + кришка", model: "Зі знімною боковиною", width: 800, height: 550, depth: 500, quantity: 2,
    specs: "Нижня кришка: перфорована" };
  const p = P.avalonPriceItem(item, { discountPct: 5 });
  assert.equal(p.type, "sectional_frame");
  assert.deepEqual(P.avalonCostLines(p).map((l) => [l.key, l.cost]),
    [["walls", 4019], ["side", 1117], ["top", 1536], ["bottom", 1624]]);
  assert.equal(p.costTotal, 8296);
  assert.equal(p.total, Math.round(p.unitPrice * 2 * 0.95));
}

// Опції з блоку «Розрахунок» у картці записуються в текст позиції й читаються назад без втрат.
function testOptionsRoundTrip() {
  const out = P.applyOptionsToText("Суцільний · AVL-03", "Блок кондиціонера (В×Ш×Г): 500×700×350 мм\nМатеріал: Алюміній",
    { material: "galvanized", topCover: "perforated", bottomCover: "plain", universalSectional: true, universalRemovableSide: true }, "universal");
  assert.equal(out.construction, "Суцільний · AVL-03 + кришка");
  assert.deepEqual(out.specs.split("\n"), ["Матеріал: Оцинкований метал", "Стінки: розбірні", "Знімна бокова частина",
    "Верхня кришка: перфорована", "Нижня кришка: не перфорована", "Блок кондиціонера (В×Ш×Г): 500×700×350 мм"]);
  assert.deepEqual(P.avalonParseOptions(out.construction, out.specs),
    { material: "galvanized", topCover: "perforated", bottomCover: "plain", universalSectional: true, universalRemovableSide: true });
  // Зняли все — у тексті нічого зайвого, рядки менеджера на місці.
  const cleared = P.applyOptionsToText(out.construction, out.specs, { material: "black_steel", topCover: "", bottomCover: "" }, "solid");
  assert.deepEqual(cleared, { construction: "Суцільний · AVL-03", specs: "Блок кондиціонера (В×Ш×Г): 500×700×350 мм" });
  // Екран кришок не має.
  assert.equal(P.applyOptionsToText("Розбірна · AVL-02 + кришка", "", { topCover: "plain" }, "screen").construction, "Розбірна · AVL-02");
}

// Приклад власника: собівартість 1 000 000 ₴, планова націнка 35 % = 350 000 ₴.
// На карту/ФОП ціна 1 350 000. На ТОВ — така, щоб після комісії 30 % з маржі лишилось 350 000.
function testOwnerTovExample() {
  const cost = 1000000;
  assert.equal(Math.round(cost * P.avalonMarkupFactor(0)), 1350000);
  const price = Math.round(cost * P.avalonMarkupFactor(30));
  assert.equal(price, 1500000);
  const margin = price - cost;
  assert.equal(margin * 0.3, 150000, "комісія ТОВ");
  assert.equal(margin - margin * 0.3, 350000, "чистими — рівно планова націнка");
  // Собівартість буває будь-якою: чистими завжди лишається 35 % від неї (± округлення ціни до гривні).
  [1, 37, 999.99, 2475.97, 12345.67, 58000, 743210.55, 9876543].forEach((c) => {
    const p = Math.round(c * P.avalonMarkupFactor(30));
    assert.ok(Math.abs((p - c) * 0.7 - c * 0.35) <= 0.35 + 1e-9, "собівартість " + c);
  });
  // Інша ставка комісії — той самий принцип.
  [10, 15, 25, 40].forEach((rate) => {
    const p = cost * P.avalonMarkupFactor(rate);
    assert.ok(Math.abs((p - cost) * (1 - rate / 100) - 350000) < 0.01, "комісія " + rate + " %");
  });
}

// Небазовий колір: +200 ₴ ОДИН раз на замовлення, хоч скільки в ньому виробів.
function testColorSurcharge() {
  ["", "RAL 7016", "Сірий (RAL 7016)", "RAL 9005 чорний", "Білий (RAL 9016)", "білий", "Чорний", " сірий "].forEach((c) =>
    assert.equal(P.avalonIsBaseColor(c), true, "базовий: " + c));
  ["RAL 6005 зелений", "Мохово-зелений (RAL 6005)", "Інший", "золото", "RAL 7016 / RAL 3000", "чорний матовий"].forEach((c) =>
    assert.equal(P.avalonIsBaseColor(c), false, "небазовий: " + c));
  assert.equal(P.avalonColorSurcharge("RAL 6005"), 200);
  assert.equal(P.avalonColorSurcharge(["RAL 7016", "RAL 6005", "RAL 3000", "золото"]), 200, "одна на замовлення, а не на позицію");
  assert.equal(P.avalonColorSurcharge(["RAL 7016", "Білий (RAL 9016)", ""]), 0);
  assert.equal(P.avalonColorSurcharge([]), 0);
  assert.equal(P.avalonColorSurcharge(["RAL 6005"], { colorSurcharge: 300 }), 300, "сума — з налаштувань");
}

// Кошик без глибини формула не рахує (вийшла б одна лицева стінка); екрану досить ширини й висоти.
function testItemSized() {
  const item = (extra) => Object.assign({ construction: "Суцільний · AVL-01", model: "Суцільний", width: 800, height: 500, depth: 500 }, extra);
  assert.equal(P.avalonItemSized(item({})), true);
  [{ depth: "" }, { depth: 0 }, { width: 0 }, { height: "" }, { depth: null }].forEach((x) => assert.equal(P.avalonItemSized(item(x)), false, JSON.stringify(x)));
  assert.equal(P.avalonItemSized(item({ construction: "Розбірна · AVL-02", depth: 0 })), true, "екран: глибина — борти, може бути 0");
  assert.equal(P.avalonItemSized(item({ construction: "Розбірна · AVL-02", width: 0 })), false);
}

// Антивандальне виконання і складний візерунок дорожчі, а на скільки — рахується індивідуально:
// формула такі позиції не оцінює.
function testIndividualPricing() {
  assert.equal(P.avalonIsIndividualPricing("Антивандальний (більша товщина металу+ каркас)"), true);
  assert.equal(P.avalonIsIndividualPricing("антивандальний", ""), true);
  ["Декоративний", "Стандарт", "", null, undefined].forEach((t) => assert.equal(P.avalonIsIndividualPricing(t), false));
  ["K3", "K4", "K6", "K8", "K9", "k3", " К4", "K8 (дзеркально)"].forEach((p) => assert.equal(P.avalonIsIndividualPricing("Декоративний", p), true, p));
  ["K1", "K2", "K5", "K7", "K10", "Інший", "", null, "K30"].forEach((p) => assert.equal(P.avalonIsIndividualPricing("Декоративний", p), false, String(p)));
  assert.equal(P.avalonIndividualReason("Антивандальний", "K6"), "антивандальне виконання і складний візерунок K6");
  assert.equal(P.avalonIndividualReason("Декоративний", "K1"), "");
}

// Правила власника (07.10.2026) для моделей, яких раніше не було в розрахунку.
function testLamellaAndFourSidedModels() {
  // Ламелі: на панелі 600,4 мм — 8 штук (креслення власника); висота ламелі й проміжок сталі.
  const count = P.avalonLamellaCount;
  assert.equal(count(600.4), 8);
  assert.deepEqual([400, 500, 530, 600, 670, 700, 740, 800, 810, 900, 1000].map(count), [5, 6, 7, 8, 9, 9, 10, 10, 11, 12, 13]);
  assert.deepEqual([0, 30, 66, "", null].map(count), [0, 0, 0, 0, 0]);
  const item = (construction, extra) => P.avalonPriceItem(Object.assign(
    { construction, width: 800, height: 600, depth: 500, quantity: 1 }, extra));

  // AVL-06: бокові й лицьова × 2 030, +12 ₴ за кожну ламель лицьової, кришка 1 920 / 2 030.
  //   стінки (2 × 0,6×0,5 + 0,6×0,8) = 1,08 м² × 2 030 = 2 192,40; ламелі 8 × 12 = 96; кришка 0,4 м².
  let p = item("Суцільний · AVL-06 + кришка");
  assert.deepEqual([p.type, p.lamellaCount, p.lamellaPanels, p.lamellaCost, p.costTotal, p.unitPrice], ["lamella", 8, 1, 96, 3056, 4126]);
  assert.equal(item("Суцільний · AVL-06 + кришка", { specs: "Верхня кришка: перфорована" }).costTotal, 3100, "кришка з візерунком × 2 030");
  assert.equal(item("Суцільний · AVL-06").costTotal, 2288, "кришку можна прибрати");
  assert.deepEqual(P.avalonCostLines(p).map((l) => [l.key, l.cost]), [["walls", 2192], ["top", 768], ["lamella", 96]]);
  assert.equal(P.avalonCostLines(p)[2].label, "Гнуття ламелей (8 шт × 12 ₴)");

  // AVL-06/1: ламельні всі три стінки — 3 × 8 × 12 = 288.
  p = item("Суцільний · AVL-06/1 + кришка");
  assert.deepEqual([p.type, p.lamellaCount * p.lamellaPanels, p.lamellaCost, p.costTotal], ["lamella_full", 24, 288, 3248]);
  assert.equal(item("Суцільний · AVL-06/1").costTotal, 2480);
  assert.equal(item("Розбірний (з 3-х частин) · AVL-06/1").costTotal, 2632, "розбірне виконання: 1,08 × 2 170 + 288");
  assert.equal(item("Суцільний · AVL-06-1 + кришка").costTotal, 3248, "«06-1» = «06/1»");

  // AVL-08: чотири стінки (дві лицьові + дві бокові) і кришка.
  //   (2 × 0,6×0,5 + 2 × 0,6×0,8) = 1,56 м² × 2 030 = 3 166,80; кришка 0,4 × 1 920 = 768.
  p = item("Суцільний · AVL-08 + кришка");
  assert.deepEqual([p.type, p.wallArea, p.costTotal, p.lamellaCost], ["four_sided", 1.56, 3935, 0]);
  assert.equal(item("Суцільний · AVL-08 + кришка", { specs: "Верхня кришка: перфорована" }).costTotal, 3979);
  assert.equal(item("Суцільний · AVL-08").costTotal, 3167);
  // Кількість: собівартість і ціна — рівно за одиницю × кількість.
  p = item("Суцільний · AVL-06/1 + кришка", { quantity: 150 });
  assert.deepEqual([p.costTotal, p.total], [Math.round(3248.4 * 150), 4385 * 150]);
  // Глибина обовʼязкова й цим моделям.
  assert.equal(P.avalonItemSized({ construction: "Суцільний · AVL-06", width: 800, height: 600, depth: "" }), false);
}

// Візерунок «Інший»: +100 ₴ до ставки за м² поверхонь із візерунком (2 030 → 2 130, 2 170 → 2 270).
function testCustomPattern() {
  ["Інший", "інший", " Інший: дубове листя", "ІНШИЙ (ескіз клієнта)"].forEach((x) => assert.equal(P.avalonIsCustomPattern(x), true, x));
  ["K1", "K10", "", null, undefined, "Листя", "K3"].forEach((x) => assert.equal(P.avalonIsCustomPattern(x), false, String(x)));
  assert.equal(P.avalonIsIndividualPricing("Декоративний", "Інший"), false, "«Інший» рахує формула, а не менеджер вручну");
  const item = (construction, extra) => P.avalonPriceItem(Object.assign(
    { construction, width: 800, height: 500, depth: 500, quantity: 1, pattern: "Інший: листя" }, extra));
  // 0,9 м² стінок: 2 030 + 100 = 2 130 → 1 917; розбірний 2 170 + 100 = 2 270 → 2 043.
  let p = item("Суцільний · AVL-01");
  assert.deepEqual([p.costTotal, p.patternArea, p.patternRate, p.patternCost], [1917, 0.9, 100, 90]);
  assert.equal(p.costTotal, Math.round(0.9 * 2130));
  assert.equal(item("Розбірний (з 3-х частин) · AVL-05").costTotal, Math.round(0.9 * 2270));
  assert.equal(item("Суцільний · AVL-01", { pattern: "K1" }).costTotal, 1827, "базовий візерунок — без надбавки");
  assert.deepEqual(P.avalonCostLines(p).map((l) => [l.key, l.cost]), [["walls", 1827], ["pattern", 90]]);
  // Кришка: з візерунком (перфорована) — теж +100; без візерунка — ні.
  assert.equal(item("Суцільний · AVL-01 + кришка").costTotal, Math.round(0.9 * 2130 + 0.4 * 1920));
  assert.equal(item("Суцільний · AVL-01", { specs: "Верхня кришка: перфорована" }).costTotal, Math.round(0.9 * 2130 + 0.4 * 2130));
  // Знімна бічна панель AVL-04 теж із візерунком: (0,9 + 0,25) × 100.
  p = item("Суцільний · AVL-04");
  assert.equal(p.patternArea, 1.15);
  assert.equal(p.costTotal, Math.round(0.9 * 2030 + 0.25 * 2030 + 1.15 * 100));
  // AVL-06: візерунок лише на бокових (лицьова — ламельна); AVL-06/1 візерунка на стінках не має.
  p = item("Суцільний · AVL-06 + кришка", { height: 600 });
  assert.deepEqual([p.patternArea, p.costTotal], [0.6, 3116]);
  assert.equal(item("Суцільний · AVL-06/1 + кришка", { height: 600 }).costTotal, 3248);
  // AVL-08: усі чотири стінки.
  assert.equal(item("Суцільний · AVL-08", { height: 600 }).costTotal, Math.round(1.56 * 2130));
  // Комісія ТОВ і знижка рахуються вже з надбавкою.
  p = item("Суцільний · AVL-01", { quantity: 60 });
  const tov = P.avalonPriceItem({ construction: "Суцільний · AVL-01", pattern: "Інший", width: 800, height: 500, depth: 500, quantity: 60 }, { commissionPct: 30, discountPct: 5 });
  assert.deepEqual([p.unitPrice, p.total, tov.unitPrice, tov.total], [2588, 2588 * 60, 2876, Math.round(2876 * 60 * 0.95)]);
}

testCopiesAreIdentical();
testLamellaAndFourSidedModels();
testCustomPattern();
testItemSized();
testIndividualPricing();
testOwnerTovExample();
testColorSurcharge();
testGoldenValues();
testCommissionGrossUp();
testOrderItemText();
testOptionsRoundTrip();
console.log("avalon-pricing tests: OK");
