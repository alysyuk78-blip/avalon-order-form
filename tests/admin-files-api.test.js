// API файлів і надсилання підряднику: перевірка вхідних даних до того, як запит
// піде в Apps Script (зайве туди не потрапляє, завеликі частини відсікаються тут).
const assert = require("assert");

const calls = [];
const sheetsPath = require.resolve("../lib/admin-sheets");
require(sheetsPath);
require.cache[sheetsPath].exports = {
  callAdminSheets: async (action, payload) => {
    calls.push({ action, payload });
    if (action === "rates_get") return { status: "ok", pricing: PRICING };
    return { status: "ok", action };
  },
  sendError: (res, err) => res.status(err.status || 500).json({ error: err.message }),
};

const authPath = require.resolve("../lib/admin-auth");
require(authPath);
// Ставки, як їх віддає Apps Script: з приміткою власника.
const PRICING = {
  versions: [{ from: "2026-11-01", rates: { solidRate: 2233, markupPct: 35 }, note: "лист підрядника", saved_at: "07.10.2026 12:00" }],
  today: "2026-11-02", current_from: "2026-11-01",
};
let signedIn = true;   // чи запит «із входом» — для того, що видно й без нього
require.cache[authPath].exports = {
  requireAdmin: (req, res) => { if (signedIn) return true; res.status(401).json({ error: "Unauthorized" }); return null; },
  isAdmin: () => signedIn,
  setAdminCors: () => {},
  handleOptions: (req, res) => res.status(204).end(),
};

const fs = require("fs");
const path = require("path");
const order = require("../api/admin/order");

// Файли й надсилання підряднику — не окремі функції, а /api/admin/order?resource=…
const withResource = (resource) => (req, res) =>
  order(Object.assign({}, req, { query: Object.assign({ resource }, req.query || {}) }), res);
const files = withResource("files");
const contractor = withResource("contractor");
const rates = withResource("rates");

// Vercel Hobby: не більше 12 серверних функцій на розгортання. 13-та ламає деплой
// на «Deploying outputs» без тексту помилки — тож стежимо тут.
function countFunctions(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).reduce((n, e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return n + countFunctions(full);
    return n + (/\.(js|mjs|cjs|ts)$/.test(e.name) ? 1 : 0);
  }, 0);
}
const ORD = "ORD-110926-001";

function response() {
  return {
    statusCode: 200,
    body: null,
    setHeader() {},
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    end() { return this; },
  };
}

async function call(handler, req) {
  const res = response();
  await handler(Object.assign({ headers: {}, query: {}, body: {} }, req), res);
  return res;
}

async function run() {
  const fnCount = countFunctions(path.join(__dirname, "..", "api"));
  assert.ok(fnCount <= 12, "Vercel Hobby дозволяє до 12 функцій, а в api/ їх " + fnCount);

  // Без resource order.js працює, як і раніше: картка замовлення.
  let o = await call(order, { method: "GET", query: { order_number: ORD } });
  assert.equal(o.statusCode, 200);
  assert.equal(calls.pop().action, "get_order");

  // Видалення однієї позиції замовлення (DELETE без resource).
  o = await call(order, { method: "DELETE", query: { order_number: ORD, row: "3" } });
  assert.equal(o.statusCode, 200);
  assert.deepEqual(calls.pop(), { action: "delete_order_item", payload: { order_number: ORD, row: 3 } });
  // Що бачить кабінет у позиції — доходить до Apps Script лише відомими полями.
  o = await call(order, { method: "DELETE", query: { order_number: ORD, row: "3" },
    body: { expect: { basket_model: "Зі знімною боковиною", quantity: 2, hack: "x", construction: { evil: 1 } } } });
  assert.deepEqual(calls.pop().payload, { order_number: ORD, row: 3, expect: { basket_model: "Зі знімною боковиною", quantity: 2 } });
  o = await call(order, { method: "PATCH", body: { order_number: ORD, row: 4, patch: { color: "Чорний" }, expect: { product_kind: "Кошик" } } });
  assert.deepEqual(calls.pop(), { action: "update_order", payload: { order_number: ORD, row: 4, patch: { color: "Чорний" }, expect: { product_kind: "Кошик" } } });

  // Додати позицію з калькулятора: лише відомі поля, числа невідʼємні, request_id проти дубля.
  o = await call(order, { method: "POST", body: {
    action: "add_item", order_number: ORD, request_id: "calc-1",
    item: { product_type: "basket", basket_model: "AVL-05", size_w: 750, size_h: "700", size_d: 440, quantity: 14,
      cost_total: 34664, price_total: 42122, list_price: 46802, discount_pct: 10, discount_uah: 4680,
      item_comment: "По 3 вуха", admin_secret: "x", row: 2, cost_unit: -5, has_cover: true },
  } });
  assert.equal(o.statusCode, 200);
  assert.deepEqual(calls.pop(), { action: "add_order_item", payload: {
    order_number: ORD, request_id: "calc-1",
    item: { product_type: "basket", basket_model: "AVL-05", item_comment: "По 3 вуха", size_w: 750, size_h: 700, size_d: 440, quantity: 14,
      cost_total: 34664, price_total: 42122, list_price: 46802, discount_pct: 10, discount_uah: 4680, has_cover: true },
  } });
  o = await call(order, { method: "POST", body: { action: "add_item", order_number: ORD } });
  assert.equal(o.statusCode, 400, "без позиції нічого не додаємо");
  assert.equal(calls.length, 0);

  o = await call(order, { method: "DELETE", query: { order_number: ORD } });
  assert.equal(o.statusCode, 400, "без рядка позиції нічого не видаляємо");
  o = await call(order, { method: "DELETE", query: { row: "3" } });
  assert.equal(o.statusCode, 400, "без номера замовлення нічого не видаляємо");
  assert.equal(calls.length, 0);

  let r = await call(files, { method: "GET", query: { order_number: "ORD-1" } });
  assert.equal(r.statusCode, 400, "невірний номер замовлення відсікається до Apps Script");
  assert.equal(calls.length, 0);

  r = await call(files, { method: "GET", query: { order_number: ORD } });
  assert.equal(r.statusCode, 200);
  assert.equal(calls.pop().action, "files_list");

  await call(files, {
    method: "POST",
    body: { action: "init", order_number: ORD, name: "Креслення.pdf", mime: "application/pdf", size: 1234 },
  });
  assert.deepEqual(calls.pop(), {
    action: "file_upload_init",
    payload: { order_number: ORD, name: "Креслення.pdf", mime: "application/pdf", size: 1234 },
  });

  await call(files, {
    method: "POST",
    body: { action: "small", order_number: ORD, name: "Знімок.png", mime: "image/png", size: 3, data: "QUJD", request_id: "fs-1" },
  });
  assert.deepEqual(calls.pop(), {
    action: "file_upload_small",
    payload: { order_number: ORD, name: "Знімок.png", mime: "image/png", size: 3, data: "QUJD", request_id: "fs-1" },
  });
  r = await call(files, {
    method: "POST",
    body: { action: "small", order_number: ORD, name: "x", size: 1, data: "A".repeat(4.5 * 1024 * 1024) },
  });
  assert.equal(r.statusCode, 413, "малий файл понад ліміт Vercel не пересилається");
  assert.equal(calls.length, 0);

  r = await call(files, {
    method: "POST",
    body: { action: "chunk", order_number: ORD, upload_id: "u", offset: 0, data: "A".repeat(4.5 * 1024 * 1024) },
  });
  assert.equal(r.statusCode, 413, "частина понад ліміт Vercel не пересилається");
  assert.equal(calls.length, 0);

  await call(files, { method: "POST", body: { action: "chunk", order_number: ORD, upload_id: "u", offset: 3145728, data: "QUJD" } });
  const chunk = calls.pop();
  assert.equal(chunk.action, "file_upload_chunk");
  assert.equal(chunk.payload.offset, 3145728);

  await call(files, { method: "POST", body: { action: "status", order_number: ORD, upload_id: "u" } });
  assert.equal(calls.pop().action, "file_upload_status");

  await call(files, { method: "DELETE", query: { order_number: ORD, file_id: "f1" } });
  assert.deepEqual(calls.pop(), { action: "file_trash", payload: { order_number: ORD, file_id: "f1" } });

  r = await call(files, { method: "DELETE", query: { order_number: ORD } });
  assert.equal(r.statusCode, 400, "без file_id нічого не прибирається");

  await call(contractor, {
    method: "POST",
    body: {
      action: "send", order_number: ORD, request_id: "rid",
      options: { phone: false, email: true, hack: true, notes: "yes" },
    },
  });
  const send = calls.pop();
  assert.equal(send.action, "contractor_send");
  assert.deepEqual(send.payload.options, { phone: false, email: true }, "лише відомі пташки й лише true/false");
  assert.equal(send.payload.request_id, "rid");

  assert.equal(send.payload.purpose, "production", "без мети — звичайне надсилання у виробництво");

  await call(contractor, { method: "POST", body: { action: "preview", order_number: ORD, options: { finance: false } } });
  assert.deepEqual(calls.pop(), {
    action: "contractor_preview",
    payload: { order_number: ORD, options: { finance: false }, purpose: "production" },
  });

  // «На опрацювання»: мета, термін і завдання МАЮТЬ дійти до Apps Script — і в перегляді,
  // і в надсиланні. Раніше прошарок їх губив, і підрядник отримував «У ВИРОБНИЦТВО».
  const processing = {
    purpose: "processing", processing_due: "2026-09-18", processing_task: "  Порахувати виробничу вартість  ",
  };
  await call(contractor, { method: "POST", body: { action: "preview", order_number: ORD, options: {}, ...processing } });
  assert.deepEqual(calls.pop().payload, {
    order_number: ORD, options: {},
    purpose: "processing", processing_due: "2026-09-18", processing_task: "Порахувати виробничу вартість",
  });
  await call(contractor, { method: "POST", body: { action: "send", order_number: ORD, request_id: "rid-p", options: {}, ...processing } });
  const procSend = calls.pop();
  assert.equal(procSend.action, "contractor_send");
  assert.equal(procSend.payload.purpose, "processing");
  assert.equal(procSend.payload.processing_due, "2026-09-18");
  assert.equal(procSend.payload.processing_task, "Порахувати виробничу вартість");

  // Власний коментар підряднику доходить і в перегляд, і в надсилання; порожній — не передається.
  await call(contractor, { method: "POST", body: { action: "preview", order_number: ORD, options: {}, comment: "  Терміново, клієнт чекає  " } });
  assert.equal(calls.pop().payload.comment, "Терміново, клієнт чекає");
  await call(contractor, { method: "POST", body: { action: "send", order_number: ORD, request_id: "rid-c", options: {}, comment: "x".repeat(1500) } });
  assert.equal(calls.pop().payload.comment.length, 1000, "коментар обрізається до 1000 символів");
  await call(contractor, { method: "POST", body: { action: "send", order_number: ORD, request_id: "rid-e", options: {}, comment: "   " } });
  assert.ok(!("comment" in calls.pop().payload), "порожній коментар не передаємо");

  await call(contractor, {
    method: "POST",
    body: { action: "send", order_number: ORD, request_id: "rid-x", purpose: "processing", processing_due: "18.09.2026; DROP" },
  });
  assert.equal(calls.pop().payload.processing_due, "", "термін лише у форматі РРРР-ММ-ДД — інше Apps Script відхилить сам");
  await call(contractor, { method: "POST", body: { action: "send", order_number: ORD, request_id: "rid-y", purpose: "anything" } });
  assert.equal(calls.pop().payload.purpose, "production", "невідома мета не проходить");

  r = await call(contractor, { method: "POST", body: { action: "send_file", order_number: ORD } });
  assert.equal(r.statusCode, 400, "без file_id файл не надсилається");

  await call(contractor, { method: "POST", body: { action: "send_file", order_number: ORD, file_id: "f9", request_id: "rid:f9" } });
  assert.deepEqual(calls.pop(), { action: "contractor_send_file", payload: { order_number: ORD, file_id: "f9", request_id: "rid:f9" } });

  r = await call(contractor, { method: "GET" });
  assert.equal(r.statusCode, 405);

  // ── Ставки підрядника: /api/admin/order?resource=rates ──
  // Без входу (калькулятор до входу в кабінет): числа й дати є, приміток власника немає.
  signedIn = false;
  r = await call(rates, { method: "GET" });
  assert.equal(r.statusCode, 200);
  assert.deepEqual(r.body, { status: "ok", pricing: {
    versions: [{ from: "2026-11-01", rates: { solidRate: 2233, markupPct: 35 } }], today: "2026-11-02", current_from: "2026-11-01" } });
  assert.equal(calls.pop().action, "rates_get");
  // Потік запитів без входу з однієї адреси не доходить до Apps Script (квота Google не безмежна).
  let limited = 0;
  for (let i = 0; i < 60; i++) {
    const hit = await call(rates, { method: "GET", headers: { "x-forwarded-for": "203.0.113.7" } });
    if (hit.statusCode === 429) limited += 1; else calls.pop();
  }
  assert.equal(limited, 20, "40 запитів на хвилину проходять, решта — «спробуйте за хвилину»");
  // Змінювати ставки без входу не можна — до Apps Script запит не доходить.
  const before = calls.length;
  r = await call(rates, { method: "POST", body: { from: "2026-12-01", rates: { solidRate: 2300 } } });
  assert.equal(r.statusCode, 401);
  r = await call(rates, { method: "DELETE", query: { from: "2026-11-01" } });
  assert.equal(r.statusCode, 401);
  assert.equal(calls.length, before);
  // Із входом: перегляд — з примітками; збереження — лише відомі ставки, дата РРРР-ММ-ДД.
  signedIn = true;
  r = await call(rates, { method: "GET" });
  assert.equal(r.body.pricing.versions[0].note, "лист підрядника");
  calls.pop();
  r = await call(rates, { method: "POST", body: { from: "01.12.2026", rates: { solidRate: 2300 } } });
  assert.equal(r.statusCode, 400, "дата не у форматі РРРР-ММ-ДД");
  assert.equal(calls.length, before);
  r = await call(rates, { method: "POST", body: { from: "2026-12-01", note: "  метал подорожчав  ",
    rates: { solidRate: " 2 300,5 ", sectionalRate: 2450, hack: 1, coverRate: { evil: 1 }, markupPct: "", lamellaBendPrice: NaN } } });
  assert.equal(r.statusCode, 200);
  assert.deepEqual(calls.pop(), { action: "rates_save", payload: { rates_change: {
    from: "2026-12-01", rates: { solidRate: "2 300,5", sectionalRate: 2450 }, note: "метал подорожчав" } } });
  await call(rates, { method: "POST", body: { from: "2026-12-01", rates: { solidRate: 9999 }, confirm_large: "yes" } });
  assert.equal(calls.pop().payload.rates_change.confirm_large, undefined, "підтвердження великої зміни — лише справжнє true");
  await call(rates, { method: "POST", body: { from: "2026-12-01", rates: { solidRate: 9999 }, confirm_large: true } });
  assert.equal(calls.pop().payload.rates_change.confirm_large, true);
  r = await call(rates, { method: "DELETE", query: { from: "2026-12-01" } });
  assert.deepEqual(calls.pop(), { action: "rates_delete", payload: { rates_change: { from: "2026-12-01" } } });
  r = await call(rates, { method: "PATCH", body: { from: "2026-12-01" } });
  assert.equal(r.statusCode, 405);
  // Якими ставками клієнт порахував суми — доходить до Apps Script лише датою або "" (до першої зміни).
  await call(order, { method: "PATCH", body: { order_number: ORD, row: 4, patch: { revenue: 2713 }, priced_with_rates: "2026-11-01" } });
  assert.deepEqual(calls.pop().payload, { order_number: ORD, row: 4, patch: { revenue: 2713 }, priced_with_rates: "2026-11-01" });
  await call(order, { method: "PATCH", body: { order_number: ORD, row: 4, patch: { revenue: 2466 }, priced_with_rates: "" } });
  assert.equal(calls.pop().payload.priced_with_rates, "");
  await call(order, { method: "PATCH", body: { order_number: ORD, row: 4, patch: { revenue: 2466 }, priced_with_rates: "вчора" } });
  assert.equal("priced_with_rates" in calls.pop().payload, false, "щось інше, ніж дата, не передаємо");
  await call(order, { method: "POST", body: { action: "add_item", order_number: ORD, request_id: "r-1", item: { product_type: "basket", quantity: 1 }, priced_with_rates: "2026-11-01" } });
  assert.equal(calls.pop().payload.priced_with_rates, "2026-11-01");
  // Перерахунок замовлення за чинними ставками — дія картки.
  r = await call(order, { method: "POST", body: { action: "reprice", order_number: " " + ORD + " " } });
  assert.equal(r.statusCode, 200);
  assert.deepEqual(calls.pop(), { action: "order_reprice", payload: { order_number: ORD } });

  console.log("admin-files-api tests: OK");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
