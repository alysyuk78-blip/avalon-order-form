// >>> AVALON-PRICING-CORE
// ЄДИНИЙ алгоритм ціни кошика Avalon. Той самий текст (між маркерами) лежить у трьох місцях:
//   • avalon-calculator  → src/lib/avalonPricing.mjs  (калькулятор)
//   • avalon-order-form  → lib/avalon-pricing.js      (кабінет CRM і серверні повідомлення)
//   • avalon-order-form  → google-apps-script-v2.js   (автоціна в таблиці)
// Тести в обох репозиторіях звіряють контрольну суму цього блоку: змінив формулу тут —
// онови всі три копії (npm run sync:pricing) і контрольну суму, інакше тести впадуть.
// Синтаксис ES5 — щоб блок без змін працював і в Apps Script.
var AVALON_PRICING_DEFAULTS = {
  solidRate: 2030,          // стінки: AVL-01 / 02 / 04 і суцільний AVL-03, ₴/м²
  sectionalRate: 2170,      // стінки: AVL-05 / 07 і розбірний AVL-03, ₴/м²
  coverRate: 1920,          // кришка НЕ перфорована, ₴/м²
  coverPerfRate: 2030,      // кришка перфорована, ₴/м²
  screenKitPrice: 1700,     // AVL-02: система кріплення (2 кронштейни + 2 перемички), за комплект
  universalBracketPrice: 800, // AVL-03: кронштейни для еталона Ш1000×Г550×В600 (∝ Ш+Г+В)
  markupPct: 35,            // планова націнка, %
  colorSurcharge: 200,      // небазовий колір: доплата на ЗАМОВЛЕННЯ (не на виріб), ₴
  customPatternRate: 100,   // візерунок «Інший»: + до ставки за м² поверхонь із візерунком
  lamellaBendPrice: 12      // AVL-06 і 06/1: гнуття однієї ламелі, ₴
};
// Базові кольори (без доплати): сірий RAL 7016, чорний RAL 9005, білий RAL 9016.
var AVALON_BASE_RAL = ["7016", "9005", "9016"];
var AVALON_COLOR_SURCHARGE_NAME = "Доплата за колір";
var AVALON_UNIVERSAL_REF_SUM = 2150; // 1000 + 550 + 600 мм
var AVALON_MATERIALS = {
  black_steel: "Чорний метал",
  galvanized: "Оцинкований метал",
  aluminium: "Алюміній"
};
// Код моделі каталогу → тип конструкції в розрахунку.
//   lamella      — AVL-06: лицьова стінка ламельна, бокові — з візерунком;
//   lamella_full — AVL-06/1: ламельні всі три стінки;
//   four_sided   — AVL-08: чотири стінки (дві лицьові + дві бокові).
// Ставку стінок цих трьох моделей, як і AVL-03, визначає виконання в тексті конструкції:
// «розбірний» → ставка розбірного, інакше суцільного. Кришка — якщо є в конструкції.
var AVALON_MODEL_TYPES = {
  "AVL-01": "solid", "AVL-02": "screen", "AVL-03": "universal", "AVL-04": "sectional_frame",
  "AVL-05": "sectional", "AVL-06": "lamella", "AVL-06/1": "lamella_full", "AVL-07": "closed",
  "AVL-08": "four_sided"
};
var AVALON_MODEL_NAMES = {
  "суцільний": "solid", "екран під утеплювач": "screen", "універсальний": "universal",
  "зі знімною боковиною": "sectional_frame", "розбірний": "sectional", "закритий на підставці": "closed",
  "ламель з кришкою": "lamella", "ламельний": "lamella_full", "горизонтальний монтаж": "four_sided"
};
// Ламельна панель: висота ламелі й проміжок між ламелями сталі, зверху й знизу — поля.
// Панель 600,4 мм вміщує 8 ламелей: 38,1 + 8 × 40 + 7 × 30,43 + 28,1. Допуск 1 мм — щоб панель,
// якій бракує частки міліметра (740 мм → 10 ламелей), не втрачала ламель.
var AVALON_LAMELLA = { height: 40, gap: 30.43, top: 38.1, bottom: 28.1, tolerance: 1 };

// Прибирає шум плаваючої коми (1829.9999999998 → 1830), не змінюючи суму.
function avalonSnap(value) { return Math.round(value * 1e6) / 1e6; }
function avalonNum(value, fallback) {
  var n = Number(value);
  return isFinite(n) ? n : (fallback === undefined ? 0 : fallback);
}

/** Тип конструкції за текстом конструкції та назвою/кодом моделі (як вони лежать у замовленні). */
function avalonModelType(construction, model) {
  var hay = String(construction == null ? "" : construction) + " " + String(model == null ? "" : model);
  // «AVL-06/1» пишуть і як «AVL-06-1» — це та сама модель.
  var code = hay.toUpperCase().match(/AVL-\d{2}(?:[\/-]\d(?!\d))?/);
  var id = code ? code[0].replace(/-(\d)$/, "/$1") : "";
  // Невідомий варіант відомої моделі («AVL-01/2») рахуємо як саму модель.
  if (id && !AVALON_MODEL_TYPES[id] && AVALON_MODEL_TYPES[id.replace(/\/\d$/, "")]) id = id.replace(/\/\d$/, "");
  if (id && AVALON_MODEL_TYPES[id]) return AVALON_MODEL_TYPES[id];
  var byText = String(construction == null ? "" : construction).toLowerCase().indexOf("розбір") >= 0 ? "sectional" : "solid";
  // Код є, але такої моделі в розрахунку немає — лише за текстом конструкції:
  // назва моделі чи слова в ній тип не визначають.
  if (id) return byText;
  var name = String(model == null ? "" : model).replace(/^\s+|\s+$/g, "").toLowerCase();
  if (AVALON_MODEL_NAMES[name]) return AVALON_MODEL_NAMES[name];
  // «Зі знімною боковиною» / «…зі знімною боковою частиною» — без коду моделі.
  if (/знімн\S*\s+боков/i.test(hay)) return "sectional_frame";
  return byText;
}

/** Скільки ламелей вміщується на панелі такої висоти (мм). */
function avalonLamellaCount(heightMm) {
  var L = AVALON_LAMELLA;
  var n = Math.floor((avalonNum(heightMm) - L.top - L.bottom + L.gap + L.tolerance) / (L.height + L.gap));
  return n > 0 ? n : 0;
}

/** Візерунок «Інший» — свій ескіз клієнта («Інший», «Інший: дубове листя»). */
function avalonIsCustomPattern(pattern) {
  return /^\s*\u0456\u043D\u0448/i.test(String(pattern == null ? "" : pattern).toLowerCase());
}

/**
 * Опції, що впливають на ціну, з тексту позиції: кришка в конструкції («… + кришка») і рядки
 * характеристик («Матеріал: …», «Верхня кришка: перфорована», «Нижня кришка: …»,
 * «Стінки: розбірні», «Знімна бокова частина»).
 */
function avalonParseOptions(construction, specs) {
  var c = String(construction == null ? "" : construction);
  var s = String(specs == null ? "" : specs);
  function line(re) { var m = s.match(re); return m ? String(m[1]).replace(/^\s+|\s+$/g, "") : ""; }
  function coverType(text) { return /(^|\s)не\s+перфорована/i.test(text) ? "plain" : (/перфорована/i.test(text) ? "perforated" : "plain"); }
  var materialLabel = line(/Матеріал:\s*([^\n]+)/i).toLowerCase();
  var material = "black_steel";
  for (var key in AVALON_MATERIALS) {
    if (AVALON_MATERIALS[key].toLowerCase() === materialLabel) material = key;
  }
  var top = line(/Верхня кришка:\s*([^\n]+)/i);
  var bottom = line(/Нижня кришка:\s*([^\n]+)/i);
  var walls = line(/Стінки:\s*([^\n]+)/i);
  return {
    material: material,
    topCover: top ? coverType(top) : (c.toLowerCase().indexOf("кришка") >= 0 ? "plain" : ""),
    bottomCover: bottom ? coverType(bottom) : "",
    universalSectional: /розбірн/i.test(walls) || c.toLowerCase().indexOf("розбір") >= 0,
    universalRemovableSide: /Знімна бокова частина/i.test(s)
  };
}

/**
 * Розрахунок позиції. Розміри — ГОТОВОГО кошика в мм (для екрана: висота вже з рамкою,
 * глибина = борти). Гроші: собівартість за од. → націнка → ціна за од. до гривні →
 * × кількість → знижка.
 *   type: solid | sectional | sectional_frame | universal | closed | screen |
 *         lamella | lamella_full | four_sided
 *   topCover / bottomCover: "" | "plain" | "perforated"
 *   customPattern: візерунок «Інший» — +customPatternRate за м² поверхонь із візерунком
 *   universalSectional: стінки розбірні (AVL-03, 06, 06/1, 08 — за текстом конструкції)
 *   commissionPct: комісія з маржі (ТОВ/партнер), яку утримують з нашої маржі. Націнка
 *     збільшується так, щоб ПІСЛЯ комісії лишалась планова: націнка / (1 − комісія).
 */
function avalonPrice(input, rates) {
  var r = rates || {};
  function rate(key) { return avalonNum(r[key], AVALON_PRICING_DEFAULTS[key]); }
  var type = input.type || "solid";
  var isScreen = type === "screen";
  var isUniversal = type === "universal";
  var isLamella = type === "lamella" || type === "lamella_full";
  var isFourSided = type === "four_sided";
  var qty = Math.max(1, avalonNum(input.quantity, 1) || 1);
  // Розміри округлюються вгору до 10 мм ДО площі — ціна рахується на тих розмірах, що виготовляються.
  var H = Math.ceil(Math.max(0, avalonNum(input.height)) / 10) * 10;
  var W = Math.ceil(Math.max(0, avalonNum(input.width)) / 10) * 10;
  var D = Math.ceil(Math.max(0, avalonNum(input.depth)) / 10) * 10;

  // Площі, м². Стінки: 2 бокові (В×Г) + лицева (В×Ш); «закритий» і AVL-08 — ще й задня (В×Ш).
  var backArea = (type === "closed" || isFourSided) ? H * W : 0;
  var wallArea = (2 * H * D + H * W + backArea) / 1000000;
  var oneCoverArea = (W * D) / 1000000;
  var topCoverArea = input.topCover && !isScreen ? oneCoverArea : 0;
  var bottomCoverArea = input.bottomCover && !isScreen ? oneCoverArea : 0;
  var sideWallArea = (H * D) / 1000000;

  // Собівартість за одиницю («чорна» база).
  // Моделі, де виконання (суцільне / розбірне) — вибір: ставку визначає ознака «стінки розбірні».
  var byExecution = isUniversal || isLamella || isFourSided;
  var universalSectional = byExecution && !!input.universalSectional;
  var usesSolidRate = type === "solid" || isScreen || type === "sectional_frame";
  var wallRate = byExecution
    ? (universalSectional ? rate("sectionalRate") : rate("solidRate"))
    : (usesSolidRate ? rate("solidRate") : rate("sectionalRate"));
  // Знімна бічна панель: AVL-04 завжди, AVL-03 — як опція. Завжди за суцільною ставкою.
  var hasRemovableSide = type === "sectional_frame" || (isUniversal && !!input.universalRemovableSide);
  var removableSideArea = hasRemovableSide ? sideWallArea : 0;
  var wallsCost = wallArea * wallRate;
  var removableSideCost = removableSideArea * rate("solidRate");
  var topCoverRate = input.topCover === "perforated" ? rate("coverPerfRate") : rate("coverRate");
  var bottomCoverRate = input.bottomCover === "perforated" ? rate("coverPerfRate") : rate("coverRate");
  var topCoverCost = topCoverArea * topCoverRate;
  var bottomCoverCost = bottomCoverArea * bottomCoverRate;
  // Кронштейни AVL-03 ∝ сумі габаритів (Ш+Г+В); екран AVL-02 — один комплект кріплення.
  var bracketsCost = (isScreen ? rate("screenKitPrice") : 0)
    + (isUniversal ? rate("universalBracketPrice") * (W + D + H) / AVALON_UNIVERSAL_REF_SUM : 0);
  // Ламелі: ставка стінки та сама, плюс гнуття кожної ламелі. AVL-06 — лише лицьова панель,
  // AVL-06/1 — лицьова й обидві бокові. Кількість на панелі залежить від висоти.
  var lamellaPanels = type === "lamella" ? 1 : (type === "lamella_full" ? 3 : 0);
  var lamellaCount = lamellaPanels ? avalonLamellaCount(H) : 0;
  var lamellaBendPrice = rate("lamellaBendPrice");
  var lamellaCost = lamellaCount * lamellaPanels * lamellaBendPrice;
  // Візерунок «Інший»: надбавка за кожен м² поверхні з візерунком — стінки (без ламельних
  // панелей), знімна бічна панель і перфоровані кришки. Неперфорована кришка візерунка не має.
  var customPattern = !!input.customPattern;
  var patternRate = customPattern ? rate("customPatternRate") : 0;
  var patternedWalls = type === "lamella_full" ? 0 : (type === "lamella" ? (2 * H * D) / 1000000 : wallArea);
  var patternArea = !customPattern ? 0 : patternedWalls + removableSideArea
    + (input.topCover === "perforated" ? topCoverArea : 0) + (input.bottomCover === "perforated" ? bottomCoverArea : 0);
  var patternCost = patternArea * patternRate;
  var blackBase = avalonSnap(wallsCost + removableSideCost + (topCoverCost + bottomCoverCost) + bracketsCost
    + lamellaCost + patternCost);

  // Матеріал: оцинкований +1400 ₴, алюміній ×2 — до повної «чорної» бази.
  var material = input.material || "black_steel";
  var materialAdjustment = material === "galvanized" ? 1400 : (material === "aluminium" ? blackBase : 0);
  var baseUnit = blackBase + materialAdjustment;

  // Націнка. З комісією з маржі — така, щоб після комісії лишалась планова націнка.
  var planMarkup = avalonNum(input.markupPct, rate("markupPct"));
  var commissionPct = Math.min(99, Math.max(0, avalonNum(input.commissionPct)));
  var effectiveMarkup = commissionPct > 0 ? avalonSnap(planMarkup / (1 - commissionPct / 100)) : planMarkup;
  var unitPrice = Math.round(baseUnit * (1 + effectiveMarkup / 100));

  // Підсумки: ціна за одиницю × кількість → знижка (сума знижки — точне доповнення).
  var discountPct = Math.min(100, Math.max(0, avalonNum(input.discountPct)));
  var listTotal = unitPrice * qty;
  var total = Math.round(unitPrice * qty * (1 - discountPct / 100));
  var costTotal = Math.round(baseUnit * qty);
  var profit = total - costTotal;
  var commission = commissionPct > 0 && profit > 0 ? Math.round(profit * commissionPct) / 100 : 0;

  return {
    type: type, quantity: qty, height: H, width: W, depth: D, material: material,
    topCover: topCoverArea ? input.topCover : "", bottomCover: bottomCoverArea ? input.bottomCover : "",
    wallArea: wallArea, removableSideArea: removableSideArea,
    topCoverArea: topCoverArea, bottomCoverArea: bottomCoverArea,
    coverArea: topCoverArea + bottomCoverArea,
    area: wallArea + topCoverArea + bottomCoverArea,
    sideWallArea: sideWallArea,
    wallRate: wallRate, solidRate: rate("solidRate"), topCoverRate: topCoverRate, bottomCoverRate: bottomCoverRate,
    wallsCost: wallsCost, removableSideCost: removableSideCost,
    topCoverCost: topCoverCost, bottomCoverCost: bottomCoverCost, coversCost: topCoverCost + bottomCoverCost,
    bracketsCost: bracketsCost, blackBase: blackBase, materialAdjustment: materialAdjustment,
    universalSectional: universalSectional,
    lamellaPanels: lamellaPanels, lamellaCount: lamellaCount, lamellaBendPrice: lamellaBendPrice, lamellaCost: lamellaCost,
    customPattern: customPattern, patternArea: patternArea, patternRate: patternRate, patternCost: patternCost,
    baseUnit: baseUnit, planMarkup: planMarkup, effectiveMarkup: effectiveMarkup, commissionPct: commissionPct,
    unitPrice: unitPrice, listTotal: listTotal, discountPct: discountPct,
    discountAmount: listTotal - total, total: total,
    costTotal: costTotal, profit: profit, commission: commission, netProfit: profit - commission
  };
}

// Складні візерунки: дорожчі за звичайні, а на скільки — менеджер рахує індивідуально.
var AVALON_COMPLEX_PATTERNS = ["K3", "K4", "K6", "K8", "K9"];

/**
 * Чому позицію формула НЕ рахує (ціну визначає менеджер індивідуально) — або "" якщо рахує.
 * Причини: антивандальне виконання (більша товщина металу + каркас) і складний візерунок.
 */
function avalonIndividualReason(basketType, pattern) {
  var reasons = [];
  if (String(basketType == null ? "" : basketType).toLowerCase().indexOf("антивандал") >= 0) reasons.push("антивандальне виконання");
  // Код візерунка: латинська «K» або кирилична «К», далі номер (K3, к3, «K3 (свій)»).
  var code = String(pattern == null ? "" : pattern).replace(/^\s+/, "").toUpperCase().replace(/^\u041A/, "K").match(/^K\d+/);
  if (code && AVALON_COMPLEX_PATTERNS.indexOf(code[0]) >= 0) reasons.push("складний візерунок " + code[0]);
  return reasons.join(" і ");
}
function avalonIsIndividualPricing(basketType, pattern) {
  return avalonIndividualReason(basketType, pattern) !== "";
}

/**
 * Чи колір базовий. Із кодом RAL — лише 7016 / 9005 / 9016; без коду — рівно «сірий»,
 * «чорний» або «білий». Порожній (колір ще не вказано) доплати не дає.
 */
function avalonIsBaseColor(color) {
  var text = String(color == null ? "" : color).replace(/^\s+|\s+$/g, "").toLowerCase();
  if (!text) return true;
  var codes = text.match(/\d{4}/g);
  if (codes) {
    for (var i = 0; i < codes.length; i++) {
      if (AVALON_BASE_RAL.indexOf(codes[i]) < 0) return false;
    }
    return true;
  }
  return text === "сірий" || text === "чорний" || text === "білий";
}

/**
 * Доплата за небазовий колір: ОДНА на замовлення, хоч скільки в ньому виробів і позицій.
 * colors — колір позиції або масив кольорів усіх позицій замовлення.
 */
function avalonColorSurcharge(colors, rates) {
  var list = Object.prototype.toString.call(colors) === "[object Array]" ? colors : [colors];
  var amount = avalonNum((rates || {}).colorSurcharge, AVALON_PRICING_DEFAULTS.colorSurcharge);
  for (var i = 0; i < list.length; i++) {
    if (!avalonIsBaseColor(list[i])) return amount;
  }
  return 0;
}

/** Множник «собівартість → ціна»: 1,35 за планової націнки; з комісією 30 % — 1,5. */
function avalonMarkupFactor(commissionPct, markupPct) {
  var plan = avalonNum(markupPct, AVALON_PRICING_DEFAULTS.markupPct);
  var c = Math.min(99, Math.max(0, avalonNum(commissionPct)));
  return 1 + (c > 0 ? avalonSnap(plan / (1 - c / 100)) : plan) / 100;
}

/**
 * Розкладка виробничої собівартості рядками — для повідомлень і картки CRM.
 * Рядок площі: { key, label, area, rate, cost }; рядок суми за одиницю: { key, label, unit, cost }.
 * cost — на всю кількість. Сума рядків може відрізнятись від costTotal на копійки округлення.
 */
function avalonCostLines(p) {
  var q = p.quantity, lines = [];
  function areaLine(key, label, area, rate) {
    if (area > 0) lines.push({ key: key, label: label, area: area, rate: rate, cost: Math.round(area * rate * q) });
  }
  function unitLine(key, label, unit) {
    if (unit > 0) lines.push({ key: key, label: label, unit: unit, cost: Math.round(unit * q) });
  }
  areaLine("walls", "Стінки", p.wallArea, p.wallRate);
  areaLine("side", "Знімна бічна панель", p.removableSideArea, p.solidRate);
  areaLine("top", "Верхня кришка" + (p.topCover === "perforated" ? " (перфорована)" : ""), p.topCoverArea, p.topCoverRate);
  areaLine("bottom", "Нижня кришка" + (p.bottomCover === "perforated" ? " (перфорована)" : ""), p.bottomCoverArea, p.bottomCoverRate);
  areaLine("pattern", "Візерунок «Інший», надбавка", p.patternArea, p.patternRate);
  if (p.lamellaCost > 0) {
    unitLine("lamella", "Гнуття ламелей (" + (p.lamellaCount * p.lamellaPanels) + " шт × " + p.lamellaBendPrice + " ₴)", p.lamellaCost);
  }
  unitLine("brackets", p.type === "screen" ? "Система кріплення" : "Кронштейни", p.bracketsCost);
  unitLine("material", p.material === "aluminium" ? "Алюміній (×2)" : "Оцинкований метал", p.materialAdjustment);
  return lines;
}

/**
 * Чи досить розмірів, щоб рахувати позицію формулою: ширина й висота — завжди, глибина — для
 * всього, крім екрана (у нього глибина — борти, і вона може бути нульовою). Кошик без глибини
 * формула порахувала б як одну лицеву стінку — тобто занизила б ціну.
 */
function avalonItemSized(item) {
  var type = avalonModelType(item.construction, item.model);
  return avalonNum(item.width) > 0 && avalonNum(item.height) > 0 && (type === "screen" || avalonNum(item.depth) > 0);
}

/** Розрахунок позиції замовлення, як вона лежить у таблиці/кабінеті (текстові поля). */
function avalonPriceItem(item, extra) {
  var e = extra || {};
  var opts = avalonParseOptions(item.construction, item.specs);
  return avalonPrice({
    type: avalonModelType(item.construction, item.model),
    width: item.width, height: item.height, depth: item.depth, quantity: item.quantity,
    material: opts.material, topCover: opts.topCover, bottomCover: opts.bottomCover,
    universalSectional: opts.universalSectional, universalRemovableSide: opts.universalRemovableSide,
    customPattern: avalonIsCustomPattern(item.pattern),
    discountPct: e.discountPct, commissionPct: e.commissionPct, markupPct: e.markupPct
  }, e.rates);
}
// <<< AVALON-PRICING-CORE

const COVER_LABELS = { plain: "не перфорована", perforated: "перфорована" };

/**
 * Зворотне до avalonParseOptions: записує опції розрахунку в текст позиції (конструкцію та
 * характеристики), не чіпаючи решту рядків, які менеджер вписав сам. Лише для кабінету.
 */
function applyOptionsToText(construction, specs, options, type) {
  const o = options || {};
  const drop = /^\s*(Матеріал:|Верхня кришка:|Нижня кришка:|Стінки:|Знімна бокова частина)/i;
  const kept = String(specs == null ? "" : specs).split("\n").filter((line) => line.trim() && !drop.test(line));
  const lines = [];
  if (o.material && o.material !== "black_steel" && AVALON_MATERIALS[o.material]) lines.push("Матеріал: " + AVALON_MATERIALS[o.material]);
  if (type === "universal") {
    lines.push("Стінки: " + (o.universalSectional ? "розбірні" : "суцільні"));
    if (o.universalRemovableSide) lines.push("Знімна бокова частина");
  }
  const covers = type !== "screen";
  if (covers && o.topCover) lines.push("Верхня кришка: " + COVER_LABELS[o.topCover]);
  if (covers && o.bottomCover) lines.push("Нижня кришка: " + COVER_LABELS[o.bottomCover]);
  // «+ кришка» в конструкції — ознака верхньої кришки для таблиці й підрядника.
  let c = String(construction == null ? "" : construction).replace(/\s*\+\s*кришка\s*$/i, "").trim();
  if (covers && o.topCover) c += " + кришка";
  return { construction: c, specs: lines.concat(kept).join("\n") };
}

module.exports = {
  AVALON_PRICING_DEFAULTS, AVALON_MATERIALS, AVALON_MODEL_TYPES,
  avalonSnap, avalonModelType, avalonParseOptions, avalonPrice, avalonPriceItem,
  avalonMarkupFactor, avalonCostLines, applyOptionsToText,
  avalonIsBaseColor, avalonColorSurcharge, AVALON_COLOR_SURCHARGE_NAME, avalonIsIndividualPricing,
  avalonIndividualReason, AVALON_COMPLEX_PATTERNS, avalonItemSized,
  avalonLamellaCount, avalonIsCustomPattern, AVALON_LAMELLA,
};
