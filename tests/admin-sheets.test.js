const assert = require("assert");
const { callAdminSheets } = require("../lib/admin-sheets");

process.env.GOOGLE_SHEET_URL = "https://example.test/exec";
process.env.ADMIN_API_SECRET = "test-secret";

function jsonResponse(body, ok = true, status = 200) {
  return { ok, status, json: async () => body };
}

async function run() {
  let calls = 0;
  global.fetch = async () => {
    calls += 1;
    if (calls === 1) throw Object.assign(new Error("aborted"), { name: "AbortError" });
    return jsonResponse({ status: "ok", payouts: [] });
  };
  await callAdminSheets("list_payouts", {});
  assert.equal(calls, 2, "безпечне читання має повторюватись після тайм-ауту");

  calls = 0;
  global.fetch = async () => {
    calls += 1;
    throw Object.assign(new Error("aborted"), { name: "AbortError" });
  };
  await assert.rejects(() => callAdminSheets("update_order", { order_number: "ORD-TEST" }));
  assert.equal(calls, 1, "звичайний запис не можна повторювати автоматично");

  calls = 0;
  global.fetch = async () => {
    calls += 1;
    if (calls === 1) throw Object.assign(new Error("aborted"), { name: "AbortError" });
    return jsonResponse({ status: "ok", order_number: "ORD-010126-001", duplicate: true });
  };
  await callAdminSheets("create_order", { order: { request_id: "req-1" } });
  assert.equal(calls, 2, "ідемпотентне створення замовлення можна безпечно повторити");
}

run().then(() => console.log("admin-sheets tests: OK")).catch(err => {
  console.error(err);
  process.exit(1);
});
