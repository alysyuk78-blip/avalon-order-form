// Чати з клієнтами (Telegram Business): запис у таблицю (Apps Script у VM) і сервер кабінету.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const CODE = fs.readFileSync(path.join(__dirname, "..", "google-apps-script-v2.js"), "utf8");
const W = 50;
const blank = () => new Array(W).fill("");

function makeSheet(data) {
  const sheet = {
    data,
    getLastRow: () => data.length,
    getMaxColumns: () => W,
    appendRow(vals) { const r = blank(); vals.forEach((v, i) => { r[i] = v; }); data.push(r); },
    setColumnWidth() {}, setFrozenRows() {}, setRowHeight() {},
    getRange(r, c, nr, nc) {
      if (typeof r === "string") return new Proxy({}, { get: () => function () { return this; } });
      const rowsN = nr || 1, colsN = nc || 1;
      const rng = {
        getValues: () => { const out = []; for (let i = 0; i < rowsN; i++) out.push((data[r - 1 + i] || blank()).slice(c - 1, c - 1 + colsN)); return out; },
        setValues: (vals) => { vals.forEach((vr, i) => { while (data.length < r + i) data.push(blank()); vr.forEach((v, j) => { data[r - 1 + i][c - 1 + j] = v; }); }); return proxy; },
        setValue: (v) => rng.setValues([[v]]),
        clearContent: () => { for (let i = 0; i < rowsN; i++) for (let j = 0; j < colsN; j++) if (data[r - 1 + i]) data[r - 1 + i][c - 1 + j] = ""; return proxy; },
        createTextFinder: (text) => {
          const finder = { matchEntireCell: () => finder, findAll: () => {
            const out = [];
            for (let i = 0; i < rowsN; i++) if (String((data[r - 1 + i] || [])[c - 1]) === text) out.push({ getRow: () => r + i });
            return out;
          } };
          return finder;
        },
      };
      const proxy = new Proxy(rng, { get: (t, p) => (p in t ? t[p] : () => proxy) });
      return proxy;
    },
  };
  return sheet;
}

function loadGas() {
  const props = {};
  const orders = [blank()];
  const order = (num, nick, notes) => { const r = blank(); r[0] = num; r[2] = "Нове"; r[38] = nick || ""; r[31] = notes || ""; orders.push(r); };
  order("ORD-1", "petro_k");
  order("ORD-2", "", "Telegram: @Olena_V");
  order("ORD-3", "@Petro_K");          // новіше замовлення того ж клієнта
  const sheets = { "Замовлення": makeSheet(orders) };
  const ss = { getSheetByName: (n) => sheets[n] || null, insertSheet: (n) => (sheets[n] = makeSheet([blank()])) };
  const ctx = vm.createContext({
    console, Date,
    SpreadsheetApp: { getActiveSpreadsheet: () => ss, flush() {} },
    PropertiesService: { getScriptProperties: () => ({
      getProperty: (k) => (k in props ? props[k] : null), setProperty: (k, v) => { props[k] = String(v); },
      deleteProperty: (k) => { delete props[k]; }, getProperties: () => Object.assign({}, props) }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }), getDocumentLock: () => null },
    Utilities: { formatDate: () => "2026-10-20" },
  });
  vm.runInContext(CODE, ctx);
  return { ctx, props, sheets };
}

const NOW = 1792500000;
let mid = 0;
function msg(conn, chat, opts) {
  const o = opts || {};
  return Object.assign({
    business_connection_id: conn, message_id: o.id || ++mid, date: o.date || NOW,
    chat: Object.assign({ type: "private" }, chat),
    from: o.fromOwner ? { id: 111 } : { id: chat.id },
  }, o.text === undefined ? { text: "привіт" } : o.text === null ? {} : { text: o.text }, o.extra || {});
}
const petro = { id: 5002, first_name: "Петро", username: "petro_k" };
const olena = { id: 5001, first_name: "Олена", last_name: "В", username: "olena_v" };
const anon = { id: 5003, first_name: "Марко" };

function testGas() {
  const { ctx, props, sheets } = loadGas();
  const ingest = (update) => ctx.adminChatIngest_({ update });
  const rows = () => sheets["Чати"].data.slice(1).filter((r) => r[0]);

  // Підключення акаунта запамʼятовується разом із правом відповідати.
  ingest({ business_connection: { id: "c1", user: { id: 111, first_name: "Олександр" }, date: NOW, is_enabled: true, rights: { can_reply: true } } });
  ingest({ business_connection: { id: "c2", user: { id: 222, username: "avalon_ua" }, date: NOW, is_enabled: true, can_reply: false } });
  const conns = JSON.parse(props.TG_BUSINESS_CONNECTIONS);
  assert.equal(conns.c1.name, "Олександр");
  assert.equal(conns.c1.can_reply, true);
  assert.equal(conns.c2.name, "avalon_ua");
  assert.equal(conns.c2.can_reply, false);

  // Вхідне, вихідне, дубль доставки.
  const first = msg("c1", petro, { id: 10, text: "Скільки коштує?" });
  assert.equal(ingest({ business_message: first }).added, true);
  assert.equal(ingest({ business_message: first }).duplicate, true, "повтор доставки не пише вдруге");
  ingest({ business_message: msg("c1", petro, { id: 11, text: "Добрий день!", fromOwner: true, date: NOW + 60 }) });
  let r = rows();
  assert.equal(r.length, 2);
  assert.equal(r[0][0], "c1:5002:10");
  assert.equal(r[0][2], "Олександр", "акаунт — імʼя з підключення");
  assert.equal(r[0][3], "5002");
  assert.equal(r[0][5], "@petro_k");
  assert.equal(r[0][6], "Вхідне");
  assert.equal(r[1][6], "Вихідне", "написане власником — вихідне");

  // Автопривʼязка за ніком — до найновішого замовлення з цим ніком (регістр і @ не важать).
  assert.equal(props.chatlink_5002, "ORD-3");

  // Зміна й видалення.
  ingest({ edited_business_message: msg("c1", petro, { id: 10, text: "Скільки коштує AVL-08?" }) });
  r = rows();
  assert.equal(r[0][7], "Скільки коштує AVL-08?");
  assert.equal(r[0][11], "змінено");
  ingest({ deleted_business_messages: { business_connection_id: "c1", chat: { id: 5002, type: "private" }, message_ids: [11] } });
  assert.equal(rows()[1][11], "видалено");

  // Фото: найбільше, що вміщується в 4 МБ; підпис — текстом.
  ingest({ business_message: msg("c1", petro, { id: 12, text: null, date: NOW + 120, extra: { caption: "місце монтажу",
    photo: [{ file_id: "small", file_size: 1000 }, { file_id: "mid", file_size: 300000 }, { file_id: "huge", file_size: 9000000 }] } }) });
  r = rows();
  assert.equal(r[2][8], "фото");
  assert.equal(r[2][9], "mid");
  assert.equal(r[2][7], "місце монтажу");
  // Контакт клієнта — з телефоном.
  ingest({ business_message: msg("c2", olena, { id: 13, text: null, date: NOW + 30, extra: { contact: { first_name: "Олена", phone_number: "+380501112233" } } }) });
  assert.ok(/\+380501112233/.test(rows()[3][7]));
  // Групи бота не цікавлять.
  assert.equal(ingest({ business_message: msg("c1", { id: -100, type: "group", title: "Група" }) }).skipped, true);
  // Невідоме оновлення — пропускаємо без помилки.
  assert.equal(ingest({ message: { text: "боту напряму" } }).skipped, true);

  // Олена: нік є лише в примітках замовлення ORD-2.
  assert.equal(props.chatlink_5001, "ORD-2");

  // Чат без ніка — без привʼязки; список підказує лише за ніком.
  ingest({ business_message: msg("c1", anon, { id: 14, text: "Коли зустрінемось?", date: NOW + 200 }) });
  assert.equal(props.chatlink_5003, undefined);

  // Список чатів: найсвіжіший угорі, останнє повідомлення, звʼязок для відповіді.
  const list = ctx.adminChatList_();
  assert.deepEqual(list.chats.map((c) => c.chat_id), ["5003", "5002", "5001"]);
  const p = list.chats[1];
  assert.equal(p.name, "Петро");
  assert.equal(p.username, "petro_k");
  assert.equal(p.last.kind, "фото");
  assert.equal(p.connection_id, "c1");
  assert.deepEqual(p.orders, ["ORD-3"]);
  assert.deepEqual(p.suggested, ["ORD-1"], "старіше замовлення того ж клієнта — підказкою");
  assert.equal(list.connections.c1.name, "Олександр");

  // Переписка замовлення: старе ORD-1 не привʼязане, але знаходить чат за ніком.
  const byOrder = ctx.adminChatMessages_({ order_number: "ORD-1" });
  assert.deepEqual(byOrder.chats.map((c) => c.chat_id), ["5002"]);
  assert.equal(byOrder.messages.length, 3);
  assert.deepEqual(byOrder.messages.map((m) => m.key), ["c1:5002:10", "c1:5002:11", "c1:5002:12"], "за часом");
  assert.equal(byOrder.messages[1].out, true);
  assert.equal(ctx.adminChatMessages_({ order_number: "ORD-999" }).messages.length, 0);

  // Ручна привʼязка й відвʼязка.
  ctx.adminChatLink_({ chat_id: "5003", order_number: "ORD-1" });
  ctx.adminChatLink_({ chat_id: "5003", order_number: "ORD-2" });
  ctx.adminChatLink_({ chat_id: "5003", order_number: "ORD-2" });
  assert.equal(props.chatlink_5003, "ORD-1,ORD-2", "повторна привʼязка не дублює");
  assert.deepEqual(ctx.adminChatMessages_({ order_number: "ORD-1" }).chats.map((c) => c.chat_id).sort(), ["5002", "5003"]);
  ctx.adminChatLink_({ chat_id: "5003", order_number: "ORD-1", remove: true });
  assert.equal(props.chatlink_5003, "ORD-2");
  assert.throws(() => ctx.adminChatLink_({ chat_id: "abc", order_number: "ORD-1" }));
  assert.throws(() => ctx.adminChatLink_({ chat_id: "5003", order_number: "" }));

  // Відповідь із кабінету — вихідне з позначкою.
  ctx.adminChatLogOut_({ message: msg("c1", petro, { id: 15, text: "5 200 грн", fromOwner: true, date: NOW + 300, extra: { sender_business_bot: { id: 9 } } }) });
  const out = rows().find((x) => x[0] === "c1:5002:15");
  assert.equal(out[6], "Вихідне");
  assert.equal(out[11], "з кабінету");

  // «Прибрати з CRM»: рядки зникають, привʼязка теж, нові повідомлення не зберігаються.
  const before = rows().length;
  const forgot = ctx.adminChatForget_({ chat_id: "5003" });
  assert.equal(forgot.removed, 1);
  assert.equal(rows().length, before - 1);
  assert.ok(rows().every((x) => x[3] !== "5003"));
  assert.equal(props.chatlink_5003, undefined);
  assert.equal(ingest({ business_message: msg("c1", anon, { id: 16 }) }).ignored, true);
  assert.equal(rows().length, before - 1);

  const st = ctx.adminChatStatus_();
  assert.equal(st.messages, before - 1);
  assert.ok(st.last_at);
}

// ── Сервер кабінету ──
async function testHandler() {
  process.env.ADMIN_PASSWORD = "owner-password";
  process.env.ADMIN_SESSION_SECRET = "session-secret-for-tests";
  process.env.MANAGER_PASSWORD = "manager-password";
  const sheetsPath = require.resolve("../lib/admin-sheets");
  const real = require(sheetsPath);
  const calls = [];
  let sheetsFail = false;
  require.cache[sheetsPath].exports = {
    sendError: real.sendError,
    TIMING: real.TIMING,
    callAdminSheets: async (action, payload) => {
      calls.push({ action, payload });
      if (sheetsFail) { const e = new Error("Google Sheets не відповів"); e.status = 504; throw e; }
      if (action === "chat_list") return { status: "ok", chats: [{ chat_id: "1" }], connections: {} };
      return { status: "ok" };
    },
  };
  delete require.cache[require.resolve("../lib/admin-chat-handler")];
  const handler = require("../lib/admin-chat-handler");
  const { issueToken } = require("../lib/admin-auth");
  const owner = "Bearer " + issueToken(true, "owner");
  const manager = "Bearer " + issueToken(true, "manager");

  const tgCalls = [];
  let tgReply = {};
  global.fetch = async (url, opts) => {
    const method = String(url).split("/").pop();
    tgCalls.push({ method, body: opts && opts.body ? JSON.parse(opts.body) : null });
    const r = tgReply[method] || { ok: true, result: {} };
    return { ok: true, json: async () => (typeof r === "function" ? r() : r) };
  };

  async function call({ method = "GET", query = {}, body, headers = {} }) {
    const res = {
      statusCode: 200, headers: {}, body: null,
      setHeader(k, v) { this.headers[k] = v; }, status(c) { this.statusCode = c; return this; },
      json(b) { this.body = b; return this; }, send(b) { this.body = b; return this; }, end() { return this; },
    };
    await handler({ method, query: Object.assign({ resource: "chat" }, query), body, headers }, res);
    return res;
  }

  // Бота ще немає: вебхук — 404, список — порожній без звернення до таблиці.
  delete process.env.TELEGRAM_BUSINESS_BOT_TOKEN;
  assert.equal((await call({ method: "POST", query: { hook: "telegram" }, body: {} })).statusCode, 404);
  let r = await call({ headers: { authorization: manager }, query: { view: "list" } });
  assert.equal(r.statusCode, 200);
  assert.equal(r.body.configured, false);
  assert.equal(calls.length, 0);
  r = await call({ method: "POST", headers: { authorization: owner }, body: { action: "setup" } });
  assert.equal(r.statusCode, 400);

  process.env.TELEGRAM_BUSINESS_BOT_TOKEN = "123:BUSINESS";
  const secret = handler.webhookSecret("123:BUSINESS");
  assert.ok(/^[A-Za-z0-9_-]{1,256}$/.test(secret), "секрет — лише дозволені Telegram символи");

  // Вебхук: без секрету чи з чужим — 401; з правильним — передає лише бізнес-оновлення.
  const update = { update_id: 1, business_message: { message_id: 1, chat: { id: 5, type: "private" } }, message: { text: "x" } };
  assert.equal((await call({ method: "POST", query: { hook: "telegram" }, body: update })).statusCode, 401);
  assert.equal((await call({ method: "POST", query: { hook: "telegram" }, body: update, headers: { "x-telegram-bot-api-secret-token": "wrong" } })).statusCode, 401);
  r = await call({ method: "POST", query: { hook: "telegram" }, body: update, headers: { "x-telegram-bot-api-secret-token": secret } });
  assert.equal(r.statusCode, 200);
  assert.equal(calls[0].action, "chat_ingest");
  assert.deepEqual(Object.keys(calls[0].payload.update), ["business_message"]);
  // Таблиця не відповіла — 500, щоб Telegram доставив повторно.
  sheetsFail = true;
  r = await call({ method: "POST", query: { hook: "telegram" }, body: update, headers: { "x-telegram-bot-api-secret-token": secret } });
  assert.equal(r.statusCode, 500);
  sheetsFail = false;
  // Оновлення не про бізнес-чати — 200 без запису.
  calls.length = 0;
  r = await call({ method: "POST", query: { hook: "telegram" }, body: { update_id: 2, message: { text: "x" } }, headers: { "x-telegram-bot-api-secret-token": secret } });
  assert.equal(r.statusCode, 200);
  assert.equal(calls.length, 0);

  // Без входу — нічого не видно.
  assert.equal((await call({ query: { view: "list" } })).statusCode, 401);
  assert.equal((await call({ method: "POST", body: { action: "send", chat_id: "5", connection_id: "c1", text: "hi" } })).statusCode, 401);

  // Менеджер читає й відповідає, але не підключає бота і не прибирає чати.
  r = await call({ headers: { authorization: manager }, query: { view: "list" } });
  assert.equal(r.body.configured, true);
  assert.equal(r.body.chats.length, 1);
  assert.equal((await call({ method: "POST", headers: { authorization: manager }, body: { action: "setup" } })).statusCode, 403);
  assert.equal((await call({ method: "POST", headers: { authorization: manager }, body: { action: "forget", chat_id: "5" } })).statusCode, 403);
  assert.equal((await call({ headers: { authorization: manager }, query: { view: "status" } })).statusCode, 403);

  // Відповідь: Telegram прийняв — записуємо в таблицю.
  calls.length = 0; tgCalls.length = 0;
  tgReply = { sendMessage: { ok: true, result: { message_id: 77, chat: { id: 5, type: "private" }, text: "Добрий день" } } };
  r = await call({ method: "POST", headers: { authorization: manager }, body: { action: "send", chat_id: "5", connection_id: "c1", text: "  Добрий день " } });
  assert.equal(r.statusCode, 200);
  assert.equal(r.body.logged, true);
  assert.deepEqual(tgCalls[0].body, { business_connection_id: "c1", chat_id: 5, text: "Добрий день" });
  assert.equal(calls[0].action, "chat_log_out");
  // Таблиця не записала — повідомлення все одно пішло, кабінет про це знає.
  sheetsFail = true;
  r = await call({ method: "POST", headers: { authorization: manager }, body: { action: "send", chat_id: "5", connection_id: "c1", text: "ще" } });
  assert.equal(r.statusCode, 200);
  assert.equal(r.body.logged, false);
  sheetsFail = false;
  // Минуло 24 години — зрозуміле пояснення.
  tgReply = { sendMessage: { ok: false, description: "Bad Request: BUSINESS_PEER_USAGE_MISSING" } };
  r = await call({ method: "POST", headers: { authorization: manager }, body: { action: "send", chat_id: "5", connection_id: "c1", text: "hi" } });
  assert.equal(r.statusCode, 409);
  assert.ok(/24 годин/.test(r.body.error));
  // Перевірка введеного.
  assert.equal((await call({ method: "POST", headers: { authorization: manager }, body: { action: "send", chat_id: "5", connection_id: "c1", text: "   " } })).statusCode, 400);
  assert.equal((await call({ method: "POST", headers: { authorization: manager }, body: { action: "send", chat_id: "5", connection_id: "c1", text: "x".repeat(4097) } })).statusCode, 400);
  assert.equal((await call({ method: "POST", headers: { authorization: manager }, body: { action: "send", chat_id: "abc", connection_id: "c1", text: "x" } })).statusCode, 400);
  assert.equal((await call({ method: "POST", headers: { authorization: manager }, body: { action: "send", chat_id: "5", text: "x" } })).statusCode, 400);
  assert.equal((await call({ method: "POST", headers: { authorization: manager }, body: { action: "link", chat_id: "5", order_number: "a b;c" } })).statusCode, 400);

  // Підключення: чужий вебхук (Make.com) не перезаписуємо.
  tgCalls.length = 0;
  tgReply = { getWebhookInfo: { ok: true, result: { url: "https://hook.eu1.make.com/abc" } } };
  r = await call({ method: "POST", headers: { authorization: owner }, body: { action: "setup" } });
  assert.equal(r.statusCode, 409);
  assert.ok(!tgCalls.some((c) => c.method === "setWebhook"), "чужий вебхук не чіпаємо");
  // Токен бота заявок — відмова ще до звернення в Telegram.
  process.env.TELEGRAM_BOT_TOKEN = "123:BUSINESS";
  tgCalls.length = 0;
  r = await call({ method: "POST", headers: { authorization: owner }, body: { action: "setup" } });
  assert.equal(r.statusCode, 409);
  assert.equal(tgCalls.length, 0);
  delete process.env.TELEGRAM_BOT_TOKEN;
  // Новий бот — ставимо вебхук із секретом і лише бізнес-оновленнями.
  tgCalls.length = 0;
  let hookSet = false;
  tgReply = {
    getWebhookInfo: () => ({ ok: true, result: { url: hookSet ? handler.hookUrl() : "" } }),
    setWebhook: () => { hookSet = true; return { ok: true, result: true }; },
    getMe: { ok: true, result: { username: "avalon_chats_bot", first_name: "Avalon", can_connect_to_business: true } },
  };
  r = await call({ method: "POST", headers: { authorization: owner }, body: { action: "setup" } });
  assert.equal(r.statusCode, 200);
  const setCall = tgCalls.find((c) => c.method === "setWebhook");
  assert.equal(setCall.body.url, "https://avalon-order-form.vercel.app/api/admin/order?resource=chat&hook=telegram");
  assert.equal(setCall.body.secret_token, secret);
  assert.deepEqual(setCall.body.allowed_updates, handler.ALLOWED_UPDATES);
  assert.equal(r.body.bot.webhook_ok, true);
  assert.equal(r.body.bot.bot.business, true);
  // Стан для власника.
  r = await call({ headers: { authorization: owner }, query: { view: "status" } });
  assert.equal(r.statusCode, 200);
  assert.equal(r.body.bot.webhook_ok, true);
  // «Прибрати» — лише власник.
  r = await call({ method: "POST", headers: { authorization: owner }, body: { action: "forget", chat_id: "5" } });
  assert.equal(r.statusCode, 200);
  assert.equal(calls[calls.length - 1].action, "chat_forget");
}

testGas();
testHandler().then(() => console.log("chats: OK")).catch((err) => { console.error(err); process.exit(1); });
