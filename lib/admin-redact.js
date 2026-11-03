// Гроші власника менеджер не бачить (рішення власника, 02.11.2026). Кабінет ховав їх лише на екрані,
// а сервер віддавав усім входам — тепер для входу менеджера вони прибираються з відповіді:
//  • суми по замовленнях: що отримав власник, що передав підряднику, його борг, маржа в його грошах;
//  • записи платежів: «Частка підряднику» і записи «Забрати маржу» / розрахунку в «Касі» (take:/settle:).
// Що клієнт заплатив і кому (позначка «отримав я») — лишається: це вносить і звіряє сам менеджер.
const { roleOf } = require("./admin-auth");

const OWNER_KEYS = ["owner_owes", "owner_received", "share_paid", "margin_kept", "held"];
const OWNER_PAYMENT_TYPES = ["Частка підряднику"];

function isOwnerPayment(item) {
  if (!item || typeof item !== "object" || !("type" in item) || !("amount" in item) || !("method" in item)) return false;
  if (OWNER_PAYMENT_TYPES.includes(String(item.type || "").trim())) return true;
  return /^(take|settle):/.test(String(item.request_id || ""));
}

function redactForManager(value) {
  if (Array.isArray(value)) return value.filter((x) => !isOwnerPayment(x)).map(redactForManager);
  if (!value || typeof value !== "object") return value;
  const out = {};
  Object.keys(value).forEach((key) => {
    if (OWNER_KEYS.includes(key)) return;
    out[key] = redactForManager(value[key]);
  });
  return out;
}

/** Відповідь для того, хто увійшов: власнику — як є, менеджеру — без грошей власника. */
function forRole(req, data) {
  return roleOf(req) === "manager" ? redactForManager(data) : data;
}

module.exports = { forRole, redactForManager, isOwnerPayment };
