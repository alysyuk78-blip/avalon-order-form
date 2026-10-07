// CORS адмін-API: калькулятор (окремий сайт) має право звертатись; чужі адреси — ні.
const assert = require("assert");
const { setAdminCors, requireAdmin, issueToken } = require("../lib/admin-auth");

process.env.ADMIN_PASSWORD = "test-password";

function res() {
  return { headers: {}, statusCode: 200, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.statusCode = c; return this; }, json() { return this; } };
}
const originFor = (origin) => {
  const r = res();
  setAdminCors({ headers: { origin } }, r);
  return r.headers["Access-Control-Allow-Origin"];
};

assert.equal(originFor("https://avalon-order-form.vercel.app"), "https://avalon-order-form.vercel.app");
assert.equal(originFor("https://avalon-calculator.vercel.app"), "https://avalon-calculator.vercel.app",
  "калькулятор записує розрахунок у замовлення через це API");
assert.equal(originFor("https://evil.example"), "https://avalon-order-form.vercel.app", "чужій адресі доступ не відкривається");
assert.equal(originFor("https://avalon-calculator.vercel.app.evil.example"), "https://avalon-order-form.vercel.app",
  "схожа адреса не проходить за префіксом");

// Навіть із дозволеної адреси без токена — 401.
const denied = res();
assert.equal(requireAdmin({ headers: { origin: "https://avalon-calculator.vercel.app" } }, denied), null);
assert.equal(denied.statusCode, 401);
assert.ok(requireAdmin({ headers: { authorization: "Bearer " + issueToken(true) } }, res()));

// ── Два входи: власник (ADMIN_PASSWORD) і менеджер (MANAGER_PASSWORD) ──
const { roleForPassword, requireOwner, roleOf, managerLoginEnabled } = require("../lib/admin-auth");
const bearer = (token) => ({ headers: { authorization: "Bearer " + token } });
// Без пароля менеджера входу менеджера немає — усе, як і досі.
delete process.env.MANAGER_PASSWORD;
assert.equal(managerLoginEnabled(), false);
assert.equal(roleForPassword("test-password"), "owner");
assert.equal(roleForPassword("manager-secret-1"), null);
// Власник задав пароль менеджера.
process.env.MANAGER_PASSWORD = "manager-secret-1";
assert.equal(managerLoginEnabled(), true);
assert.equal(roleForPassword("manager-secret-1"), "manager");
assert.equal(roleForPassword("test-password"), "owner");
assert.equal(roleForPassword("wrong"), null);
assert.equal(roleForPassword(undefined), null);
const ownerToken = issueToken(true, "owner"), managerToken = issueToken(true, "manager");
assert.equal(roleOf(bearer(ownerToken)), "owner");
assert.equal(roleOf(bearer(managerToken)), "manager");
assert.equal(roleOf(bearer(issueToken(true))), "owner", "вхід без названої ролі — власник, як і досі");
assert.equal(roleOf({ headers: {} }), "");
assert.ok(requireAdmin(bearer(managerToken), res()), "менеджер працює в кабінеті");
// Змінювати ставки може лише власник: менеджерові — 403, без входу — 401.
assert.ok(requireOwner(bearer(ownerToken), res()));
const forbidden = res();
assert.equal(requireOwner(bearer(managerToken), forbidden), null);
assert.equal(forbidden.statusCode, 403);
const anonymous = res();
assert.equal(requireOwner({ headers: {} }, anonymous), null);
assert.equal(anonymous.statusCode, 401);
// Менеджер не «підвищить» себе, підмінивши роль у своєму вході: підпис не зійдеться.
const forged = (() => {
  const [body, sig] = managerToken.split(".");
  const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  payload.role = "owner";
  return Buffer.from(JSON.stringify(payload)).toString("base64url") + "." + sig;
})();
assert.equal(roleOf(bearer(forged)), "");
// Власник змінив пароль менеджера — старий вхід менеджера одразу не діє; вхід власника діє.
process.env.MANAGER_PASSWORD = "manager-secret-2";
assert.equal(roleOf(bearer(managerToken)), "");
assert.equal(roleOf(bearer(ownerToken)), "owner");
// Прибрав пароль — входу менеджера немає зовсім.
const second = issueToken(false, "manager");
assert.equal(roleOf(bearer(second)), "manager");
delete process.env.MANAGER_PASSWORD;
assert.equal(roleOf(bearer(second)), "");
// Закороткий пароль менеджера або такий самий, як у власника, — не діє.
process.env.MANAGER_PASSWORD = "1234567";
assert.equal(managerLoginEnabled(), false);
assert.equal(roleForPassword("1234567"), null);
process.env.MANAGER_PASSWORD = "test-password";
assert.equal(managerLoginEnabled(), false);
assert.equal(roleForPassword("test-password"), "owner");
delete process.env.MANAGER_PASSWORD;

console.log("admin-auth tests: OK");
