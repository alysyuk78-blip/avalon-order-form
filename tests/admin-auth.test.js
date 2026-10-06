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

console.log("admin-auth tests: OK");
