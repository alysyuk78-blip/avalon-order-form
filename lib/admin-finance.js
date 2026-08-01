function hasValue(value) {
  return value !== null && value !== undefined && value !== "";
}

function amount(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
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

  const clientLeftKnown = hasValue(source.client_left);
  const clientSettled = Boolean(source.client_paid) || (
    revenue > 0 && clientLeftKnown && amount(source.client_left) <= 0
  );

  const receivedKnown = hasValue(source.margin_received);
  const leftKnown = hasValue(source.margin_left);
  const marginReceived = receivedKnown
    ? amount(source.margin_received)
    : (source.margin_paid ? profit : 0);
  const marginLeft = leftKnown
    ? Math.max(0, amount(source.margin_left))
    : Math.max(0, profit - marginReceived);

  return {
    clientSettled,
    marginReady: clientSettled ? profit : 0,
    marginReceived,
    marginDebt: clientSettled ? marginLeft : 0,
    marginLeft,
  };
}

module.exports = { groupPaymentMetrics };
