// API файлів і надсилання підряднику: перевірка вхідних даних до того, як запит
// піде в Apps Script (зайве туди не потрапляє, завеликі частини відсікаються тут).
const assert = require("assert");

const calls = [];
const sheetsPath = require.resolve("../lib/admin-sheets");
require(sheetsPath);
require.cache[sheetsPath].exports = {
  callAdminSheets: async (action, payload) => {
    calls.push({ action, payload });
    return { status: "ok", action };
  },
  sendError: (res, err) => res.status(err.status || 500).json({ error: err.message }),
};

const authPath = require.resolve("../lib/admin-auth");
require(authPath);
require.cache[authPath].exports = {
  requireAdmin: () => true,
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

  console.log("admin-files-api tests: OK");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
