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

// AVL-04: знімна бічна панель — окремим рядком, кількість у формулі, суми сходяться.
function testRemovableSidePanelMessage() {
  const msg = handler.formatTelegramMessage({
    order_number: "ORD-210926-016", first_name: "Андрій", phone: "+380000000000",
    items: [{
      product_type: "basket", basket_model: "AVL-04", basket_model_name: "Суцільний кошик зі знімною боковою частиною",
      construction_type: "Суцільний · AVL-04", size_w: 800, size_h: 550, size_d: 500, quantity: 2,
    }],
  });
  const fmt = (v) => Number(v).toLocaleString("uk-UA");
  assert.ok(msg.includes("0.99 м² × <b>" + fmt(2030) + " ₴/м²</b> × 2 шт. = <b>" + fmt(4019) + " ₴</b>"), "кількість у формулі кошика");
  assert.ok(msg.includes("Знімна бічна панель: 0.275 м² × <b>" + fmt(2030) + " ₴/м²</b> × 2 шт. = <b>" + fmt(1117) + " ₴</b>"), "окремий рядок знімної панелі");
  assert.ok(msg.includes("Вартість виробнича: <b>" + fmt(5136) + " ₴</b>"), "4 019 + 1 117 = 5 136");

  const plain = handler.formatTelegramMessage({
    order_number: "ORD-1", items: [{ product_type: "basket", construction_type: "Суцільний · AVL-01", size_w: 800, size_h: 550, size_d: 500, quantity: 1 }],
  });
  assert.ok(!plain.includes("Знімна бічна панель"), "інші моделі — без панелі");
  assert.ok(!plain.includes(" × 1 шт."), "одиниця — без «× 1 шт.»");
}

async function run() {
  testRemovableSidePanelMessage();
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
