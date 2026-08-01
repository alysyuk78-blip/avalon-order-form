const assert = require("assert");
const handler = require("../api/order");

process.env.GOOGLE_SHEET_URL = "https://example.test/exec";
delete process.env.TELEGRAM_BOT_TOKEN;
delete process.env.TELEGRAM_CHAT_ID;

function response() {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    end() { return this; },
  };
}

async function submit(fetchImpl) {
  global.fetch = fetchImpl;
  const req = {
    method: "POST",
    headers: {},
    socket: { remoteAddress: "127.0.0.1" },
    body: { first_name: "Тест", phone: "+380000000000", request_id: "order-request-1", items: [] },
  };
  const res = response();
  await handler(req, res);
  return res;
}

async function run() {
  let calls = 0;
  const originalConsoleError = console.error;
  console.error = () => {};
  let failed;
  try {
    failed = await submit(async () => {
      calls += 1;
      return { ok: true, status: 200, json: async () => ({ status: "error", message: "write failed" }) };
    });
  } finally {
    console.error = originalConsoleError;
  }
  assert.equal(failed.statusCode, 502);
  assert.equal(calls, 1, "після помилки Sheets Telegram не викликається");

  let sentBody = null;
  const ok = await submit(async (_url, options) => {
    sentBody = JSON.parse(options.body);
    return { ok: true, status: 200, json: async () => ({ status: "ok", order_number: "ORD-010126-001" }) };
  });
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.body.order_number, "ORD-010126-001");
  assert.equal(sentBody.request_id, "order-request-1");
}

run().then(() => console.log("api-order tests: OK")).catch(err => {
  console.error(err);
  process.exit(1);
});
