const assert = require("assert");
const { callAdminSheets, TIMING } = require("../lib/admin-sheets");

process.env.GOOGLE_SHEET_URL = "https://example.test/exec";
process.env.ADMIN_API_SECRET = "test-secret";

const ECHO = "https://script.googleusercontent.test/macros/echo?user_content_key=k";

function jsonResponse(body, ok = true, status = 200) {
  return { ok, status, headers: { get: () => null }, json: async () => body };
}
function redirectResponse(location = ECHO) {
  return {
    ok: false, status: 302,
    headers: { get: (name) => (String(name).toLowerCase() === "location" ? location : null) },
    json: async () => { throw new Error("not json"); },
  };
}
const abortError = () => Object.assign(new Error("aborted"), { name: "AbortError" });

async function run() {
  let calls = 0;
  global.fetch = async () => {
    calls += 1;
    if (calls === 1) throw new TypeError("temporary network error");
    return jsonResponse({ status: "ok", payouts: [] });
  };
  await callAdminSheets("list_payouts", {});
  assert.equal(calls, 2, "безпечне читання має повторюватись після мережевого збою");

  // Читання, що падає щоразу: не більше трьох спроб, далі — зрозуміла помилка.
  calls = 0;
  global.fetch = async () => {
    calls += 1;
    throw abortError();
  };
  await assert.rejects(
    () => callAdminSheets("list_payouts", {}),
    err => err.code === "SHEETS_TIMEOUT"
  );
  assert.equal(calls, TIMING.maxReadAttempts, "читання пробуємо обмежену кількість разів");

  calls = 0;
  global.fetch = async () => {
    calls += 1;
    throw abortError();
  };
  await assert.rejects(() => callAdminSheets("update_order", { order_number: "ORD-TEST" }));
  assert.equal(calls, 1, "звичайний запис не можна повторювати автоматично");

  calls = 0;
  global.fetch = async () => {
    calls += 1;
    if (calls === 1) throw abortError();
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

  // Після тайм-ауту довга дія не повторюється: вона може ще тривати. Повторює клієнт
  // тим самим request_id і отримує «pending» або результат.
  calls = 0;
  global.fetch = async () => {
    calls += 1;
    throw abortError();
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

  // ── Двокрокова відповідь Apps Script ──

  // Звичайний шлях: POST без автопереадресації → GET за адресою відповіді.
  const seen = [];
  global.fetch = async (url, opts) => {
    seen.push({ url, method: opts.method, redirect: opts.redirect });
    return url === ECHO ? jsonResponse({ status: "ok", payouts: [1] }) : redirectResponse();
  };
  const ok = await callAdminSheets("list_payouts", {});
  assert.deepEqual(ok.payouts, [1]);
  assert.deepEqual(seen.map(s => s.method), ["POST", "GET"]);
  assert.equal(seen[0].redirect, "manual", "переадресацію виконуємо самі, окремим кроком");

  // Завис лише другий крок: збереження замовлення вже виконано — перепитуємо відповідь,
  // а сам запис НЕ запускаємо вдруге (раніше тут кабінет показував помилку).
  let posts = 0, gets = 0;
  global.fetch = async (url) => {
    if (url !== ECHO) { posts += 1; return redirectResponse(); }
    gets += 1;
    if (gets === 1) throw abortError();
    return jsonResponse({ status: "ok", order: { order_number: "ORD-150926-012" } });
  };
  const saved = await callAdminSheets("update_order", { order_number: "ORD-150926-012" });
  assert.equal(saved.order.order_number, "ORD-150926-012");
  assert.equal(posts, 1, "запис після завислої відповіді не повторюється");
  assert.equal(gets, 2, "завислу відповідь перепитуємо");

  // Відповідь загубилась остаточно: для запису — чесне повідомлення, без повтору дії.
  posts = 0; gets = 0;
  global.fetch = async (url) => {
    if (url !== ECHO) { posts += 1; return redirectResponse(); }
    gets += 1;
    return jsonResponse(null, false, 404);
  };
  await assert.rejects(
    () => callAdminSheets("update_order", { order_number: "ORD-150926-012" }),
    err => err.code === "SHEETS_RESULT_LOST" && /виконала дію/.test(err.message)
  );
  assert.equal(posts, 1, "запис не повторюється, навіть коли відповідь загубилась");
  assert.equal(gets, 1, "протерміновану відповідь перепитувати марно");

  // Для читання загублена відповідь — просто ще один запуск.
  posts = 0; gets = 0;
  global.fetch = async (url) => {
    if (url !== ECHO) { posts += 1; return redirectResponse(); }
    gets += 1;
    return gets === 1 ? jsonResponse(null, false, 404) : jsonResponse({ status: "ok", payouts: [] });
  };
  await callAdminSheets("bootstrap", {});
  assert.equal(posts, 2, "читання з загубленою відповіддю запускаємо ще раз");

  // Відкриття завантаження файлу: загублена відповідь після виконання → безпечний повтор.
  posts = 0; gets = 0;
  global.fetch = async (url) => {
    if (url !== ECHO) { posts += 1; return redirectResponse(); }
    gets += 1;
    return gets === 1 ? jsonResponse(null, false, 404) : jsonResponse({ status: "ok", upload_id: "u2" });
  };
  const init = await callAdminSheets("file_upload_init", { order_number: "ORD-150926-012", size: 10 });
  assert.equal(init.upload_id, "u2");
  assert.equal(posts, 2, "сесію завантаження можна відкрити ще раз, коли перший запуск завершився");

  // …але не після тайм-ауту запуску: невідомо, чи перший ще створює теку.
  posts = 0;
  global.fetch = async () => { posts += 1; throw abortError(); };
  await assert.rejects(() => callAdminSheets("file_upload_init", { order_number: "ORD-150926-012", size: 10 }));
  assert.equal(posts, 1, "після тайм-ауту сесію завантаження не відкриваємо вдруге");

  // ── Випередження для читань: завислу спробу не чекаємо до кінця тайм-ауту ──
  const savedHedge = TIMING.hedgeAfterMs;
  TIMING.hedgeAfterMs = 60;
  const hanging = (opts) => new Promise((_, rej) => {
    opts.signal.addEventListener("abort", () => rej(abortError()), { once: true });
  });

  // Перша спроба зависла на кроці 1 (як у проді 15.09 о 19:02), друга відповіла — беремо її,
  // а завислу скасовуємо.
  posts = 0;
  let firstAborted = false;
  global.fetch = async (url, opts) => {
    if (url === ECHO) return jsonResponse({ status: "ok", groups: ["свіжі"] });
    posts += 1;
    if (posts === 1) {
      return hanging(opts).catch((e) => { firstAborted = true; throw e; });
    }
    return redirectResponse();
  };
  const started = Date.now();
  const fast = await callAdminSheets("bootstrap", {});
  assert.deepEqual(fast.groups, ["свіжі"]);
  assert.equal(posts, 2, "друга спроба стартувала, не чекаючи тайм-ауту першої");
  assert.ok(Date.now() - started < 2000, "відповідь за частки секунди, а не за 25 с");
  await new Promise((r) => setImmediate(r));
  assert.ok(firstAborted, "завислу спробу скасовано після перемоги іншої");

  // Завис другий крок першої спроби — друга спроба все одно рятує читання.
  posts = 0; gets = 0;
  global.fetch = async (url, opts) => {
    if (url !== ECHO) { posts += 1; return redirectResponse(); }
    gets += 1;
    if (gets === 1) return hanging(opts);
    return jsonResponse({ status: "ok", files: [] });
  };
  await callAdminSheets("files_list", { order_number: "ORD-150926-012" });
  assert.equal(posts, 2);

  // Відповідь із помилкою від самого скрипту — не привід запускати ще спроби.
  posts = 0;
  global.fetch = async () => { posts += 1; return jsonResponse({ status: "error", message: "Замовлення не знайдено" }); };
  await assert.rejects(() => callAdminSheets("get_order", { order_number: "ORD-1" }), /не знайдено/);
  assert.equal(posts, 1, "відмова скрипту — остаточна");

  // Записи ніколи не запускаються паралельно: навіть повільна відповідь — одна спроба.
  posts = 0;
  global.fetch = async () => {
    posts += 1;
    await new Promise((r) => setTimeout(r, 250));
    return jsonResponse({ status: "ok", order: {} });
  };
  await callAdminSheets("update_order", { order_number: "ORD-150926-012" });
  assert.equal(posts, 1, "запис не дублюється випередженням");
  TIMING.hedgeAfterMs = savedHedge;

  // Малий файл одним запитом із request_id — мережевий збій можна повторити.
  posts = 0;
  global.fetch = async () => {
    posts += 1;
    if (posts === 1) throw new TypeError("temporary network error");
    return jsonResponse({ status: "ok", done: true, file: { id: "f1" } });
  };
  await callAdminSheets("file_upload_small", { order_number: "ORD-150926-012", request_id: "fs-1" });
  assert.equal(posts, 2, "малий файл із request_id повторюється без дубля");
}

run().then(() => console.log("admin-sheets tests: OK")).catch(err => {
  console.error(err);
  process.exit(1);
});
