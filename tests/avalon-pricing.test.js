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
const CORE_SHA256 = "bd41d8c4c4be71e61d9608bf45732b9f2b00faa38052e167ac1602d4ded4bcf8";

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
  // Власні ставки (налаштування калькулятора) перекривають типові.
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
  assert.equal(type("Суцільний · AVL-06/1", "Ламельний"), "solid");
  // Моделей AVL-06, 06/1, 08 у калькуляторі немає — ставку визначає текст конструкції, як і раніше.
  assert.equal(type("Розбірний · AVL-06/1", "Ламельний кошик"), "sectional");
  assert.equal(type("Суцільний · AVL-08", "Закритий кошик для монтажу на горизонтальну площу"), "solid");
  assert.equal(type("Суцільний · AVL-06 + кришка", "Розбірний"), "solid", "з кодом моделі назва тип не визначає");
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

testCopiesAreIdentical();
testItemSized();
testIndividualPricing();
testOwnerTovExample();
testColorSurcharge();
testGoldenValues();
testCommissionGrossUp();
testOrderItemText();
testOptionsRoundTrip();
console.log("avalon-pricing tests: OK");
