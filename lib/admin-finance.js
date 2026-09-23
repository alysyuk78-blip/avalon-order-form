function hasValue(value) {
  return value !== null && value !== undefined && value !== "";
}

function amount(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

// Маржа стає боргом підрядника лише після погодження замовлення (з «Виготовлення»):
// «Нове» й «В опрацюванні підрядником» ще можуть скасувати. Узгоджено з Apps Script
// (MARGIN_OWED_STATUSES); «В роботі» — стара назва «Виготовлення».
const MARGIN_OWED_STATUSES = ["Виготовлення", "В роботі", "Готове", "Відправлено", "Завершено"];
function marginOwed(group) {
  const source = group || {};
  if (typeof source.margin_owed === "boolean") return source.margin_owed;
  // Без статусу (старі виклики й зведення) — як раніше: маржа рахується.
  if (!hasValue(source.status)) return true;
  return MARGIN_OWED_STATUSES.indexOf(String(source.status).trim()) >= 0;
}

/**
 * Єдине трактування оплат для карток, нагадувань і фінансового зведення.
 * Нові замовлення мають точні суми з журналу платежів; для старих даних
 * без цих полів зберігаємо сумісність із галочками AG/AH.
 */
function groupPaymentMetrics(group) {
  const source = group || {};
  const revenue = amount(source.revenue);
  const profit = amount(source.profit);
  // Комісію зі ставки (колонка AT) утримує підрядник, тому переказати він має
  // валовий прибуток МІНУС її.
  // ⚠️ Комісію дропшипера (без ставки, за ?ref) НЕ віднімаємо: її Avalon платить
  // партнеру сама через «Виплати», підрядник її не утримує.
  const hasRate = Number(source.commission_pct) > 0;
  const marginDue = hasValue(source.margin_due)
    ? amount(source.margin_due)
    : (profit > 0 && hasRate
        ? Math.max(0, profit - Math.max(0, amount(source.commission)))
        : profit);

  const clientLeftKnown = hasValue(source.client_left);
  const clientSettled = Boolean(source.client_paid) || (
    revenue > 0 && clientLeftKnown && amount(source.client_left) <= 0
  );

  const owed = marginOwed(source);
  const receivedKnown = hasValue(source.margin_received);
  const leftKnown = hasValue(source.margin_left);
  const marginReceived = receivedKnown
    ? amount(source.margin_received)
    : (source.margin_paid ? marginDue : 0);
  const marginLeft = !owed ? 0 : (leftKnown
    ? Math.max(0, amount(source.margin_left))
    : Math.max(0, marginDue - marginReceived));
  // До погодження маржа — лише прогноз: не «до виплати», не борг і не «очікується».
  const owedDue = owed ? marginDue : 0;

  return {
    clientSettled,
    owed,
    marginDue: owedDue,
    marginForecast: owed ? 0 : marginDue,
    marginReady: clientSettled ? owedDue : 0,
    marginReceived,
    marginDebt: clientSettled ? marginLeft : 0,
    marginLeft,
  };
}

// ── Комісія партнера/ТОВ: береться з МАРЖІ, а не з ціни ─────────────────────
// Ставка зберігається у відсотках (30 = 30%), бо так її бачить і вводить
// менеджер, і так вона лежить у таблиці (колонка AT, формат 0.00"%").
// У розрахунках працюємо з часткою rate = pct / 100.

const COMMISSION_PCT_MAX = 100; // ставка 100% і більше → маржі не лишається

/** Ставка у відсотках → частка. null, якщо ставка не задана або некоректна. */
function commissionRate(commissionPct) {
  if (!hasValue(commissionPct)) return 0;
  const pct = Number(commissionPct);
  if (!Number.isFinite(pct)) return null;
  if (pct < 0 || pct >= COMMISSION_PCT_MAX) return null;
  return pct / 100;
}

/** Округлення ВГОРУ до кроку (для прайсу — до 10 ₴, щоб не зʼїдати маржу). */
function roundUpTo(value, step) {
  if (!Number.isFinite(value) || !step) return value;
  return Math.ceil(value / step) * step;
}

/**
 * Прямий розрахунок: є ціна → скільки лишиться після комісії.
 * grossMargin = price − cost; commission = grossMargin × rate;
 * netMargin = grossMargin × (1 − rate).
 * Збиткова угода (grossMargin <= 0): комісії немає, чиста = брутто.
 */
function marginBreakdown(input) {
  const src = input || {};
  const cost = amount(src.cost);
  const price = amount(src.price);
  const rate = commissionRate(src.commissionPct);
  const grossMargin = price - cost;
  const loss = grossMargin <= 0;
  const rateValid = rate !== null;
  const effectiveRate = rateValid ? rate : 0;
  const commission = loss ? 0 : grossMargin * effectiveRate;
  const netMargin = grossMargin - commission;
  return {
    cost,
    price,
    rate: effectiveRate,
    ratePct: effectiveRate * 100,
    rateValid,
    grossMargin,
    commission,
    netMargin,
    loss,
    // Похідні: націнка до собівартості та маржинальність від ціни.
    markupOnCost: cost > 0 ? grossMargin / cost : null,
    marginRate: price > 0 ? grossMargin / price : null,
    netMarginRate: price > 0 ? netMargin / price : null,
  };
}

/**
 * Зворотний розрахунок: є бажана ЧИСТА маржа → яка потрібна ціна.
 * requiredGrossMargin = targetNetMargin / (1 − rate);  requiredPrice = cost + requiredGrossMargin.
 * УВАГА: price / (1 − rate) тут НЕПРАВИЛЬНО — так рахують комісію з обороту.
 */
function requiredPriceForNetMargin(input) {
  const src = input || {};
  const cost = amount(src.cost);
  const price = amount(src.price);
  const targetNetMargin = amount(src.targetNetMargin);
  const rate = commissionRate(src.commissionPct);
  if (rate === null) {
    return { valid: false, reason: "Ставка комісії має бути від 0% до 99,99%" };
  }
  const requiredGrossMargin = targetNetMargin / (1 - rate);
  const requiredPrice = cost + requiredGrossMargin;
  const step = hasValue(src.roundStep) ? Number(src.roundStep) : 10;
  return {
    valid: true,
    rate,
    targetNetMargin,
    requiredGrossMargin,
    requiredPrice,
    requiredPriceRounded: roundUpTo(requiredPrice, step),
    // Наскільки підняти ціну відносно поточної та наскільки росте сама маржа.
    priceUplift: price > 0 ? requiredPrice / price - 1 : null,
    priceDelta: price > 0 ? requiredPrice - price : null,
    marginUplift: rate / (1 - rate),
  };
}

module.exports = {
  groupPaymentMetrics,
  marginOwed,
  MARGIN_OWED_STATUSES,
  commissionRate,
  marginBreakdown,
  requiredPriceForNetMargin,
  roundUpTo,
  COMMISSION_PCT_MAX,
};
