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

// Кожна заявка в тестах — з «нової» адреси: обмеження 5 заявок за хвилину тут не перевіряється.
let submitSeq = 0;
async function submit(fetchImpl) {
  global.fetch = fetchImpl;
  submitSeq += 1;
  const req = {
    method: "POST",
    headers: {},
    socket: { remoteAddress: "127.0.1." + submitSeq },
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

  // Антивандальний — індивідуальний прорахунок: формули за площею в повідомленні власнику немає.
  const antivandal = handler.formatTelegramMessage({
    order_number: "ORD-2", items: [{ product_type: "basket", basket_type: "Антивандальний (більша товщина металу+ каркас)",
      construction_type: "Суцільний · AVL-01", size_w: 800, size_h: 550, size_d: 500, quantity: 1 }],
  });
  assert.ok(!antivandal.includes("₴/м²"), "без розкладки за площею");
  assert.ok(antivandal.includes("Потрібен індивідуальний прорахунок менеджера"));
  const complex = handler.formatTelegramMessage({
    order_number: "ORD-3", items: [{ product_type: "basket", basket_type: "Декоративний", pattern: "K9",
      construction_type: "Суцільний · AVL-01", size_w: 800, size_h: 550, size_d: 500, quantity: 1 }],
  });
  assert.ok(!complex.includes("₴/м²") && complex.includes("Потрібен індивідуальний прорахунок менеджера"), "складний візерунок — теж індивідуально");
}

// Змішана заявка: що формула не рахує — видно окремо, підсумок підписаний як неповний;
// небазовий колір — одна доплата на замовлення.
function testPartialTotalsAndColorFee() {
  const plain = (order) => handler.formatTelegramMessage(Object.assign({ order_number: "ORD-9", first_name: "Тест", phone: "+380" }, order))
    .replace(/<[^>]+>/g, "").replace(/[\u00a0\u202f]/g, " ");
  const basket = (extra) => Object.assign({ product_type: "basket", basket_model: "AVL-01", construction_type: "Суцільний · AVL-01",
    size_w: 800, size_h: 500, size_d: 500, quantity: 1, color: "Сірий (RAL 7016)", pattern: "K1" }, extra);
  const mixed = plain({ items: [
    basket({ color: "RAL 6005", quantity: 2 }),
    basket({ pattern: "K3" }),
    { product_type: "bracket", basket_model: "AVL-K-01", quantity: 1, color: "RAL 3000" },
    basket({ color: "RAL 3000" }),
  ] });
  [
    "• Кошик 1: 0.9 м² × 2 030 ₴/м² × 2 шт. = 3 654 ₴",
    "• Кошик 4: 0.9 м² × 2 030 ₴/м² = 1 827 ₴",
    "• Доплата за небазовий колір (на замовлення): 200 ₴",
    "• Кошик 2: індивідуальний прорахунок",
    "• Кронштейни 3: індивідуальний прорахунок",
    "• Разом виробнича (без позицій з індивідуальним прорахунком): 5 681 ₴",
  ].forEach((line) => assert.ok(mixed.includes(line), line + "\n---\n" + mixed));
  assert.equal(mixed.split("Доплата за небазовий колір").length - 1, 1, "доплата одна, хоч небазових кошиків два");

  assert.ok(!mixed.includes("• Тип: \n"), "порожній «Тип» не друкуємо");
  const one = plain({ items: [basket({ color: "RAL 6005" })] });
  assert.ok(one.includes("• Доплата за небазовий колір (на замовлення): 200 ₴") && one.includes("• Вартість виробнича: 2 027 ₴"), one);
  // «Інший» з уточненням базового RAL — це базовий колір (так само його бачить таблиця).
  assert.ok(!plain({ items: [basket({ color: "Інший", color_custom: "RAL 7016" })] }).includes("Доплата"));
  assert.ok(plain({ items: [basket({ color: "Інший", color_custom: "RAL 6005" })] }).includes("Доплата за небазовий колір"));
  const base = plain({ items: [basket({}), basket({})] });
  assert.ok(!base.includes("Доплата") && base.includes("• Разом виробнича: 3 654 ₴"), base);
  // Нічого не пораховано — доплату окремо не показуємо, лише «потрібен прорахунок».
  const none = plain({ items: [basket({ pattern: "K3", color: "RAL 6005" })] });
  assert.ok(!none.includes("Доплата") && none.includes("Потрібен індивідуальний прорахунок менеджера"), none);
}

// Google «тримає» відповідь, хоча заявку записано: сервер сам забирає результат і сам повторює
// спробу з тим самим request_id, а власник отримує сповіщення з правильним номером.
async function testResilientSheetsWrite() {
  const headers = (location) => ({ get: (name) => (name.toLowerCase() === "location" ? location : null) });
  const okJson = (body) => ({ ok: true, status: 200, json: async () => body });
  process.env.TELEGRAM_BOT_TOKEN = "t"; process.env.TELEGRAM_CHAT_ID = "c";
  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    // 1. Звичайний шлях Apps Script: POST → 302 → GET з відповіддю.
    let log = [];
    let res = await submit(async (url, options) => {
      log.push([options.method || "GET", String(url).slice(0, 34)]);
      if (String(url).includes("api.telegram.org")) return okJson({ ok: true });
      if (options.method === "POST") return { ok: false, status: 302, headers: headers("https://script.googleusercontent.test/echo?x=1"), json: async () => null };
      return okJson({ status: "ok", order_number: "ORD-010126-002" });
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.order_number, "ORD-010126-002");
    assert.deepEqual(log.map((x) => x[0]), ["POST", "GET", "POST"], "запис → результат → Telegram");

    // 2. Перша спроба обірвалась, друга (той самий request_id) повернула номер як повтор.
    const posts = [];
    let tg = 0, tgText = "";
    res = await submit(async (url, options) => {
      if (String(url).includes("api.telegram.org")) { tg += 1; tgText = JSON.parse(options.body).text; return okJson({ ok: true }); }
      posts.push(JSON.parse(options.body).request_id);
      if (posts.length === 1) throw Object.assign(new Error("aborted"), { name: "AbortError" });
      return okJson({ status: "ok", order_number: "ORD-010126-003", duplicate: true });
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.order_number, "ORD-010126-003");
    assert.deepEqual(posts, ["order-request-1", "order-request-1"], "повтор — з тим самим ID запиту");
    assert.equal(tg, 1, "власник отримує одне сповіщення");
    assert.ok(!tgText.includes("Повторне сповіщення"), "заявку записала наша ж перша спроба — це перше сповіщення, не повтор");

    // 2а. Клієнт надіслав ту саму заявку вдруге (таблиця одразу каже «вже є»): сповіщаємо ще раз —
    //     перше могло не дійти, — але з приміткою, що це повтор, а не друге замовлення.
    res = await submit(async (url, options) => {
      if (String(url).includes("api.telegram.org")) { tgText = JSON.parse(options.body).text; return okJson({ ok: true }); }
      return okJson({ status: "ok", order_number: "ORD-010126-003", duplicate: true });
    });
    assert.equal(res.statusCode, 200);
    assert.ok(tgText.startsWith("♻️ <b>Повторне сповіщення.</b>"), tgText.slice(0, 80));
    assert.ok(tgText.includes("ORD-010126-003"));

    // 3. Результат першої спроби загубився (GET віддає 404) — повторюємо всю спробу.
    let postCount = 0;
    res = await submit(async (url, options) => {
      if (String(url).includes("api.telegram.org")) return okJson({ ok: true });
      if (options.method === "POST") {
        postCount += 1;
        return postCount === 1
          ? { ok: false, status: 302, headers: headers("https://script.googleusercontent.test/lost"), json: async () => null }
          : okJson({ status: "ok", order_number: "ORD-010126-004", duplicate: true });
      }
      return { ok: false, status: 404, json: async () => null };
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.order_number, "ORD-010126-004");
    assert.equal(postCount, 2);

    // 4. Файл візерунку в таблицю не шлемо — лише його назву.
    let sheetBody = null;
    global.fetch = async (url, options) => {
      if (String(url).includes("api.telegram.org")) return okJson({ ok: true, result: {} });
      sheetBody = JSON.parse(options.body);
      return okJson({ status: "ok", order_number: "ORD-010126-005" });
    };
    const fileRes = response();
    await handler({ method: "POST", headers: {}, socket: { remoteAddress: "127.0.0.9" },
      body: { first_name: "Тест", phone: "+380000000000", request_id: "r-file", items: [], pattern_file: { name: "leaf.png", type: "image/png", size: 8, data: "QUJDREVGR0g=" } } }, fileRes);
    assert.equal(fileRes.statusCode, 200);
    assert.equal("pattern_file" in sheetBody, false, "тіло файлу до Google не йде");
    assert.equal(sheetBody.pattern_file_meta.name, "leaf.png");

    // 5. Google не відповідає взагалі — помилка після кількох спроб, Telegram не шлемо.
    let attempts = 0, tgCalls = 0;
    res = await submit(async (url) => {
      if (String(url).includes("api.telegram.org")) { tgCalls += 1; return okJson({ ok: true }); }
      attempts += 1;
      throw new Error("network down");
    });
    assert.equal(res.statusCode, 502);
    assert.equal(attempts, 3, "три спроби запису");
    assert.equal(tgCalls, 0);
  } finally {
    console.error = originalConsoleError;
    delete process.env.TELEGRAM_BOT_TOKEN; delete process.env.TELEGRAM_CHAT_ID;
  }
}

// Ламельні моделі: кришка типово є; якщо клієнт її прибрав — у сповіщенні власникові це видно.
function testCoverRemovedIsVisible() {
  const item = (extra) => Object.assign({ product_type: "basket", basket_model: "AVL-06", basket_model_name: "Суцільний ламельний кошик з кришкою",
    construction_type: "Суцільний · AVL-06", size_w: 800, size_h: 600, size_d: 500, quantity: 1 }, extra);
  const text = (it) => handler.formatTelegramMessage({ order_number: "ORD-071026-001", first_name: "Тест", phone: "+380000000000", items: [it] }).replace(/<[^>]+>/g, "");
  assert.ok(text(item({ has_cover: false })).includes("• Верхня кришка: БЕЗ кришки"));
  assert.ok(text(item({ has_cover: true })).includes("• Верхня кришка: Так"));
  assert.ok(!text(item({ has_cover: false, basket_model: "AVL-01", basket_model_name: "Суцільний кошик", construction_type: "Суцільний · AVL-01" })).includes("кришка"));
}

async function run() {
  testCoverRemovedIsVisible();
  testRemovableSidePanelMessage();
  testPartialTotalsAndColorFee();
  await testResilientSheetsWrite();
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
