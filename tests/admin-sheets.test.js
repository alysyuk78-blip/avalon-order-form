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
    if (calls === 1) throw new TypeError("temporary network error");
    return jsonResponse({ status: "ok", payouts: [] });
  };
  await callAdminSheets("list_payouts", {});
  assert.equal(calls, 2, "безпечне читання має повторюватись після мережевого збою");

  calls = 0;
  global.fetch = async () => {
    calls += 1;
    throw Object.assign(new Error("aborted"), { name: "AbortError" });
  };
  await assert.rejects(
    () => callAdminSheets("list_payouts", {}),
    err => err.code === "SHEETS_TIMEOUT" && /40 секунд/.test(err.message)
  );
  assert.equal(calls, 1, "читання не повинно створювати другий довгий запит після тайм-ауту");

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

  // Надсилання підряднику з request_id Apps Script не дублює — мережевий збій можна повторити.
  calls = 0;
  global.fetch = async () => {
    calls += 1;
    if (calls === 1) throw new TypeError("temporary network error");
    return jsonResponse({ status: "ok" });
  };
  await callAdminSheets("contractor_send", { order_number: "ORD-110926-001", request_id: "rid-1" });
  assert.equal(calls, 2, "надсилання з request_id повторюється після обриву мережі");

  // Після тайм-ауту довга дія не повторюється: другий запит вийшов би за ліміт функції
  // Vercel. Повторює клієнт тим самим request_id і отримує «pending» або результат.
  calls = 0;
  global.fetch = async () => {
    calls += 1;
    throw Object.assign(new Error("aborted"), { name: "AbortError" });
  };
  await assert.rejects(
    () => callAdminSheets("contractor_send_file", { order_number: "ORD-110926-001", request_id: "rid-2" }),
    err => err.code === "SHEETS_TIMEOUT" && /55 секунд/.test(err.message)
  );
  assert.equal(calls, 1, "довга дія після тайм-ауту не повторюється на сервері");

  // Частина файлу сама не повторюється — клієнт спершу питає Диск, скільки вже дійшло.
  calls = 0;
  global.fetch = async () => {
    calls += 1;
    throw new TypeError("temporary network error");
  };
  await assert.rejects(() => callAdminSheets("file_upload_chunk", { upload_id: "u" }));
  assert.equal(calls, 1, "частина файлу не дописується двічі наосліп");
}

run().then(() => console.log("admin-sheets tests: OK")).catch(err => {
  console.error(err);
  process.exit(1);
});
