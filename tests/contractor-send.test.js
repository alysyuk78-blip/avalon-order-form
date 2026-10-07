// Надсилання підряднику з пташками та файли замовлення на Google Диску.
// Apps Script запускається у VM з підміненими сервісами Google.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const CODE = fs.readFileSync(path.join(__dirname, "..", "google-apps-script-v2.js"), "utf8");
const ORD = "ORD-110926-001";

function load(extra) {
  const ctx = vm.createContext(Object.assign({ console, Date }, extra || {}));
  vm.runInContext(CODE, ctx);
  return ctx;
}

function makeCache() {
  const store = new Map();
  return {
    get: (k) => (store.has(k) ? store.get(k) : null),
    put: (k, v) => { store.set(k, v); },
    remove: (k) => { store.delete(k); },
  };
}

function makeProps(initial) {
  const store = Object.assign({}, initial || {});
  return {
    getProperty: (k) => (k in store ? store[k] : null),
    setProperty: (k, v) => { store[k] = String(v); },
    deleteProperty: (k) => { delete store[k]; },
    getProperties: () => Object.assign({}, store),
    _store: store,
  };
}

function iter(arr) {
  let i = 0;
  return { hasNext: () => i < arr.length, next: () => arr[i++] };
}

// Мінімальний Google Диск у пам'яті: теки, файли, батьки, кошик, доступ.
function makeDrive() {
  const folders = {};
  const files = {};
  let n = 0;
  function folder(name, parentId) {
    const id = "fld" + (++n);
    const f = {
      id, name, parentId, trashed: false,
      getId: () => id,
      getName: () => name,
      getUrl: () => "https://drive.test/folder/" + id,
      isTrashed: () => f.trashed,
      getFoldersByName: (nm) => iter(Object.values(folders).filter(x => x.parentId === id && x.name === nm && !x.trashed)),
      createFolder: (nm) => folder(nm, id),
      createFile: (blob) => file(blob.name, id, blob.bytes.length, blob.mime),
      getFiles: () => iter(Object.values(files).filter(x => x.parentId === id)),
      getFolders: () => iter(Object.values(folders).filter(x => x.parentId === id && !x.trashed)),
    };
    folders[id] = f;
    return f;
  }
  function file(name, parentId, size, mime) {
    const id = "fil" + (++n);
    const f = {
      id, name, parentId, size, mime: mime || "application/pdf",
      trashed: false, description: "", sharing: null,
      getId: () => id,
      getName: () => name,
      getSize: () => size,
      getMimeType: () => f.mime,
      getDateCreated: () => new Date("2026-09-11T09:00:00Z"),
      getUrl: () => "https://drive.test/file/" + id,
      getDescription: () => f.description,
      setDescription: (d) => { f.description = d; return f; },
      isTrashed: () => f.trashed,
      setTrashed: (t) => { f.trashed = t; return f; },
      getParents: () => iter([folders[parentId]]),
      getBlob: () => ({ fileId: id, setName() { return this; } }),
      setSharing: (access, permission) => { f.sharing = [access, permission]; return f; },
    };
    files[id] = f;
    return f;
  }
  return {
    _folders: folders,
    _file: file,
    getFolderById: (id) => { if (!folders[id]) throw new Error("немає теки"); return folders[id]; },
    getFileById: (id) => { if (!files[id]) throw new Error("немає файлу"); return files[id]; },
    getFoldersByName: (nm) => iter(Object.values(folders).filter(x => !x.parentId && x.name === nm)),
    createFolder: (nm) => folder(nm, null),
    Access: { ANYONE_WITH_LINK: "ANYONE_WITH_LINK" },
    Permission: { VIEW: "VIEW" },
  };
}

function httpResponse(code, body, headers) {
  return {
    getResponseCode: () => code,
    getContentText: () => (typeof body === "string" ? body : JSON.stringify(body || {})),
    getAllHeaders: () => headers || {},
    getHeaders: () => headers || {},
  };
}

// ── Пташки: що саме бачить підрядник ───────────────────────────────────────
function testMessageOptions() {
  const ctx = load({ Utilities: { formatDate: () => "Пт 11.09.2026, 10:18" } });
  const order = {
    order_number: ORD, first_name: "Олександр Заєць", phone: "+380673406685",
    contact_method: "viber", contact_telegram: "zaets", contact_email: "zaets@example.com",
    city: "Київ", transport: "Нова пошта", delivery_address: "НП №5", referral_source: "Телефон",
    notes: "Telegram: @zaets\nПосилання на модель: https://example.com/model",
    commission_pct: 30,
    items: [{ product_type: "other", basket_model_name: "Ковш", quantity: 1, cost_total: 9650, revenue: 13790, profit: 4140, commission: 1242 }],
  };
  const plain = (opts) => ctx.buildProductionMsg_(order, opts).replace(/<[^>]+>/g, "");

  const all = plain();
  ["Олександр Заєць", "+380673406685 · Viber", "Telegram: @zaets", "zaets@example.com", "Київ",
    "НП №5", "Ціна для клієнта", "Посилання на модель"].forEach((s) => {
    assert.ok(all.includes(s), "типово надсилається: " + s);
  });
  assert.ok(!all.includes("Джерело"), "джерело заявки підряднику не надсилається ніколи");
  assert.ok(!all.includes("Телефон\n") && !/Джерело заявки: Телефон/.test(all));
  assert.equal(all.split("@zaets").length - 1, 1, "Telegram не дублюється з приміток");

  const noContacts = plain({ client_name: false, phone: false, telegram: false, email: false, city: false });
  ["Олександр", "+380", "zaets", "Київ", "ЗАМОВНИК"].forEach((s) => {
    assert.ok(!noContacts.includes(s), "приховано: " + s);
  });
  assert.ok(noContacts.includes("Ковш"), "виріб надсилається завжди");
  assert.ok(noContacts.includes("Вартість виробнича: 9 650 ₴"), "собівартість надсилається завжди");
  assert.ok(noContacts.includes("Посилання на модель"), "звичайні примітки лишаються");

  const noFinance = plain({ finance: false });
  assert.ok(!noFinance.includes("Ціна для клієнта"), "ціну клієнта можна сховати");
  assert.ok(!noFinance.includes("МАРЖА AVALON"), "розрахунок маржі ховається разом із ціною");
  assert.ok(noFinance.includes("Вартість виробнича"));

  const noDelivery = plain({ address: false, notes: false });
  assert.ok(!noDelivery.includes("НП №5"), "адресу можна сховати");
  assert.ok(!noDelivery.includes("Посилання на модель"), "примітки можна сховати");
  assert.ok(noDelivery.includes("Нова пошта"), "спосіб доставки надсилається завжди");

  assert.equal(ctx.contractorOptions_(undefined).phone, true, "без пташок — усе, як раніше");
  assert.equal(ctx.contractorOptions_({ phone: false }).phone, false);
  assert.equal(ctx.contractorOptions_({ phone: "false" }).phone, false);
  assert.equal(ctx.contractorOptions_({ phone: false }).email, true, "не передана пташка = так");
}

// ── Зміна статусу з CRM не шле підряднику сама ─────────────────────────────
function testStatusChangeFromCrmDoesNotAutoSend() {
  let created = 0, notified = 0;
  const ctx = load({ PropertiesService: { getScriptProperties: () => makeProps() } });
  ctx.buildOrderFromRows_ = () => ({ order_number: ORD, items: [] });
  ctx.createOrderTopic_ = () => { created += 1; return { ok: true }; };
  ctx.notifyOwnerStatusChange_ = () => { notified += 1; };
  const sheet = { getRange: () => ({ getValue: () => ORD }), getLastRow: () => 1 };

  ctx.applyStatusSideEffects_(sheet, 2, "В роботі", { skipContractorSend: true });
  assert.equal(created, 0, "з CRM підряднику надсилає лише кнопка з пташками");
  assert.equal(notified, 1, "власник про зміну статусу дізнається, як і раніше");

  ctx.applyStatusSideEffects_(sheet, 2, "В роботі");
  assert.equal(created, 1, "зміна статусу в таблиці надсилає, як і раніше");
}

// ── Завантаження частинами на Google Диск ──────────────────────────────────
function testResumableUpload() {
  const drive = makeDrive();
  const cache = makeCache();
  const props = makeProps();
  const calls = [];
  const replies = [];
  const ctx = load({
    DriveApp: drive,
    CacheService: { getScriptCache: () => cache },
    PropertiesService: { getScriptProperties: () => props },
    ScriptApp: { getOAuthToken: () => "token" },
    Utilities: {
      base64Decode: (s) => Array.from(Buffer.from(s, "base64")),
      getUuid: () => "up-1",
      formatDate: () => "2026-09-11T12:30",
    },
    UrlFetchApp: { fetch: (url, opts) => { calls.push({ url, opts }); return replies.shift(); } },
  });

  const size = 3 * 1024 * 1024 + 10;
  replies.push(httpResponse(200, "", { Location: "https://upload.test/session-1" }));
  const init = ctx.adminFileUploadInit_({ order_number: ORD, name: "Креслення (1).pdf", mime: "application/pdf", size });
  assert.equal(init.upload_id, "up-1");
  assert.ok(calls[0].url.includes("uploadType=resumable"));
  assert.equal(calls[0].opts.headers["X-Upload-Content-Length"], String(size));
  const meta = JSON.parse(calls[0].opts.payload);
  assert.equal(meta.name, "Креслення (1).pdf", "імʼя файлу не псується");
  const folderId = meta.parents[0];
  assert.equal(drive._folders[folderId].name, ORD, "файл іде в теку свого замовлення");
  assert.equal(drive._folders[drive._folders[folderId].parentId].name, "AVALON CRM — файли замовлень");

  // Частина 1: Диск відповідає 308 і каже, скільки байтів уже має.
  replies.push(httpResponse(308, "", { Range: "bytes=0-3145727" }));
  const r1 = ctx.adminFileUploadChunk_({
    order_number: ORD, upload_id: "up-1", offset: 0,
    data: Buffer.alloc(3 * 1024 * 1024, 1).toString("base64"),
  });
  assert.equal(r1.done, false);
  assert.equal(r1.next_offset, 3145728);
  assert.equal(calls[1].url, "https://upload.test/session-1");
  assert.equal(calls[1].opts.headers["Content-Range"], "bytes 0-3145727/" + size);
  assert.equal(calls[1].opts.followRedirects, false, "308 — це «продовжуй», а не редирект");

  // Остання частина: Диск повертає створений файл.
  const saved = drive._file("Креслення (1).pdf", folderId, size);
  replies.push(httpResponse(200, { id: saved.id }));
  const r2 = ctx.adminFileUploadChunk_({
    order_number: ORD, upload_id: "up-1", offset: 3145728,
    data: Buffer.alloc(10, 2).toString("base64"),
  });
  assert.equal(r2.done, true);
  assert.equal(r2.file.id, saved.id);
  assert.equal(r2.file.via_link, false);
  assert.equal(calls[2].opts.headers["Content-Range"], "bytes 3145728-3145737/" + size);
  assert.equal(cache.get("upl_up-1"), null, "сесію прибрано після завершення");
  assert.equal(props.getProperty("files_count_" + ORD), "1", "після завантаження скріпка знає про файл");

  // Після обриву зв'язку клієнт питає Диск, скільки вже дійшло.
  cache.put("upl_up-3", JSON.stringify({ uri: "https://upload.test/s3", order: ORD, size: 100, mime: "x" }));
  replies.push(httpResponse(308, "", { range: "bytes=0-49" }));
  const st = ctx.adminFileUploadStatus_({ order_number: ORD, upload_id: "up-3" });
  assert.equal(st.next_offset, 50, "назва заголовка Range — без огляду на регістр");
  assert.equal(calls[3].opts.headers["Content-Range"], "bytes */100");

  // Чужа сесія, вихід за межі файлу, завеликий файл — відмова.
  cache.put("upl_up-2", JSON.stringify({ uri: "u", order: ORD, size: 5, mime: "x" }));
  assert.throws(() => ctx.adminFileUploadChunk_({ order_number: "ORD-110926-002", upload_id: "up-2", offset: 0, data: "AAAA" }),
    /іншому замовленню/);
  assert.throws(() => ctx.adminFileUploadChunk_({ order_number: ORD, upload_id: "up-2", offset: 4, data: Buffer.alloc(3).toString("base64") }),
    /межі файлу/);
  assert.throws(() => ctx.adminFileUploadInit_({ order_number: ORD, name: "x.mp4", size: 301 * 1024 * 1024 }), /300 МБ/);
  assert.throws(() => ctx.adminFileUploadInit_({ order_number: "ORD-1", name: "x", size: 10 }), /Невірний номер/);
}

// ── Файл підряднику: до 48 МБ — файлом, більше — посиланням ────────────────
function testSendFileToContractor() {
  const drive = makeDrive();
  const cache = makeCache();
  const props = makeProps({ TG_TOKEN: "tg", TG_CONTRACTOR_CHAT: "-100", ["thread_" + ORD]: "77" });
  const sent = [];
  const ctx = load({
    DriveApp: drive,
    CacheService: { getScriptCache: () => cache },
    PropertiesService: { getScriptProperties: () => props },
    Utilities: { formatDate: () => "2026-09-11T12:30" },
    UrlFetchApp: { fetch: (url, opts) => { sent.push({ url, opts }); return httpResponse(200, { ok: true, result: {} }); } },
  });
  const root = drive.createFolder("AVALON CRM — файли замовлень");
  props.setProperty("FILES_ROOT_ID", root.id);
  const folder = root.createFolder(ORD);
  const photo = drive._file("фото.jpg", folder.id, 2 * 1024 * 1024, "image/jpeg");
  const video = drive._file("відео.mp4", folder.id, 120 * 1024 * 1024, "video/mp4");

  const r1 = ctx.adminContractorSendFile_({ order_number: ORD, file_id: photo.id, request_id: "r1" });
  assert.equal(r1.how, "file");
  assert.ok(sent[0].url.endsWith("/sendDocument"));
  assert.equal(sent[0].opts.payload.message_thread_id, "77", "файл іде в гілку свого замовлення");
  assert.ok(/avalon_sent_to_contractor:2026-09-11T12:30/.test(photo.description), "файл позначено надісланим");
  assert.equal(r1.file.sent_at, "2026-09-11T12:30");

  ctx.adminContractorSendFile_({ order_number: ORD, file_id: photo.id, request_id: "r1" });
  assert.equal(sent.length, 1, "повтор із тим самим request_id не шле дубль");

  const r2 = ctx.adminContractorSendFile_({ order_number: ORD, file_id: video.id, request_id: "r2" });
  assert.equal(r2.how, "link", "понад 48 МБ Telegram не прийме від бота — посилання");
  assert.deepEqual(video.sharing, ["ANYONE_WITH_LINK", "VIEW"]);
  assert.ok(sent[1].url.endsWith("/sendMessage"));
  assert.ok(JSON.parse(sent[1].opts.payload).text.includes("https://drive.test/file/" + video.id));
  assert.equal(r2.file.sent_as_link, true);

  // Файл з іншого замовлення надіслати не можна (id приходить із браузера).
  const other = root.createFolder("ORD-110926-002");
  const foreign = drive._file("чуже.pdf", other.id, 1000);
  assert.throws(() => ctx.adminContractorSendFile_({ order_number: ORD, file_id: foreign.id }), /не належить/);

  // Поки саме замовлення не надіслане — файли не шлемо (їм нема до чого прив'язатись).
  props.deleteProperty("thread_" + ORD);
  assert.throws(() => ctx.adminContractorSendFile_({ order_number: ORD, file_id: photo.id }), /Спершу надішліть/);

  // Прибрати файл — у кошик Диска, список оновлюється.
  props.setProperty("files_folder_" + ORD, folder.id);
  const list = ctx.adminFileTrash_({ order_number: ORD, file_id: photo.id });
  assert.equal(photo.trashed, true);
  assert.deepEqual(list.files.map(f => f.id), [video.id]);
  assert.equal(props.getProperty("files_count_" + ORD), "1", "після видалення лічильник зменшився");
}

// ── Повідомлення з CRM: нова гілка або оновлення в ту саму, статус «В роботі» ──
function testContractorSendFlow() {
  const cache = makeCache();
  const props = makeProps({ TG_TOKEN: "tg", TG_CONTRACTOR_CHAT: "-100" });
  const tg = [];
  const statuses = [["ORD-110926-001", "", "Нове"], ["ORD-110926-001", "", "Нове"], ["ORD-110926-009", "", "Нове"]];
  const sheet = {
    getLastRow: () => statuses.length + 1,
    getRange: (r, c, nr, nc) => {
      if (nr) return { getValues: () => statuses.map(x => x.slice(0, nc)) };
      return { setValue: (v) => { statuses[r - 2][c - 1] = v; } };
    },
  };
  const ctx = load({
    CacheService: { getScriptCache: () => cache },
    PropertiesService: { getScriptProperties: () => props },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    Utilities: { formatDate: () => "2026-09-11T12:30" },
  });
  ctx.adminOrdersSheet_ = () => sheet;
  ctx.buildOrderFromRows_ = () => ({ order_number: ORD, first_name: "Олександр", phone: "+380", items: [] });
  ctx.notifyOwnerStatusChange_ = () => {};
  ctx.tgApi_ = (method, payload) => {
    tg.push({ method, payload });
    if (method === "createForumTopic") return { ok: true, result: { message_thread_id: 55 } };
    return { ok: true, result: {} };
  };

  const first = ctx.adminContractorSend_({ order_number: ORD, options: { phone: false }, request_id: "s1" });
  assert.equal(first.update, false);
  assert.equal(first.status_changed, true, "надіслане «Нове» стає «В роботі»");
  assert.deepEqual(statuses.map(x => x[2]), ["Виготовлення", "Виготовлення", "Нове"], "лише рядки цього замовлення");
  assert.equal(props.getProperty("thread_" + ORD), "55");
  assert.equal(props.getProperty("sent_" + ORD), "2026-09-11T12:30");
  const firstText = tg.find(x => x.method === "sendMessage").payload.text;
  assert.ok(!firstText.includes("+380"), "пташки з CRM застосовані до повідомлення");
  assert.ok(firstText.startsWith("🏭 <b>У ВИРОБНИЦТВО</b>"), "перше надсилання — у виробництво");

  assert.deepEqual(ctx.adminContractorSend_({ order_number: ORD, request_id: "s1" }), first,
    "повтор із тим самим request_id повертає той самий результат без нового повідомлення");
  assert.equal(tg.filter(x => x.method === "sendMessage").length, 1);

  const second = ctx.adminContractorSend_({ order_number: ORD, request_id: "s2" });
  assert.equal(second.update, true, "вдруге — оновлення");
  const upd = tg.filter(x => x.method === "sendMessage")[1].payload;
  assert.equal(upd.message_thread_id, 55, "в ту саму гілку");
  assert.ok(upd.text.startsWith("🔄 <b>ОНОВЛЕНО ЗАМОВЛЕННЯ</b>"));
  assert.equal(second.status_changed, false, "статус уже «В роботі» — не чіпаємо");
}

// ── Аркуш «Замовлення» в памʼяті (сценарії зі статусами й терміном) ─────────
function makeSheet(rows) {
  const W = 50;
  const pad = (r) => { const a = r.slice(); while (a.length < W) a.push(""); return a; };
  const data = [new Array(W).fill("")].concat(rows.map(pad));
  return {
    data,
    getLastRow: () => data.length,
    deleteRow: (r) => { data.splice(r - 1, 1); },
    insertRowsAfter: (r, n) => { for (let k = 0; k < n; k++) data.splice(r, 0, new Array(W).fill("")); },
    getMaxColumns: () => W,
    getMaxRows: () => 1000,
    setConditionalFormatRules: () => {},
    getRange(r, c, nr, nc) {
      if (typeof r === "string") return { setDataValidation() { return this; } };
      const rowsN = nr || 1, colsN = nc || 1;
      const rng = {
        getValues: () => {
          const out = [];
          for (let i = 0; i < rowsN; i++) out.push((data[r - 1 + i] || new Array(W).fill("")).slice(c - 1, c - 1 + colsN));
          return out;
        },
        setValues: (vals) => {
          vals.forEach((vr, i) => {
            while (data.length < r + i) data.push(new Array(W).fill(""));
            vr.forEach((v, j) => { data[r - 1 + i][c - 1 + j] = v; });
          });
          return rng;
        },
        getValue: () => (data[r - 1] || [])[c - 1],
        setValue: (v) => rng.setValues([[v]]),
        setDataValidation: () => rng,
      };
      return rng;
    },
  };
}

function orderRow(num, status, extra) {
  const r = new Array(50).fill("");
  r[0] = num; r[2] = status; r[4] = "Олександр Заєць"; r[5] = "'+380673406685"; r[6] = "Київ";
  r[16] = 1; r[19] = 9650; r[21] = 13790; r[22] = 4140; r[40] = "Ковш для трактора"; r[41] = "Інший виріб";
  Object.keys(extra || {}).forEach((k) => { r[Number(k)] = extra[k]; });
  return r;
}

function makeCalendar() {
  const events = {};
  let n = 0;
  const cal = {
    getName: () => "Замовлення AVALON",
    createEvent: (title, start, end, opts) => {
      const id = "ev" + (++n);
      const ev = {
        id, title, start, end, description: opts && opts.description, reminders: [], deleted: false,
        getId: () => id,
        removeAllReminders() { ev.reminders = []; },
        addPopupReminder(m) { ev.reminders.push("popup:" + m); },
        addEmailReminder(m) { ev.reminders.push("email:" + m); },
        deleteEvent() { ev.deleted = true; },
      };
      events[id] = ev;
      return ev;
    },
  };
  return { events, api: { getAllCalendars: () => [cal], getDefaultCalendar: () => cal, getEventById: (id) => events[id] || null } };
}

function makeSpreadsheetApp() {
  const chain = () => {
    const b = {};
    ["requireValueInList", "setAllowInvalid", "whenTextEqualTo", "whenFormulaSatisfied", "setBackground",
      "setFontColor", "setBold", "setRanges"].forEach((m) => { b[m] = () => b; });
    b.build = () => ({});
    return b;
  };
  return { newDataValidation: chain, newConditionalFormatRule: chain };
}

function processingContext(sheet, props, calendar, tg) {
  const cache = makeCache();
  const ctx = load({
    CacheService: { getScriptCache: () => cache },
    PropertiesService: { getScriptProperties: () => props },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    CalendarApp: calendar.api,
    Utilities: { formatDate: () => "2026-09-11T12:30" },
  });
  ctx.adminOrdersSheet_ = () => sheet;
  ctx.notifyOwnerStatusChange_ = () => {};
  ctx.tgApi_ = (method, payload) => {
    tg.push({ method, payload });
    return method === "createForumTopic" ? { ok: true, result: { message_thread_id: 55 } } : { ok: true, result: {} };
  };
  return ctx;
}

// ── Нові статуси: «В роботі» → «Виготовлення», міграція разова ────────────
function testStatusesMigrationAndCanon() {
  const props = makeProps();
  const sheet = makeSheet([orderRow("ORD-110926-101", "В роботі"), orderRow("ORD-110926-102", "Нове"), orderRow("ORD-110926-103", "Завершено")]);
  const ctx = load({ PropertiesService: { getScriptProperties: () => props }, SpreadsheetApp: makeSpreadsheetApp() });

  assert.deepEqual(Array.from(ctx.STATUSES),
    ["Нове", "В опрацюванні підрядником", "Виготовлення", "Готове", "Відправлено", "Завершено", "Скасовано"]);
  assert.equal(ctx.canonStatus_("В роботі"), "Виготовлення");
  assert.equal(ctx.canonStatus_(" Нове "), "Нове");

  ctx.ensureStatusesV2Once_(sheet);
  assert.deepEqual(sheet.data.slice(1).map((r) => r[2]), ["Виготовлення", "Нове", "Завершено"]);
  assert.equal(props.getProperty("STATUSES_V2_READY"), "1");
  sheet.data[1][2] = "В роботі";
  ctx.ensureStatusesV2Once_(sheet);
  assert.equal(sheet.data[1][2], "В роботі", "міграція разова");

  // Навіть до міграції кабінет бачить нову назву; термін і завдання доходять до CRM.
  const mapped = ctx.mapOrderRow_(2, orderRow("ORD-110926-101", "В роботі", { 46: "2026-09-15", 47: "Розробити конструктив" }));
  assert.equal(mapped.status, "Виготовлення");
  assert.equal(mapped.processing_due, "2026-09-15");
  assert.equal(mapped.processing_task, "Розробити конструктив");

  const widths = CODE.match(/var widths = \[([^\]]+)\]/)[1].split(",").length;
  assert.equal(ctx.ADMIN_ORDER_COLS, 50);
  assert.equal(widths, ctx.ADMIN_ORDER_COLS, "ширин колонок стільки ж, скільки колонок");
}

// ── На опрацювання → Календар → погоджено, у виробництво ───────────────────
function testProcessingFlow() {
  const props = makeProps({ TG_TOKEN: "tg", TG_CONTRACTOR_CHAT: "-100" });
  const calendar = makeCalendar();
  const tg = [];
  const sheet = makeSheet([orderRow(ORD, "Нове"), orderRow(ORD, "Нове"), orderRow("ORD-110926-009", "Нове")]);
  const ctx = processingContext(sheet, props, calendar, tg);
  const messages = () => tg.filter((x) => x.method === "sendMessage").map((x) => x.payload.text);

  assert.throws(() => ctx.adminContractorSend_({ order_number: ORD, purpose: "processing", request_id: "p0" }),
    /термін опрацювання/i, "без терміну на опрацювання не надсилаємо");

  const r1 = ctx.adminContractorSend_({
    order_number: ORD, purpose: "processing", processing_due: "2026-09-15",
    processing_task: "Порахувати виробничу вартість", request_id: "p1",
  });
  assert.equal(r1.status_changed, true);
  assert.equal(r1.prev_status, "Нове");
  assert.equal(r1.new_status, "В опрацюванні підрядником");
  assert.deepEqual(sheet.data.slice(1).map((r) => r[2]),
    ["В опрацюванні підрядником", "В опрацюванні підрядником", "Нове"], "лише рядки цього замовлення");
  assert.equal(sheet.data[1][46], "2026-09-15");
  assert.equal(sheet.data[2][47], "Порахувати виробничу вартість");
  assert.equal(sheet.data[3][46], "", "чужі замовлення не чіпаємо");
  assert.ok(messages()[0].startsWith("🧮 <b>НА ОПРАЦЮВАННЯ</b>"), "підрядник бачить, що це ще не у виробництво");
  assert.ok(messages()[0].includes("Порахувати виробничу вартість"));
  assert.ok(messages()[0].includes("до 15.09.2026"));

  // Подія в Google Календарі на день терміну, нагадування за добу й у сам день.
  const ev1 = calendar.events[props.getProperty("proc_evt_" + ORD)];
  assert.ok(ev1, "подію створено");
  assert.ok(ev1.title.includes(ORD) && ev1.title.includes("Опрацювання підрядником"));
  assert.deepEqual([ev1.start.getFullYear(), ev1.start.getMonth(), ev1.start.getDate(), ev1.start.getHours()], [2026, 8, 15, 9]);
  assert.deepEqual(ev1.reminders.slice().sort(), ["email:0", "popup:0", "popup:1440"]);
  assert.ok(ev1.description.includes("Порахувати виробничу вартість"));
  assert.equal(ctx.syncProcessingEvent_(sheet, ORD), "same", "той самий термін — подію не перестворюємо");

  // Підрядник попросив більше часу: новий термін — стара подія зникає, нова на нову дату.
  ctx.setProcessingFields_(sheet, ORD, "2026-09-18", "Порахувати виробничу вартість");
  assert.equal(ctx.syncProcessingEvent_(sheet, ORD), "created");
  assert.equal(ev1.deleted, true);
  const ev2 = calendar.events[props.getProperty("proc_evt_" + ORD)];
  assert.equal(ev2.start.getDate(), 18);

  // Погодили — у виробництво: інший заголовок, статус «Виготовлення», нагадування прибрано.
  const r2 = ctx.adminContractorSend_({ order_number: ORD, purpose: "production", request_id: "p2" });
  assert.equal(r2.update, true);
  assert.equal(r2.prev_status, "В опрацюванні підрядником");
  assert.equal(r2.new_status, "Виготовлення");
  assert.ok(messages()[1].startsWith("✅ <b>ПОГОДЖЕНО — ЗАПУСКАЄМО У ВИРОБНИЦТВО</b>"));
  assert.equal(ev2.deleted, true, "після опрацювання нагадування в Календарі не потрібне");
  assert.equal(props.getProperty("proc_evt_" + ORD), null);

  // Статус назад не відкочується; наступне — звичайне оновлення.
  const r3 = ctx.adminContractorSend_({ order_number: ORD, purpose: "processing", processing_due: "2026-09-20", request_id: "p3" });
  assert.equal(r3.status_changed, false);
  assert.ok(messages()[2].startsWith("🔄 <b>ОНОВЛЕНО — НА ОПРАЦЮВАННЯ</b>"));
  assert.equal(sheet.data[1][2], "Виготовлення");
  assert.equal(Object.values(calendar.events).filter((e) => !e.deleted).length, 0, "не в опрацюванні — подій немає");
}

// ── Статус прямо в таблиці: опрацювання теж надсилає, вихід прибирає нагадування ──
function testSheetStatusProcessing() {
  const props = makeProps({ TG_TOKEN: "tg", TG_CONTRACTOR_CHAT: "-100" });
  const calendar = makeCalendar();
  const tg = [];
  const sheet = makeSheet([orderRow(ORD, "В опрацюванні підрядником", { 46: "2026-09-16", 47: "Розробити конструктив нової моделі" })]);
  const ctx = processingContext(sheet, props, calendar, tg);

  ctx.applyStatusSideEffects_(sheet, 2, "В опрацюванні підрядником");
  const text = tg.find((x) => x.method === "sendMessage").payload.text;
  assert.ok(text.startsWith("🧮 <b>НА ОПРАЦЮВАННЯ</b>"));
  assert.ok(text.includes("Розробити конструктив нової моделі") && text.includes("до 16.09.2026"));
  assert.equal(props.getProperty("sent_purpose_" + ORD), "processing");
  const ev = calendar.events[props.getProperty("proc_evt_" + ORD)];
  assert.ok(ev && ev.start.getDate() === 16, "нагадування створено з таблиці");

  sheet.data[1][2] = "Виготовлення";
  ctx.applyStatusSideEffects_(sheet, 2, "Виготовлення");
  assert.equal(ev.deleted, true, "вийшли з опрацювання — нагадування прибрано");
  assert.equal(tg.filter((x) => x.method === "sendMessage").length, 1, "автоматом удруге не шлемо — гілка вже є");
}

// ── Лічильник файлів для скріпки на картці воронки ────────────────────────
function testFilesCountBackfill() {
  const drive = makeDrive();
  const props = makeProps();
  const ctx = load({ DriveApp: drive, PropertiesService: { getScriptProperties: () => props } });

  // Файлів ще не було — теку не створюємо, лише ставимо позначку.
  ctx.ensureFilesCountOnce_();
  assert.equal(props.getProperty("FILES_COUNT_V1_READY"), "1");
  assert.equal(Object.keys(drive._folders).length, 0, "порожню теку файлів не створюємо");

  props.deleteProperty("FILES_COUNT_V1_READY");
  const root = drive.createFolder("AVALON CRM — файли замовлень");
  props.setProperty("FILES_ROOT_ID", root.id);
  const a = root.createFolder(ORD);
  const b = root.createFolder("ORD-110926-002");
  drive._file("1.pdf", a.id, 10);
  drive._file("2.jpg", a.id, 10);
  drive._file("3.pdf", b.id, 10).trashed = true;
  root.createFolder("Інша тека");
  ctx.ensureFilesCountOnce_();
  assert.equal(props.getProperty("files_count_" + ORD), "2");
  assert.equal(props.getProperty("files_count_ORD-110926-002"), null, "файли в кошику не рахуються");

  // Воронка бачить кількість без походу на Диск.
  const groups = ctx.adminGroupOrders_([
    { order_number: ORD, status: "Нове", quantity: 1, revenue: 100, profit: 10 },
    { order_number: "ORD-110926-002", status: "Нове", quantity: 1, revenue: 100, profit: 10 },
  ], []);
  const byNum = {};
  groups.forEach((g) => { byNum[g.order_number] = g; });
  assert.equal(byNum[ORD].files_count, 2);
  assert.equal(byNum["ORD-110926-002"].files_count, 0);
}


// ── Малий файл одним запитом: без сесії, без дубля при повторі ─────────────
function testSmallUpload() {
  const drive = makeDrive();
  const cache = makeCache();
  const props = makeProps();
  let fetches = 0;
  const ctx = load({
    DriveApp: drive,
    CacheService: { getScriptCache: () => cache },
    PropertiesService: { getScriptProperties: () => props },
    Utilities: {
      base64Decode: (s) => Array.from(Buffer.from(s, "base64")),
      newBlob: (bytes, mime, name) => ({ bytes, mime, name }),
    },
    UrlFetchApp: { fetch: () => { fetches += 1; throw new Error("малий файл не відкриває сесію Диска"); } },
  });

  const data = Buffer.from("PNG-bytes").toString("base64");
  const r1 = ctx.adminFileUploadSmall_({
    order_number: ORD, name: "Знімок екрана 2026-09-15 о 15.57.05.png", mime: "image/png", data, request_id: "fs-1",
  });
  assert.equal(r1.done, true);
  assert.equal(r1.file.name, "Знімок екрана 2026-09-15 о 15.57.05.png", "імʼя файлу не псується");
  assert.equal(r1.file.size, 9);
  assert.equal(fetches, 0, "жодного окремого звернення до Диска за сесією");
  const inFolder = Object.values(drive._folders).find((f) => f.name === ORD);
  assert.ok(inFolder, "файл іде в теку свого замовлення");
  assert.equal(props.getProperty("files_count_" + ORD), "1", "скріпка одразу знає про файл");

  // Відповідь загубилась, кабінет повторив той самий request_id — другого файлу немає.
  const r2 = ctx.adminFileUploadSmall_({ order_number: ORD, name: "Знімок.png", mime: "image/png", data, request_id: "fs-1" });
  assert.equal(r2.file.id, r1.file.id);
  assert.equal(props.getProperty("files_count_" + ORD), "1", "повтор не створює дубль");

  assert.throws(() => ctx.adminFileUploadSmall_({ order_number: ORD, name: "x", data: "", request_id: "fs-2" }), /Порожній/);
  const big = Buffer.alloc(3 * 1024 * 1024 + 1, 1).toString("base64");
  assert.throws(() => ctx.adminFileUploadSmall_({ order_number: ORD, name: "x", data: big, request_id: "fs-3" }), /частинами/);
  assert.throws(() => ctx.adminFileUploadSmall_({ order_number: "ORD-1", name: "x", data, request_id: "fs-4" }), /Невірний номер/);
}

// ── Перегляд «на опрацювання»: правильний заголовок і без порожніх розділів ──
function testProcessingPreviewSections() {
  const props = makeProps({ TG_TOKEN: "tg", TG_CONTRACTOR_CHAT: "-100" });
  // Замовлення, для якого вартість ще тільки треба порахувати: ні цін, ні доставки.
  const sheet = makeSheet([orderRow(ORD, "Нове", { 19: "", 21: "", 22: "" })]);
  const ctx = processingContext(sheet, props, makeCalendar(), []);

  const proc = ctx.adminContractorPreview_({
    order_number: ORD, purpose: "processing", processing_due: "2026-09-18",
    processing_task: "Порахувати виробничу вартість", options: {},
  }).text;
  assert.ok(proc.startsWith("🧮 <b>НА ОПРАЦЮВАННЯ</b>"), "перегляд на опрацювання — не «У виробництво»");
  assert.ok(proc.includes("Порахувати виробничу вартість") && proc.includes("до 18.09.2026"));
  assert.ok(!proc.includes("ФІНАНСИ"), "порожній розділ фінансів не показуємо");
  assert.ok(!proc.includes("ДОСТАВКА"), "порожній розділ доставки не показуємо");

  // Кілька завдань — окремими рядками, щоб підрядник нічого не пропустив.
  const multi = ctx.adminContractorPreview_({
    order_number: ORD, purpose: "processing", processing_due: "2026-09-18",
    processing_task: "Порахувати виробничу вартість; Підготувати креслення", options: {},
  }).text;
  assert.ok(multi.includes("• Завдання:\n   — <b>Порахувати виробничу вартість</b>\n   — <b>Підготувати креслення</b>\n"),
    "кілька завдань — списком");

  // Власний коментар — окремим блоком після заголовка, з екрануванням HTML.
  const withComment = ctx.adminContractorPreview_({
    order_number: ORD, purpose: "processing", processing_due: "2026-09-18",
    processing_task: "Порахувати виробничу вартість", options: {}, comment: "Клієнт хоче <до 5000 ₴> & швидко",
  }).text;
  const commentAt = withComment.indexOf("💬 <b>КОМЕНТАР</b>\nКлієнт хоче &lt;до 5000 ₴&gt; &amp; швидко\n");
  assert.ok(commentAt > 0, "коментар у повідомленні й HTML не ламає");
  assert.ok(commentAt < withComment.indexOf("Замовлення №"), "коментар — до деталей замовлення");
  assert.ok(!proc.includes("КОМЕНТАР"), "без коментаря блоку немає");

  // І в справжньому надсиланні коментар потрапляє в повідомлення підряднику.
  const tgLog = [];
  const ctx3 = processingContext(makeSheet([orderRow(ORD, "Нове")]),
    makeProps({ TG_TOKEN: "tg", TG_CONTRACTOR_CHAT: "-100" }), makeCalendar(), tgLog);
  ctx3.adminContractorSend_({ order_number: ORD, purpose: "production", request_id: "c1", comment: "Фарбувати після зварювання" });
  const sentText = tgLog.filter((x) => x.method === "sendMessage").map((x) => x.payload.text).join("\n");
  assert.ok(sentText.startsWith("🏭 <b>У ВИРОБНИЦТВО</b>\n\n💬 <b>КОМЕНТАР</b>\nФарбувати після зварювання\n"),
    "коментар іде одразу після заголовка");

  // Коли дані є — розділи на місці.
  const full = makeSheet([orderRow(ORD, "Нове", { 26: "Нова пошта", 28: "2026-09-25" })]);
  const ctx2 = processingContext(full, props, makeCalendar(), []);
  const prod = ctx2.adminContractorPreview_({ order_number: ORD, options: { finance: true } }).text;
  assert.ok(prod.startsWith("🏭 <b>У ВИРОБНИЦТВО</b>"));
  assert.ok(prod.includes("💰 <b>ФІНАНСИ</b>") && prod.includes("9 650"), "собівартість — у фінансах");
  assert.ok(prod.includes("🚚 <b>ДОСТАВКА</b>") && prod.includes("Нова пошта") && prod.includes("25.09.2026"));
}


// ── Послуга: у таблиці вид «Послуга» без площі кошика, підряднику — блок послуг ──
function testServiceKind() {
  const writes = [];
  let appended = null;
  const chain = (r, c) => {
    const rng = new Proxy({}, {
      get: (_, prop) => {
        if (prop === "setValues") return (v) => { writes.push({ r, c, v }); return rng; };
        if (prop === "setValue") return (v) => { writes.push({ r, c, v: [[v]] }); return rng; };
        if (prop === "getValues") return () => [[""]];
        if (prop === "getValue") return () => "";
        return () => rng;
      },
    });
    return rng;
  };
  const sheet = { getLastRow: () => 1, getMaxColumns: () => 48, getRange: (r, c) => chain(r, c) };
  const ctx = load({
    SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheetByName: () => sheet }) },
    Utilities: { formatDate: () => "15.09.2026 20:00" },
    PropertiesService: { getScriptProperties: () => makeProps() },
  });
  ctx.ensureDiscountColumns_ = () => {};
  ctx.getPatternFileInfo_ = () => null;
  ctx.ensureContactColumns_ = () => {};
  ctx.setCommissionFormulas_ = () => {};
  ctx.appendOrderRow_ = (sh, row) => { appended = row; return 2; };

  ctx.writeOrderToSheet_({
    order_number: "ORD-150926-020", first_name: "Сергій", phone: "+380671112233",
    items: [{
      product_type: "service", basket_type: "Порошкове фарбування; Гнуття металу",
      basket_model_name: "Фарбування кришки", construction_type: "Фарбування кришки",
      size_w: 450, size_h: 600, size_d: 200, quantity: 2, unit: "шт.",
      cost_total: 800, price_total: 1200, specs: "Верх — золото, низ — чорний",
    }],
  });
  assert.equal(appended[7], "Порошкове фарбування; Гнуття металу", "види робіт — у колонці «Тип»");
  assert.equal(appended[17], "", "для послуги площа кошика не рахується");
  assert.equal(appended[19], 800, "собівартість — від менеджера");
  assert.equal(appended[21], 1200, "ціна — від менеджера, без формули ₴/м²");
  const aoAp = writes.find((w) => w.r === 2 && w.c === 41);
  assert.deepEqual(aoAp.v[0].slice(0, 2), ["Фарбування кришки", "Послуга"], "вид у колонці AP — «Послуга»");

  // Лише собівартість і дробова кількість: ціну не вигадуємо, 2,5 м² не округлюємо.
  ctx.writeOrderToSheet_({
    order_number: "ORD-150926-021", first_name: "Сергій", phone: "+380671112233",
    items: [{ product_type: "service", basket_type: "Лазерне різання", basket_model_name: "Лист 3 мм",
      quantity: 2.5, unit: "м²", cost_total: 500, price_total: null }],
  });
  assert.equal(appended[16], 2.5, "дробова кількість послуги зберігається");
  assert.equal(appended[19], 500, "собівартість — як вписав менеджер");
  assert.equal(appended[21], "", "для послуги без ціни ціна лишається порожньою, без націнки");
  assert.throws(() => ctx.writeOrderToSheet_({ order_number: "X", items: [{ product_type: "service", quantity: 0 }] }), /більшою за 0/);
  assert.throws(() => ctx.writeOrderToSheet_({ order_number: "X", items: [{ product_type: "other", quantity: 0.5 }] }), /не меншою за 1/,
    "для виробів правило «від 1 штуки» не змінилось");

  // Правка в картці: дробова кількість послуги не округлюється; перемикання кошика на послугу
  // прибирає площу кошика.
  const us = makeSheet([orderRow("ORD-150926-030", "Нове", { 13: 450, 14: 600, 15: 200, 16: 1, 17: 1.16, 41: "Кошик" })]);
  const uctx = load({
    PropertiesService: { getScriptProperties: () => makeProps() },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    SpreadsheetApp: { flush() {} },
  });
  uctx.adminOrdersSheet_ = () => us;
  uctx.recalcRow_ = () => {};
  uctx.applyFinanceToRow_ = () => {};
  uctx.syncOrderPaymentState_ = () => {};
  uctx.syncProcessingEvent_ = () => {};
  uctx.adminGetOrder_ = () => ({ status: "ok" });
  uctx.adminUpdateOrder_({ order_number: "ORD-150926-030", patch: { product_kind: "Послуга", quantity: 2.5, size_w: 0, size_h: 0, size_d: 0 } });
  assert.equal(us.data[1][41], "Послуга");
  assert.equal(us.data[1][16], 2.5, "2,5 м² після правки не стає 3");
  assert.equal(us.data[1][17], "", "площа кошика прибрана");
  assert.equal(us.data[1][13], "", "розміри кошика прибрані");
  uctx.adminUpdateOrder_({ order_number: "ORD-150926-030", patch: { product_kind: "Кошик", quantity: 2.4 } });
  assert.equal(us.data[1][16], 2, "для кошика — ціла кількість, як і раніше");

  // Повідомлення підряднику для рядка-послуги.
  const row = orderRow(ORD, "Нове", { 7: "Порошкове фарбування; Гнуття металу", 8: "Фарбування кришки", 40: "Фарбування кришки", 41: "Послуга", 42: "Ширина кришки 450 мм\nФарбування: верх — золото", 9: "золото/чорний" });
  const pctx = processingContext(makeSheet([row]), makeProps({ TG_TOKEN: "tg", TG_CONTRACTOR_CHAT: "-100" }), makeCalendar(), []);
  const text = pctx.adminContractorPreview_({ order_number: ORD, options: { finance: true } }).text;
  assert.ok(text.includes("🛠 <b>ПОСЛУГИ</b>"), "лише послуги — заголовок «ПОСЛУГИ»");
  assert.ok(!text.includes("🏭 <b>ВИРОБНИЦТВО</b>"));
  assert.ok(text.includes("• Послуга: <b>Порошкове фарбування, Гнуття металу</b>"));
  assert.ok(text.includes("• Назва: <b>Фарбування кришки</b>"));
  assert.ok(text.includes("• Ширина кришки 450 мм") && text.includes("• Колір: <b>золото/чорний</b>"));
  assert.ok(!text.includes("м² ×"), "жодної розкладки за площею кошика");
}


// ── Модель у конструкції, фото моделі та видимі позиції у фінансах ──
function testModelPhotoAndFinanceLines() {
  const props = makeProps({ TG_TOKEN: "tg", TG_CONTRACTOR_CHAT: "-100" });
  // Як у замовленні ORD-210926-016: перша позиція з розмірами, друга — «розрахує менеджер»,
  // але зі своєю виробничою вартістю.
  const withSizes = orderRow(ORD, "Нове", {
    7: "", 8: "Суцільний · AVL-04", 9: "Сірий (RAL 7016)", 10: "K1",
    13: 800, 14: 550, 15: 500, 16: 2, 19: 4019, 21: 5000, 40: "Зі знімною боковиною", 41: "Кошик",
  });
  const noSizes = orderRow(ORD, "Нове", {
    7: "", 8: "", 9: "", 10: "", 13: "", 14: "", 15: "", 16: 1, 19: 1117, 21: 1587, 40: "", 41: "Кошик",
  });
  const tg = [];
  const ctx = processingContext(makeSheet([withSizes, noSizes]), props, makeCalendar(), tg);
  const preview = ctx.adminContractorPreview_({ order_number: ORD, options: { finance: true } });

  assert.ok(preview.text.includes("• Конструкція: <b>Суцільний · AVL-04 · Зі знімною боковиною</b>"),
    "у конструкції видно назву моделі каталогу");
  assert.ok(preview.text.includes("• Кошик 2: <b>1 117 ₴</b>"),
    "позиція без розмірів теж видима у фінансах, а не ховається в «Разом»");
  assert.ok(preview.text.includes("<b>Разом виробнича: 5 136 ₴</b>"));
  assert.ok(!preview.text.includes("• Тип: <b></b>") && !preview.text.includes("• Конструкція: <b></b>"),
    "порожні рядки «Тип» і «Конструкція» не друкуємо");
  assert.equal(preview.photo, "https://avalon-order-form.vercel.app/images/basket-models/avl-04-removable-side.jpg",
    "перегляд показує те саме фото моделі, що піде підряднику");

  // Фото йде ПРЕВʼЮ до того самого повідомлення, а не окремою картинкою.
  ctx.adminContractorSend_({ order_number: ORD, purpose: "production", request_id: "ph1" });
  const sends = tg.filter((x) => x.method === "sendMessage");
  assert.equal(sends.length, 1, "одне повідомлення, без окремого фото");
  assert.equal(tg.filter((x) => x.method === "sendPhoto").length, 0);
  const lp = sends[0].payload.link_preview_options;
  assert.ok(lp && lp.url.endsWith("avl-04-removable-side.jpg"), "фото моделі — прев'ю повідомлення");
  assert.equal(lp.show_above_text, true, "фото над текстом");
  assert.ok(!sends[0].payload.disable_web_page_preview, "прев'ю не вимкнене");

  // Telegram не прийняв прев'ю — повідомлення все одно доходить, просто без фото.
  const tg2 = [];
  const ctx2 = processingContext(makeSheet([withSizes]), makeProps({ TG_TOKEN: "tg", TG_CONTRACTOR_CHAT: "-100" }), makeCalendar(), tg2);
  let first = true;
  ctx2.tgApi_ = (method, payload) => {
    tg2.push({ method, payload });
    if (method === "createForumTopic") return { ok: true, result: { message_thread_id: 55 } };
    if (method === "sendMessage" && first) { first = false; return { ok: false, description: "Bad Request: unknown field link_preview_options" }; }
    return { ok: true, result: {} };
  };
  const res2 = ctx2.adminContractorSend_({ order_number: ORD, purpose: "production", request_id: "ph2" });
  assert.equal(res2.status, "ok", "повідомлення доставлене попри відмову прев'ю");
  const tries = tg2.filter((x) => x.method === "sendMessage");
  assert.equal(tries.length, 2);
  assert.ok(tries[0].payload.link_preview_options && !tries[1].payload.link_preview_options, "повтор — без прев'ю");

  // Замовлення без моделі каталогу (послуга) — жодного прев'ю, повідомлення як було.
  const svc = processingContext(makeSheet([orderRow("ORD-110926-777", "Нове", { 41: "Послуга", 7: "Лазерне різання", 40: "Різання" })]),
    makeProps({ TG_TOKEN: "tg", TG_CONTRACTOR_CHAT: "-100" }), makeCalendar(), []);
  assert.equal(svc.adminContractorPreview_({ order_number: "ORD-110926-777", options: {} }).photo, "");
}

// ── Видалення позиції із замовлення ──
function testDeleteOrderItem() {
  const sheet = makeSheet([
    orderRow(ORD, "Нове", { 40: "Зі знімною боковиною" }),
    orderRow(ORD, "Нове", { 40: "Друга позиція" }),
    orderRow("ORD-110926-002", "Нове"),
  ]);
  const ctx = load({
    PropertiesService: { getScriptProperties: () => makeProps() },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
  });
  ctx.adminOrdersSheet_ = () => sheet;
  ctx.syncOrderPaymentState_ = () => {};
  ctx.adminGetOrder_ = () => ({ status: "ok" });

  assert.throws(() => ctx.adminDeleteOrderItem_({ order_number: ORD, row: 4 }), /Список позицій змінився/,
    "чужий рядок не видаляємо");
  assert.throws(() => ctx.adminDeleteOrderItem_({ order_number: ORD, row: 1 }), /рядок позиції/);
  // Рядки зсунулись (у іншому вікні видалили рядок вище): рядок 3 тепер інша позиція —
  // звірка за вмістом не дає видалити сусідню.
  assert.throws(() => ctx.adminDeleteOrderItem_({ order_number: ORD, row: 3, expect: { basket_model: "Зі знімною боковиною" } }),
    /Список позицій змінився/, "видаляємо лише ту позицію, яку бачить кабінет");
  assert.equal(sheet.data.length, 4, "нічого не видалено");
  ctx.adminDeleteOrderItem_({ order_number: ORD, row: 3, expect: { basket_model: "Друга позиція", quantity: 1 } });
  assert.equal(sheet.data.length, 3, "рядок прибрано");
  assert.deepEqual(sheet.data.slice(1).map((r) => r[0]), [ORD, "ORD-110926-002"], "прибрано саме потрібний рядок");
  assert.equal(sheet.data[1][40], "Зі знімною боковиною", "перша позиція лишилась незмінною");
  assert.throws(() => ctx.adminDeleteOrderItem_({ order_number: ORD, row: 2 }), /остання позиція/,
    "останню позицію не видаляємо — для відмови є статус «Скасовано»");

  // Правка позиції: після зсуву рядків — відмова, а не правка сусідньої.
  const us = makeSheet([orderRow(ORD, "Нове", { 40: "Перша" }), orderRow(ORD, "Нове", { 40: "Друга" })]);
  const uctx = load({
    PropertiesService: { getScriptProperties: () => makeProps() },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    SpreadsheetApp: { flush() {} },
  });
  uctx.adminOrdersSheet_ = () => us;
  uctx.recalcRow_ = () => {};
  uctx.syncOrderPaymentState_ = () => {};
  uctx.syncProcessingEvent_ = () => {};
  uctx.adminGetOrder_ = () => ({ status: "ok" });
  assert.throws(() => uctx.adminUpdateOrder_({ order_number: ORD, row: 2, patch: { color: "Чорний" }, expect: { basket_model: "Друга" } }),
    /Список позицій змінився/);
  assert.equal(us.data[1][9], "", "сусідню позицію не змінено");
  assert.throws(() => uctx.adminUpdateOrder_({ order_number: ORD, row: 9, patch: { color: "Чорний" }, expect: { basket_model: "Друга" } }),
    /Список позицій змінився/, "чужий рядок із expect — відмова, а не правка першої позиції");
  us.data[2][16] = "";   // порожня кількість у таблиці = 1 у кабінеті — не хибна відмова
  uctx.adminUpdateOrder_({ order_number: ORD, row: 3, patch: { color: "Чорний" }, expect: { basket_model: "Друга", quantity: 1 } });
  assert.equal(us.data[2][9], "Чорний", "правильна позиція змінена");
}


// ── Маржа до виплати — лише з «Виготовлення»; скасування — лише з причиною ──
function testMarginOwedAndCancelReason() {
  const ctx = load({ PropertiesService: { getScriptProperties: () => makeProps() } });
  const g = (status) => ctx.adminGroupOrders_([{ order_number: ORD, status, quantity: 1, revenue: 6587, profit: 1451 }], [])[0];
  ["Нове", "В опрацюванні підрядником", "Скасовано"].forEach((st) => {
    assert.equal(g(st).margin_owed, false, st + ": маржа ще не до виплати");
    assert.equal(g(st).margin_left, 0, st + ": «до отримання» = 0");
    // Скасовані й раніше не входили в суми; для решти маржа лишається видимою як прогноз.
    assert.equal(g(st).margin_due, st === "Скасовано" ? 0 : 1451, st + ": маржа-прогноз");
  });
  ["Виготовлення", "Готове", "Відправлено", "Завершено"].forEach((st) => {
    assert.equal(g(st).margin_owed, true);
    assert.equal(g(st).margin_left, 1451, st + ": з цього етапу — до виплати");
  });

  const sheet = makeSheet([orderRow(ORD, "Нове"), orderRow(ORD, "Нове")]);
  const uctx = load({
    PropertiesService: { getScriptProperties: () => makeProps() },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    SpreadsheetApp: { flush() {} },
  });
  uctx.adminOrdersSheet_ = () => sheet;
  uctx.recalcRow_ = () => {};
  uctx.syncOrderPaymentState_ = () => {};
  uctx.syncProcessingEvent_ = () => {};
  uctx.notifyOwnerStatusChange_ = () => {};
  uctx.adminGetOrder_ = () => ({ status: "ok" });
  assert.throws(() => uctx.adminUpdateOrder_({ order_number: ORD, patch: { status: "Скасовано" } }), /причину скасування/);
  assert.throws(() => uctx.adminUpdateOrder_({ order_number: ORD, patch: { status: "Скасовано", cancel_reason: "   " } }), /причину скасування/);
  assert.equal(sheet.data[1][2], "Нове", "без причини статус не змінено");
  uctx.adminUpdateOrder_({ order_number: ORD, patch: { status: "Скасовано", cancel_reason: "  Клієнт знайшов дешевше  " } });
  assert.deepEqual(sheet.data.slice(1).map((r) => r[2]), ["Скасовано", "Скасовано"]);
  assert.deepEqual(sheet.data.slice(1).map((r) => r[48]), ["Клієнт знайшов дешевше", "Клієнт знайшов дешевше"],
    "причина в колонці AW усіх позицій");
  assert.equal(uctx.mapOrderRow_(2, sheet.data[1]).cancel_reason, "Клієнт знайшов дешевше", "CRM бачить причину");
  // Уточнити причину вже скасованого — можна; повернути в роботу — причина не потрібна.
  uctx.adminUpdateOrder_({ order_number: ORD, patch: { cancel_reason: "Дорого" } });
  assert.equal(sheet.data[1][48], "Дорого");
  uctx.adminUpdateOrder_({ order_number: ORD, patch: { status: "Нове" } });
  assert.equal(sheet.data[1][2], "Нове");
}


// ── Коментар до кожної позиції — у її блоці, а не наприкінці для всіх ──
function testItemComments() {
  const props = makeProps({ TG_TOKEN: "tg", TG_CONTRACTOR_CHAT: "-100" });
  const common = "Болтове зʼєднання лицьової частини з боковими";
  const basket = (extra) => orderRow(ORD, "Нове", Object.assign({
    7: "", 8: "Розбірний (з 3-х частин) · AVL-05", 9: "Білий (RAL 9016)", 10: "K2", 16: 1, 40: "Розбірний", 41: "Кошик",
  }, extra));
  const sheet = makeSheet([
    // 1: коментар у новій колонці AX
    basket({ 13: 750, 14: 1300, 15: 340, 31: common, 49: "Кріплення до стіни: по 3 вуха на сторону" }),
    // 2: стара заявка — коментар лежить у примітках рядка
    basket({ 13: 750, 14: 1200, 15: 440, 16: 3, 31: common + "\nКоментар до моделі: Без вух, на анкери" }),
    // 3: без коментаря
    basket({ 13: 750, 14: 700, 15: 440, 16: 14, 31: common }),
  ]);
  const ctx = processingContext(sheet, props, makeCalendar(), []);
  const text = ctx.adminContractorPreview_({ order_number: ORD, options: { notes: true } }).text;
  const block = (n) => text.split("<b>Кошик " + n + "</b>")[1].split(n < 3 ? "<b>Кошик " + (n + 1) + "</b>" : "ФІНАНСИ")[0];
  assert.ok(block(1).includes("❗ Коментар: <b>Кріплення до стіни: по 3 вуха на сторону</b>"), "коментар позиції 1 — у її блоці");
  assert.ok(block(2).includes("❗ Коментар: <b>Без вух, на анкери</b>"), "старий «Коментар до моделі» теж у блоці своєї позиції");
  assert.ok(!block(3).includes("Коментар"), "позиція без коментаря — без рядка");
  const tail = text.split("ДОСТАВКА")[1] || "";
  assert.ok(tail.includes(common), "спільна примітка лишається наприкінці");
  assert.ok(!tail.includes("анкери") && !tail.includes("Коментар до моделі"), "коментар позиції не дублюється наприкінці для всіх");

  // CRM бачить коментар позиції і може його змінити/очистити.
  assert.equal(ctx.mapOrderRow_(3, sheet.data[2]).item_comment, "Без вух, на анкери");
  const uctx = load({
    PropertiesService: { getScriptProperties: () => makeProps() },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    SpreadsheetApp: { flush() {} },
  });
  uctx.adminOrdersSheet_ = () => sheet;
  uctx.recalcRow_ = () => {};
  uctx.syncOrderPaymentState_ = () => {};
  uctx.syncProcessingEvent_ = () => {};
  uctx.adminGetOrder_ = () => ({ status: "ok" });
  // Загальні примітки оновлюються в усіх позиціях; технічні рядки позиції лишаються своїми.
  sheet.data[3][31] = common + "\nДовжина кронштейнів: 600 мм";
  uctx.adminUpdateOrder_({ order_number: ORD, row: 2, patch: { notes: "Доставка до 16:00" } });
  assert.equal(sheet.data[1][31], "Доставка до 16:00");
  assert.equal(sheet.data[2][31], "Доставка до 16:00\nКоментар до моделі: Без вух, на анкери", "стара примітка не лишилась в іншій позиції");
  assert.equal(sheet.data[3][31], "Доставка до 16:00\nДовжина кронштейнів: 600 мм", "технічний рядок позиції збережено");
  sheet.data[1][31] = common; sheet.data[2][31] = common + "\nКоментар до моделі: Без вух, на анкери"; sheet.data[3][31] = common;

  uctx.adminUpdateOrder_({ order_number: ORD, row: 3, patch: { item_comment: "" } });
  assert.equal(sheet.data[2][49], "");
  assert.equal(sheet.data[2][31], common, "старий рядок із приміток прибрано — очищений коментар не повертається");
  assert.equal(uctx.mapOrderRow_(3, sheet.data[2]).item_comment, "");
}

// ── Додати позицію до наявного замовлення (розрахунок із калькулятора) ──
function testAddOrderItem() {
  const sheet = makeSheet([
    orderRow(ORD, "Виготовлення", { 1: "05.10.2026 16:49", 3: "Телефон", 26: "Нова пошта", 28: "2026-10-16", 37: "phone", 45: 30, 46: "2026-10-10", 47: "Порахувати" }),
    orderRow(ORD, "Виготовлення"),
    orderRow("ORD-110926-002", "Нове"),
  ]);
  const cache = makeCache();
  const applied = [];
  const ctx = load({
    PropertiesService: { getScriptProperties: () => makeProps() },
    CacheService: { getScriptCache: () => cache },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    SpreadsheetApp: { flush() {}, getActiveSpreadsheet: () => ({ getSheetByName: () => sheet }) },
    Utilities: { formatDate: () => "06.10.2026 10:00" },
  });
  ctx.adminOrdersSheet_ = () => sheet;
  ctx.ensureDiscountColumns_ = () => {};
  ctx.ensureContactColumns_ = () => {};
  ctx.getPatternFileInfo_ = () => null;
  ctx.setCommissionFormulas_ = () => {};
  ctx.applyOrderRowControls_ = () => {};
  ctx.applyFinanceToRow_ = (sh, row, fin) => { applied.push({ row, fin }); };
  ctx.syncOrderPaymentState_ = () => {};
  ctx.adminGetOrder_ = () => ({ status: "ok" });
  // Оформлення клітинок у тесті не потрібне — лише значення.
  const realRange = sheet.getRange.bind(sheet);
  sheet.getRange = (...a) => {
    const rng = realRange(...a);
    const proxy = new Proxy(rng, {
      get: (t, prop) => {
        if (!(prop in t)) return () => proxy;                 // setFontWeight, setWrap… — ланцюжок
        if (prop === "setValue" || prop === "setValues" || prop === "setDataValidation") {
          return (...args) => { t[prop](...args); return proxy; };
        }
        return t[prop];
      },
    });
    return proxy;
  };

  const item = {
    product_type: "basket", basket_model: "AVL-05", basket_model_name: "Розбірний",
    construction_type: "Розбірний (з 3-х частин) · AVL-05", color: "RAL 9016 білий",
    size_w: 750, size_h: 700, size_d: 440, quantity: 14, unit: "шт.",
    cost_total: 34664, price_total: 42122, list_price: 46802, discount_pct: 10, discount_uah: 4680,
    item_comment: "По 3 вуха на сторону",
  };
  const out = ctx.adminAddOrderItem_({ order_number: ORD, item, request_id: "calc-1" });
  assert.equal(out.added_row, 4, "нова позиція — одразу під останньою позицією замовлення");
  assert.equal(sheet.data.length, 5);
  const row = sheet.data[3];
  assert.equal(row[0], ORD);
  assert.equal(row[2], "Виготовлення", "статус — як у замовлення, а не «Нове»");
  assert.equal(row[1], "05.10.2026 16:49", "дата замовлення, а не дата додавання");
  assert.equal(row[4], sheet.data[1][4], "клієнт той самий");
  assert.equal(row[5], "'+380673406685", "телефон — текстом");
  assert.equal(row[26], "Нова пошта");
  assert.deepEqual([row[13], row[14], row[15], row[16]], [750, 700, 440, 14]);
  assert.equal(row[19], 34664, "собівартість із калькулятора");
  assert.equal(row[21], 42122, "виручка з калькулятора");
  assert.equal(row[40], "Розбірний");
  assert.equal(row[41], "Кошик");
  assert.equal(row[45], 30, "ставка комісії спільна для замовлення");
  assert.equal(row[46], "2026-10-10");
  assert.equal(row[49], "По 3 вуха на сторону");
  assert.deepEqual(applied, [{ row: 4, fin: { cost_total: 34664, list_price: 46802, discount_pct: 10, discount_uah: 4680 } }],
    "прайс і знижка — тим самим кодом, що й у кабінеті");
  assert.equal(sheet.data[4][0], "ORD-110926-002", "чуже замовлення зсунулось, але не змінилось");

  // Повтор із тим самим request_id (загублена відповідь) — без дубля.
  ctx.adminAddOrderItem_({ order_number: ORD, item, request_id: "calc-1" });
  assert.equal(sheet.data.length, 5, "повтор не створює другу позицію");
  assert.equal(sheet.data[3][44], "calc-1", "ID запиту збережено в самому рядку (колонка AS)");
  // Кеш скрипта очистився (минула година) — повтор усе одно впізнається за рядком.
  cache.remove("additem_calc-1");
  const again = ctx.adminAddOrderItem_({ order_number: ORD, item, request_id: "calc-1" });
  assert.equal(again.duplicate, true);
  assert.equal(sheet.data.length, 5, "і без кешу дубля немає");
  assert.equal(applied.length, 1, "фінанси вдруге не застосовуються");

  // Хибна знижка відхиляється ДО вставки рядка — напівзаписаної позиції не лишається.
  assert.throws(() => ctx.adminAddOrderItem_({ order_number: ORD, request_id: "calc-bad",
    item: Object.assign({}, item, { list_price: 1000, discount_uah: 5000 }) }), /Знижка ₴ не може перевищувати/);
  assert.throws(() => ctx.adminAddOrderItem_({ order_number: ORD, request_id: "calc-bad2",
    item: Object.assign({}, item, { discount_pct: 150 }) }), /100%/);
  assert.equal(sheet.data.length, 5, "після відмови рядків не додалось");

  assert.throws(() => ctx.adminAddOrderItem_({ order_number: "ORD-999999-999", item, request_id: "calc-2" }), /not found/i);
  assert.throws(() => ctx.adminAddOrderItem_({ order_number: ORD, request_id: "calc-3" }), /Немає даних позиції/);
}

// ── Єдиний алгоритм ціни: нове замовлення без суми і правка позиції в картці ──
function testUnifiedPricingInSheet() {
  let appended = null;
  // Макет таблиці + оформлення клітинок (жирний, фон, формат) — воно тут не перевіряється.
  const styled = (sh) => Object.assign({}, sh, {
    getRange: (...args) => {
      const rng = sh.getRange(...args);
      const proxy = new Proxy(rng, { get: (target, prop) => (prop in target ? target[prop] : () => proxy) });
      return proxy;
    },
  });
  const raw = makeSheet([]);
  const sheet = styled(raw);
  const ctx = load({
    SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheetByName: () => sheet }), flush() {} },
    Utilities: { formatDate: () => "06.10.2026 12:00" },
    PropertiesService: { getScriptProperties: () => makeProps() },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
  });
  ctx.ensureDiscountColumns_ = () => {};
  ctx.getPatternFileInfo_ = () => null;
  ctx.ensureContactColumns_ = () => {};
  ctx.setCommissionFormulas_ = () => {};
  ctx.nextOrderNumber = () => "ORD-061026-001";
  ctx.appendOrderRow_ = (sh, row) => { appended = row; sh.getRange(sh.getLastRow() + 1, 1, 1, row.length).setValues([row]); return sh.getLastRow(); };

  // Нове замовлення з кабінету без ціни: суми — рівно як у калькуляторі (AVL-05, 14 шт., −10 %).
  const item = { product_type: "basket", basket_model: "AVL-05", basket_model_name: "Розбірний",
    construction_type: "Розбірний (з 3-х частин) · AVL-05", size_w: 750, size_h: 700, size_d: 440, quantity: 14, discount_pct: 10 };
  ctx.writeOrderToSheet_({ first_name: "Тест", phone: "+380000000000", items: [item] });
  assert.deepEqual(appended.slice(17, 24), [1.14, 2476, 34664, 3009, 42122, 7458, 17.7]);
  assert.deepEqual(raw.data[1].slice(34, 37), [46802, 10, 4680], "прайс, знижка % і ₴ — у своїх колонках");

  // Через ТОВ (комісія 30 % з маржі): націнка 50 %, щоб чистими лишились планові 35 %.
  ctx.writeOrderToSheet_({ first_name: "Тест", phone: "+380000000000", commission_pct: 30, items: [Object.assign({}, item, { discount_pct: "" })] });
  assert.equal(appended[21], 51996, "3 714 × 14");
  // Вписана лише собівартість: ціна за плановою націнкою (а з комісією — за збільшеною).
  ctx.writeOrderToSheet_({ first_name: "Тест", phone: "+380000000000", items: [{ product_type: "other", basket_model_name: "Стенд", quantity: 1, cost_total: 1000 }] });
  assert.equal(appended[21], 1350, "рівно +35 %");
  ctx.writeOrderToSheet_({ first_name: "Тест", phone: "+380000000000", commission_pct: 30, items: [{ product_type: "other", basket_model_name: "Стенд", quantity: 1, cost_total: 1000 }] });
  assert.equal(appended[21], 1500, "з комісією 30 % — +50 %");
  // Заявка з форми (суми нулі) лишається без ціни — її рахує менеджер.
  ctx.writeOrderToSheet_({ first_name: "Тест", phone: "+380000000000", items: [Object.assign({}, item, { price_total: 0, cost_total: 0 })] });
  assert.equal(appended[21], "", "форма автоматичну ціну не передає");

  // Правка в картці: колір, тип і візерунок суми не чіпають; кількість — перераховує, знижка лишається.
  const us = makeSheet([orderRow(ORD, "Нове", { 8: "Розбірний (з 3-х частин) · AVL-05", 13: 750, 14: 700, 15: 440, 16: 14,
    19: 30000, 21: 40000, 22: 10000, 34: 44000, 35: 10, 36: 4000, 40: "Розбірний", 41: "Кошик" })]);
  ctx.adminOrdersSheet_ = () => styled(us);
  ctx.syncOrderPaymentState_ = () => {};
  ctx.syncProcessingEvent_ = () => {};
  ctx.adminGetOrder_ = () => ({ status: "ok" });
  const same = { construction: "Розбірний (з 3-х частин) · AVL-05", basket_model: "Розбірний", product_kind: "Кошик",
    specs: "", size_w: 750, size_h: 700, size_d: 440, quantity: 14 };
  ctx.adminUpdateOrder_({ order_number: ORD, row: 2, patch: Object.assign({}, same, { color: "Білий", basket_type: "Декоративний", pattern: "K1", specs: "Кронштейн: K2" }) });
  assert.deepEqual([us.data[1][19], us.data[1][21]], [30000, 40000], "вписані вручну суми лишились");
  assert.equal(us.data[1][9], "Білий");
  ctx.adminUpdateOrder_({ order_number: ORD, row: 2, patch: Object.assign({}, same, { quantity: 3 }) });
  assert.deepEqual(us.data[1].slice(17, 24), [1.14, 2476, 7428, 3009, 9026, 1598, 17.7], "3 шт.: 3 343 × 3 − 10 %");
  assert.deepEqual(us.data[1].slice(34, 37), [10029, 10, 1003]);
  // Опція в характеристиках, що впливає на ціну, — теж перераховує.
  ctx.adminUpdateOrder_({ order_number: ORD, row: 2, patch: Object.assign({}, same, { quantity: 3, specs: "Матеріал: Оцинкований метал" }) });
  assert.equal(us.data[1][19], 11628, "(2 475,97 + 1 400) × 3");
  // Антивандальний рахується індивідуально: нове замовлення — без автоціни, правка кількості
  // вписаних сум не чіпає.
  ctx.writeOrderToSheet_({ first_name: "Тест", phone: "+380000000000", items: [Object.assign({}, item, { basket_type: "Антивандальний (більша товщина металу+ каркас)", discount_pct: "" })] });
  assert.deepEqual([appended[19], appended[21]], ["", ""], "ціну антивандального вписує менеджер");
  assert.equal(appended[17], 1.14, "площа при цьому порахована");
  const av = makeSheet([orderRow(ORD, "Нове", { 7: "Антивандальний", 8: "Суцільний · AVL-01", 13: 800, 14: 500, 15: 500, 16: 1, 19: 5000, 21: 7000, 22: 2000, 40: "Суцільний", 41: "Кошик" })]);
  ctx.adminOrdersSheet_ = () => styled(av);
  ctx.adminUpdateOrder_({ order_number: ORD, row: 2, patch: { construction: "Суцільний · AVL-01", basket_model: "Суцільний", product_kind: "Кошик", specs: "", size_w: 800, size_h: 500, size_d: 500, quantity: 4 } });
  assert.deepEqual([av.data[1][16], av.data[1][19], av.data[1][21]], [4, 5000, 7000], "кількість змінено, суми менеджера на місці");
  // Складний візерунок: ціну теж не підставляємо. Змінили його на звичайний — формула повертається.
  ctx.writeOrderToSheet_({ first_name: "Тест", phone: "+380000000000", items: [Object.assign({}, item, { pattern: "K8", discount_pct: "" })] });
  assert.deepEqual([appended[19], appended[21]], ["", ""], "складний візерунок рахує менеджер");
  av.data[1][7] = "Декоративний"; av.data[1][10] = "K4";
  ctx.adminUpdateOrder_({ order_number: ORD, row: 2, patch: { pattern: "K4", quantity: 2 } });
  assert.deepEqual([av.data[1][19], av.data[1][21]], [5000, 7000], "K4 — індивідуально, суми на місці");
  ctx.adminUpdateOrder_({ order_number: ORD, row: 2, patch: { pattern: "K2" } });
  assert.deepEqual([av.data[1][19], av.data[1][21]], [3654, 4932], "звичайний візерунок — знову за формулою: 0,9 × 2 030 × 2");
  ctx.adminOrdersSheet_ = () => styled(us);

  // У тому ж запиті задана ціна — вона переважає формулу.
  ctx.adminUpdateOrder_({ order_number: ORD, row: 2, patch: Object.assign({}, same, { quantity: 5, cost_total: 12000, list_price: 20000, discount_pct: 0, discount_uah: 0, revenue: 20000 }) });
  assert.deepEqual([us.data[1][19], us.data[1][21]], [12000, 20000]);
}

// ── Небазовий колір: +200 ₴ один раз на замовлення окремою позицією ──
function testColorSurchargeInSheet() {
  const styled = (sh) => Object.assign({}, sh, {
    getRange: (...args) => {
      const rng = sh.getRange(...args);
      const proxy = new Proxy(rng, { get: (target, prop) => (prop in target ? target[prop] : () => proxy) });
      return proxy;
    },
  });
  const basket = (extra) => orderRow(ORD, "Нове", Object.assign({ 8: "Суцільний · AVL-01", 9: "Сірий (RAL 7016)", 13: 800, 14: 500, 15: 500, 16: 1,
    19: 1827, 21: 2466, 22: 639, 40: "Суцільний", 41: "Кошик" }, extra));
  const make = (rows) => {
    const raw = makeSheet(rows);
    const ctx = load({
      SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheetByName: () => styled(raw) }), flush() {} },
      Utilities: { formatDate: () => "06.10.2026 12:00" },
      PropertiesService: { getScriptProperties: () => makeProps() },
      LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    });
    ctx.ensureDiscountColumns_ = () => {};
    ctx.getPatternFileInfo_ = () => null;
    ctx.ensureContactColumns_ = () => {};
    ctx.setCommissionFormulas_ = () => {};
    ctx.applyOrderRowControls_ = () => {};
    ctx.withRequestCache_ = (_prefix, _id, fn) => fn();
    ctx.adminOrdersSheet_ = () => styled(raw);
    ctx.syncOrderPaymentState_ = () => {};
    ctx.syncProcessingEvent_ = () => {};
    ctx.adminGetOrder_ = () => ({ status: "ok" });
    return { raw, ctx, sh: styled(raw) };
  };
  const surcharges = (raw) => raw.data.slice(1).filter((r) => r[40] === "Доплата за колір");
  const same = { construction: "Суцільний · AVL-01", basket_model: "Суцільний", product_kind: "Кошик", specs: "", size_w: 800, size_h: 500, size_d: 500, quantity: 1 };

  // Два кошики небазового кольору → ОДНА доплата на замовлення, під останньою позицією.
  let t = make([basket({ 9: "RAL 6005 зелений" }), basket({ 9: "RAL 3000 червоний", 16: 3 }), orderRow("ORD-110926-002", "Нове")]);
  assert.equal(t.ctx.syncColorSurcharge_(t.sh, ORD), true);
  assert.equal(surcharges(t.raw).length, 1);
  const added = t.raw.data[3];
  assert.deepEqual([added[0], added[2], added[4], added[16], added[19], added[21], added[22], added[41]],
    [ORD, "Нове", "Олександр Заєць", 1, 200, 200, 0, "Послуга"], "собівартість = ціна, маржа 0; дані замовлення — як у решти позицій");
  assert.equal(t.raw.data[4][0], "ORD-110926-002", "чуже замовлення зсунулось, але не змінилось");
  assert.equal(t.ctx.syncColorSurcharge_(t.sh, ORD), false, "повторний виклик нічого не дублює");
  assert.equal(surcharges(t.raw).length, 1);

  // Калькулятор переносить свою «Доплату за колір» — другої не зʼявляється, сума оновлюється.
  t.ctx.adminAddOrderItem_({ order_number: ORD, request_id: "calc-color",
    item: { product_type: "service", basket_model_name: "Доплата за колір", construction_type: "Доплата за колір", basket_type: "Доплата за колір", quantity: 1, unit: "шт.", cost_total: 300, price_total: 300 } });
  assert.equal(surcharges(t.raw).length, 1);
  assert.deepEqual([surcharges(t.raw)[0][19], surcharges(t.raw)[0][21]], [300, 300]);

  // Кольори стали базовими → доплата зникає; змінену вручну (ціна ≠ собівартість) не чіпаємо.
  t = make([basket({ 9: "RAL 6005" })]);
  t.ctx.syncColorSurcharge_(t.sh, ORD);
  t.ctx.adminUpdateOrder_({ order_number: ORD, row: 2, patch: Object.assign({}, same, { color: "Чорний (RAL 9005)" }) });
  assert.equal(surcharges(t.raw).length, 0, "базовий колір — доплату прибрано");
  assert.equal(t.raw.data.length, 2);
  t.ctx.adminUpdateOrder_({ order_number: ORD, row: 2, patch: Object.assign({}, same, { color: "RAL 6005" }) });
  assert.equal(surcharges(t.raw).length, 1, "колір знову небазовий — доплата повернулась (через правку в картці)");
  t.raw.data[2][21] = 350;
  t.ctx.adminUpdateOrder_({ order_number: ORD, row: 2, patch: Object.assign({}, same, { color: "Білий (RAL 9016)" }) });
  assert.equal(surcharges(t.raw).length, 1, "вручну змінену доплату лишаємо менеджеру");

  // Без доплати: базовий колір; кошик ще без ціни (заявка з форми); не кошик; замовлення вже у виробництві.
  t = make([basket({})]);
  assert.equal(t.ctx.syncColorSurcharge_(t.sh, ORD), false);
  t = make([basket({ 9: "RAL 6005", 19: "", 21: "", 22: "" })]);
  assert.equal(t.ctx.syncColorSurcharge_(t.sh, ORD), false, "ціни ще немає — доплату додамо, коли менеджер порахує");
  t = make([orderRow(ORD, "Нове", { 9: "RAL 6005" })]);
  assert.equal(t.ctx.syncColorSurcharge_(t.sh, ORD), false, "«Інший виріб» рахує менеджер");
  t = make([basket({ 2: "Виготовлення", 9: "RAL 6005" })]);
  assert.equal(t.ctx.syncColorSurcharge_(t.sh, ORD), false, "після запуску у виробництво ціна сама не міняється");
  assert.equal(t.raw.data.length, 2);

  // Видалили єдиний кошик небазового кольору — доплата йде разом із ним.
  t = make([basket({}), basket({ 9: "RAL 6005" })]);
  t.ctx.syncColorSurcharge_(t.sh, ORD);
  assert.equal(t.raw.data.length, 4);
  t.ctx.adminDeleteOrderItem_({ order_number: ORD, row: 3 });
  assert.deepEqual(t.raw.data.slice(1).map((r) => r[9]), ["Сірий (RAL 7016)"]);

  // Повідомлення підряднику: доплата — рядком у фінансах, а не «Послугою»; один кошик лишається «Кошик».
  const mctx = load({ Utilities: { formatDate: () => "06.10.2026, 12:00" }, Date, PropertiesService: { getScriptProperties: () => makeProps() } });
  const msg = mctx.buildProductionMsg_({ order_number: ORD, items: [
    { product_type: "basket", construction_type: "Суцільний · AVL-01", color: "RAL 6005 зелений", size_w: 800, size_h: 500, size_d: 500, quantity: 1, unit: "шт.", cost_total: 1827 },
    { product_type: "service", basket_model_name: "Доплата за колір", basket_type: "Доплата за колір", quantity: 1, unit: "шт.", cost_total: 200 },
  ] }, { finance: true }).replace(/<[^>]+>/g, "");
  assert.ok(!msg.includes("Послуга"), msg);
  assert.ok(!msg.includes("Кошик 1"), "єдиний кошик — без номера");
  assert.ok(msg.includes("• Кошик: 0.9 м² × 2 030 ₴/м² = 1 827 ₴"));
  assert.ok(msg.includes("• Доплата за колір (небазовий, на замовлення): 200 ₴"));
  assert.ok(msg.includes("• Разом виробнича: 2 027 ₴"));
}

// ── Виправлення за аудитом 06.10.2026: зняття доплати за колір, дані форми, неповні підсумки ──
function testAuditFixes() {
  const styled = (sh) => Object.assign({}, sh, {
    getRange: (...args) => {
      const rng = sh.getRange(...args);
      const proxy = new Proxy(rng, { get: (target, prop) => (prop in target ? target[prop] : () => proxy) });
      return proxy;
    },
  });
  const make = (rows) => {
    const raw = makeSheet(rows);
    const props = makeProps();
    let appended = null;
    const ctx = load({
      SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheetByName: () => styled(raw) }), flush() {} },
      Utilities: { formatDate: () => "06.10.2026 12:00" },
      PropertiesService: { getScriptProperties: () => props },
      LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    });
    Object.assign(ctx, {
      ensureDiscountColumns_: () => {}, getPatternFileInfo_: () => null, ensureContactColumns_: () => {},
      setCommissionFormulas_: () => {}, applyOrderRowControls_: () => {}, withRequestCache_: (_p, _id, fn) => fn(),
      adminOrdersSheet_: () => styled(raw), syncOrderPaymentState_: () => {}, syncProcessingEvent_: () => {},
      adminGetOrder_: () => ({ status: "ok" }), nextOrderNumber: () => ORD,
      appendOrderRow_: (sh, row) => { appended = row; sh.getRange(sh.getLastRow() + 1, 1, 1, row.length).setValues([row]); return sh.getLastRow(); },
    });
    return { raw, ctx, props, sh: styled(raw), appended: () => appended };
  };
  const basket = (extra) => orderRow(ORD, "Нове", Object.assign({ 8: "Суцільний · AVL-01", 9: "RAL 6005", 13: 800, 14: 500, 15: 500, 16: 1,
    19: 1827, 21: 2466, 22: 639, 40: "Суцільний", 41: "Кошик" }, extra));
  const surcharges = (raw) => raw.data.slice(1).filter((r) => r[40] === "Доплата за колір");
  const same = { construction: "Суцільний · AVL-01", basket_model: "Суцільний", product_kind: "Кошик", specs: "", size_w: 800, size_h: 500, size_d: 500, quantity: 1 };

  // 1. Менеджер видалив «Доплату за колір» — вона не повертається за наступних правок.
  let t = make([basket({})]);
  t.ctx.syncColorSurcharge_(t.sh, ORD);
  assert.equal(surcharges(t.raw).length, 1);
  t.ctx.adminDeleteOrderItem_({ order_number: ORD, row: 3 });
  assert.equal(surcharges(t.raw).length, 0, "видалену вручну доплату одразу не повертаємо");
  t.ctx.adminUpdateOrder_({ order_number: ORD, row: 2, patch: Object.assign({}, same, { quantity: 4 }) });
  t.ctx.adminUpdateOrder_({ order_number: ORD, row: 2, patch: { cost_total: 7000, list_price: 9000, discount_pct: 0, discount_uah: 0, revenue: 9000 } });
  assert.equal(surcharges(t.raw).length, 0, "і після правки кількості чи фінансів — теж");
  // Колір став базовим → відмова знімається; знову небазовий — доплата зʼявляється, як для нового випадку.
  t.ctx.adminUpdateOrder_({ order_number: ORD, row: 2, patch: Object.assign({}, same, { quantity: 4, color: "Білий (RAL 9016)" }) });
  assert.equal(t.props.getProperty("color_waived_" + ORD), null);
  t.ctx.adminUpdateOrder_({ order_number: ORD, row: 2, patch: Object.assign({}, same, { quantity: 4, color: "RAL 3000" }) });
  assert.equal(surcharges(t.raw).length, 1);
  // Калькулятор явно переносить доплату після відмови — вона додається, відмова скасовується.
  t.ctx.adminDeleteOrderItem_({ order_number: ORD, row: 3 });
  assert.equal(t.props.getProperty("color_waived_" + ORD), "1");
  t.ctx.adminAddOrderItem_({ order_number: ORD, request_id: "calc-color-2",
    item: { product_type: "service", basket_model_name: "Доплата за колір", construction_type: "Доплата за колір", basket_type: "Доплата за колір", quantity: 1, unit: "шт.", cost_total: 200, price_total: 200 } });
  assert.equal(surcharges(t.raw).length, 1);
  assert.equal(t.props.getProperty("color_waived_" + ORD), null);

  // 1а. Повтор запиту після обриву: попередня спроба записала лише першу з трьох позицій —
  //     замовлення не вважаємо готовим, а дописуємо решту під той самий номер.
  t = make([Object.assign(basket({ 9: "Сірий (RAL 7016)", 40: "Перша" }), { 44: "req-partial" }), orderRow("ORD-110926-002", "Нове")]);
  const three = ["Перша", "Друга", "Третя"].map((name) => ({ product_type: "other", basket_model_name: name, quantity: 1, cost_total: 100, price_total: 150 }));
  let nextCalled = 0;
  t.ctx.nextOrderNumber = () => { nextCalled += 1; return "ORD-999999-999"; };
  let resumed = t.ctx.writeOrderToSheet_({ first_name: "Тест", phone: "+380000000000", request_id: "req-partial", items: three });
  assert.deepEqual(t.raw.data.slice(1).map((r) => [r[0], r[40]]),
    [[ORD, "Перша"], [ORD, "Друга"], [ORD, "Третя"], ["ORD-110926-002", "Ковш для трактора"]], "решта позицій — під тим самим номером, одразу під першою");
  assert.deepEqual([resumed.order_number, resumed.rows.length, !!resumed.duplicate, resumed.completed, nextCalled], [ORD, 3, false, true, 0]);
  assert.equal(t.raw.data[2][4], "Олександр Заєць", "клієнт і решта спільних даних — з уже записаного рядка");
  // Удруге той самий запит — уже повний дубль, нічого не додається.
  resumed = t.ctx.writeOrderToSheet_({ first_name: "Тест", phone: "+380000000000", request_id: "req-partial", items: three });
  assert.deepEqual([resumed.duplicate, resumed.rows.length, t.raw.data.length], [true, 3, 5]);

  // 1б. Позначка запиту: поки рядок заповнюється — «~ID», наприкінці — «ID». Недописаний рядок
  //     («~ID») повтор прибирає й записує позицію заново — під тим самим номером замовлення.
  t = make([Object.assign(basket({ 9: "Сірий (RAL 7016)", 40: "Перша" }), { 44: "req-mid" }),
    Object.assign(orderRow(ORD, "Нове", { 40: "Друга (недописана)", 19: "", 21: "", 22: "" }), { 44: "~req-mid" }),
    orderRow("ORD-110926-002", "Нове")]);
  t.ctx.nextOrderNumber = () => "ORD-999999-999";
  resumed = t.ctx.writeOrderToSheet_({ first_name: "Тест", phone: "+380000000000", request_id: "req-mid", items: three });
  assert.deepEqual(t.raw.data.slice(1).map((r) => [r[0], r[40], r[44]]),
    [[ORD, "Перша", "req-mid"], [ORD, "Друга", "req-mid"], [ORD, "Третя", "req-mid"], ["ORD-110926-002", "Ковш для трактора", ""]],
    "недописаний рядок замінено повним, усі позначки — «готово»");
  assert.deepEqual([resumed.rows.length, resumed.completed], [3, true]);
  // Обірвалась найперша позиція: готових рядків немає, номер замовлення використовуємо той самий.
  t = make([Object.assign(orderRow(ORD, "Нове", { 40: "Перша (недописана)" }), { 44: "~req-first" }), orderRow("ORD-110926-002", "Нове")]);
  let issued = 0;
  t.ctx.nextOrderNumber = () => { issued += 1; return "ORD-999999-999"; };
  t.ctx.appendOrderRow_ = (sh, row) => { sh.insertRowsAfter(1, 1); sh.getRange(2, 1, 1, row.length).setValues([row]); return 2; };
  resumed = t.ctx.writeOrderToSheet_({ first_name: "Тест", phone: "+380000000000", request_id: "req-first", items: three.slice(0, 1) });
  assert.deepEqual([resumed.order_number, issued, !!resumed.duplicate], [ORD, 0, false], "номер не згорів і новий не видано");
  assert.deepEqual(t.raw.data.slice(1).map((r) => [r[0], r[40], r[44]]), [[ORD, "Перша", "req-first"], ["ORD-110926-002", "Ковш для трактора", ""]]);
  // Додавання позиції до замовлення (add_item), попередня спроба якого обірвалась: недописаний
  // рядок прибрано, нова позиція стає на його місце, а не в чуже замовлення.
  t = make([basket({ 9: "Сірий (RAL 7016)" }), Object.assign(orderRow(ORD, "Нове", { 40: "Монтаж (недописаний)", 41: "Послуга" }), { 44: "~req-add" }), orderRow("ORD-110926-002", "Нове")]);
  t.ctx.adminAddOrderItem_({ order_number: ORD, request_id: "req-add",
    item: { product_type: "service", basket_model_name: "Монтаж", construction_type: "Монтаж", basket_type: "Монтаж", quantity: 1, unit: "шт.", cost_total: 1500, price_total: 1500 } });
  assert.deepEqual(t.raw.data.slice(1).map((r) => [r[0], r[40], r[44]]),
    [[ORD, "Суцільний", ""], [ORD, "Монтаж", "req-add"], ["ORD-110926-002", "Ковш для трактора", ""]]);

  // 1г. Дія кабінету обірвалась ПІСЛЯ запису рядків, але до прайсу/знижки: рядки лишаються
  //     «у роботі», тож повтор того самого запиту робить усе заново, а не повертає «готово».
  t = make([orderRow("ORD-110926-002", "Нове")]);
  let failFinance = true;
  const realFinance = t.ctx.applyFinanceToRow_;
  t.ctx.applyFinanceToRow_ = (sh, row, fin) => { if (failFinance) throw new Error("Service Spreadsheets failed"); return realFinance(sh, row, fin); };
  t.ctx.addDeliveryEvent = () => {};
  t.ctx.adminGetOrder_ = (d) => ({ status: "ok", order_number: d.order_number });
  t.ctx.appendOrderRow_ = (sh, row) => { const at = sh.getLastRow(); sh.insertRowsAfter(at, 1); sh.getRange(at + 1, 1, 1, row.length).setValues([row]); return at + 1; };
  const calcOrder = { client: "Петро", phone: "+380671234567", request_id: "req-create", items: [
    { product_type: "basket", basket_model: "AVL-05", basket_model_name: "Розбірний", construction_type: "Розбірний (з 3-х частин) · AVL-05", color: "Сірий (RAL 7016)",
      size_w: 750, size_h: 700, size_d: 440, quantity: 14, cost_total: 34664, list_price: 46802, discount_pct: 10, discount_uah: 4680, price_total: 42122 },
    { product_type: "service", basket_model_name: "Монтаж", construction_type: "Монтаж", basket_type: "Монтаж", quantity: 14, unit: "шт.", cost_total: 21000, price_total: 21000 }] };
  assert.throws(() => t.ctx.adminCreateOrder_({ order: JSON.parse(JSON.stringify(calcOrder)) }), /Service Spreadsheets failed/);
  assert.deepEqual(t.raw.data.slice(2).map((r) => r[44]), ["~req-create", "~req-create"], "рядки записано, але вони ще «у роботі»");
  failFinance = false;
  const again = t.ctx.adminCreateOrder_({ order: JSON.parse(JSON.stringify(calcOrder)) });
  assert.deepEqual(t.raw.data.slice(1).map((r) => [r[0], r[40], r[44]]),
    [["ORD-110926-002", "Ковш для трактора", ""], [ORD, "Розбірний", "req-create"], [ORD, "Монтаж", "req-create"]],
    "недороблені рядки замінено, дублів немає, позначки — «готово»");
  assert.deepEqual(t.raw.data[2].slice(34, 37), [46802, 10, 4680], "прайс і знижку цього разу застосовано");
  assert.equal(again.order_number, ORD);
  // Третій раз той самий запит — уже готовий дубль: нічого не змінюється.
  const snapshot = JSON.stringify(t.raw.data);
  t.ctx.adminCreateOrder_({ order: JSON.parse(JSON.stringify(calcOrder)) });
  assert.equal(JSON.stringify(t.raw.data), snapshot);
  // Доплата за колір не додалась через збій таблиці. Разовий збій — пробуємо ще раз одразу;
  // якщо й удруге ні — дія НЕ завершена (рядок «у роботі»), а повтор запиту робить усе заново.
  const colorCase = (failures) => {
    const c = make([orderRow("ORD-110926-002", "Нове")]);
    c.ctx.addDeliveryEvent = () => {};
    c.ctx.adminGetOrder_ = (d) => ({ status: "ok", order_number: d.order_number });
    c.ctx.appendOrderRow_ = (sh, row) => { const at = sh.getLastRow(); sh.insertRowsAfter(at, 1); sh.getRange(at + 1, 1, 1, row.length).setValues([row]); return at + 1; };
    const realSync = c.ctx.syncColorSurcharge_;
    c.failures = failures;
    c.ctx.syncColorSurcharge_ = (...args) => { if (c.failures > 0) { c.failures -= 1; throw new Error("Service Spreadsheets failed"); } return realSync(...args); };
    return c;
  };
  const colored = (requestId) => ({ order: { client: "Петро", phone: "+380671234567", request_id: requestId, items: [
    { product_type: "basket", basket_model: "AVL-01", basket_model_name: "Суцільний", construction_type: "Суцільний · AVL-01", color: "RAL 6005",
      size_w: 800, size_h: 500, size_d: 500, quantity: 1 }] } });
  const basketMarkers = (c) => c.raw.data.slice(1).filter((r) => r[0] === ORD && r[40] === "Суцільний").map((r) => r[44]);
  let cc = colorCase(1);
  cc.ctx.adminCreateOrder_(colored("req-color"));
  assert.equal(surcharges(cc.raw).length, 1, "разовий збій: доплату додано з другої спроби");
  assert.deepEqual(basketMarkers(cc), ["req-color"], "дію завершено");
  cc = colorCase(2);
  assert.throws(() => cc.ctx.adminCreateOrder_(colored("req-color-2")), /Service Spreadsheets failed/);
  assert.deepEqual([surcharges(cc.raw).length, basketMarkers(cc)], [0, ["~req-color-2"]], "доплати немає — дія не завершена, рядок лишається «у роботі»");
  cc.ctx.adminCreateOrder_(colored("req-color-2"));
  assert.deepEqual([surcharges(cc.raw).length, basketMarkers(cc)], [1, ["req-color-2"]], "повтор того самого запиту: кошик — один, доплата — на місці");
  // Те саме для додавання позиції до наявного замовлення.
  cc = colorCase(2);
  cc.raw.data.push(basket({ 9: "Сірий (RAL 7016)" }));
  const addColored = { order_number: ORD, request_id: "req-add-color", item: { product_type: "basket", basket_model: "AVL-01", basket_model_name: "Суцільний (другий)",
    construction_type: "Суцільний · AVL-01", color: "RAL 6005", size_w: 800, size_h: 500, size_d: 500, quantity: 1 } };
  assert.throws(() => cc.ctx.adminAddOrderItem_(JSON.parse(JSON.stringify(addColored))), /Service Spreadsheets failed/);
  assert.equal(surcharges(cc.raw).length, 0);
  cc.ctx.adminAddOrderItem_(JSON.parse(JSON.stringify(addColored)));
  assert.deepEqual([surcharges(cc.raw).length, cc.raw.data.filter((r) => r[40] === "Суцільний (другий)").map((r) => r[44])], [1, ["req-add-color"]],
    "повтор: позиція одна, доплата додана, запит завершено");

  // Подія в календарі — одна на замовлення.
  const evProps = makeProps({ ["evt_" + ORD]: "ev1" });
  let created = 0;
  const cal = load({ PropertiesService: { getScriptProperties: () => evProps } });
  let inCalendar = [];
  cal.getCal = () => ({ getEvents: () => inCalendar,
    createEvent: () => { created += 1; return { removeAllReminders() {}, addPopupReminder() {}, addEmailReminder() {}, getId: () => "ev2" }; } });
  cal.addDeliveryEvent({ order_number: ORD, delivery_date: "2026-10-20", first_name: "Тест" });
  assert.equal(created, 0, "подія вже є — другу не створюємо");
  cal.addDeliveryEvent({ order_number: "ORD-061026-777", delivery_date: "2026-10-20", first_name: "Тест" });
  assert.equal(created, 1);
  // Подію створено, але позначку записати не встигли: знаходимо її в календарі за номером.
  // Та спроба могла обірватись і посеред нагадувань (лишилось одне з чотирьох) — виставляємо заново.
  const foundEvent = { reminders: ["popup:0"], getTitle: () => "📦 ORD-061026-888 — Тест", getId: () => "ev-found",
    removeAllReminders() { this.reminders = []; }, addPopupReminder(m) { this.reminders.push("popup:" + m); },
    addEmailReminder(m) { this.reminders.push("email:" + m); } };
  inCalendar = [foundEvent];
  cal.addDeliveryEvent({ order_number: "ORD-061026-888", delivery_date: "2026-10-20", first_name: "Тест" });
  assert.equal(created, 1, "другої події не створено");
  assert.equal(evProps.getProperty("evt_ORD-061026-888"), "ev-found");
  assert.deepEqual(foundEvent.reminders, ["popup:0", "popup:2880", "email:0", "email:2880"], "на знайденій події — повний набір нагадувань");

  // 1в. Кошик без глибини формулою не рахується (була б одна лицева стінка); екрану глибина не обовʼязкова.
  t = make([]);
  const noDepth = { product_type: "basket", basket_model: "AVL-01", construction_type: "Суцільний · AVL-01", size_w: 800, size_h: 500, size_d: "", quantity: 1 };
  t.ctx.writeOrderToSheet_({ first_name: "Тест", phone: "+380000000000", items: [noDepth] });
  assert.deepEqual([t.appended()[17], t.appended()[19], t.appended()[21]], ["", "", ""], "без глибини — без площі й автоціни");
  t.ctx.writeOrderToSheet_({ first_name: "Тест", phone: "+380000000000", items: [Object.assign({}, noDepth, { basket_model: "AVL-02", construction_type: "Розбірна · AVL-02", size_h: 540, size_d: 0 })] });
  assert.equal(t.appended()[19], 2577, "екран без бортів: 0,432 × 2 030 + кріплення 1 700");

  // 1д. Пораховану формулою позицію лишили без глибини — суми зі старих розмірів прибираються
  //     (знижка % лишається); позицію, що й була без розмірів, зміна кількості не чіпає.
  t = make([basket({ 9: "Сірий (RAL 7016)", 17: 0.9, 18: 1827, 34: 2466, 35: 5, 36: 123 })]);
  t.ctx.adminUpdateOrder_({ order_number: ORD, row: 2, patch: Object.assign({}, same, { size_d: 0 }) });
  assert.deepEqual(t.raw.data[1].slice(17, 24), ["", "", "", "", "", "", ""], "площа й суми прибрані");
  assert.deepEqual(t.raw.data[1].slice(34, 37), ["", 5, ""], "знижка % лишилась");
  t.ctx.adminUpdateOrder_({ order_number: ORD, row: 2, patch: Object.assign({}, same, { size_d: 500 }) });
  assert.deepEqual([t.raw.data[1][19], t.raw.data[1][21], t.raw.data[1][35]], [1827, 2343, 5], "глибину повернули — формула знову рахує, зі знижкою 5 %");
  t = make([basket({ 9: "Сірий (RAL 7016)", 15: "", 19: 3000, 21: 4500, 22: 1500 })]);
  t.ctx.adminUpdateOrder_({ order_number: ORD, row: 2, patch: Object.assign({}, same, { size_d: 0, quantity: 3 }) });
  assert.deepEqual([t.raw.data[1][16], t.raw.data[1][19], t.raw.data[1][21]], [3, 3000, 4500], "ціну менеджера для позиції без розмірів не чіпаємо");

  // 2. Заявка з форми: площа, розміри блока, опис власного візерунка, контакт без дубля.
  t = make([]);
  const zeros = { price_total: 0, area_m2: 0, cost_total: 0 };
  t.ctx.writeOrderToSheet_({ first_name: "Ірина", phone: "+380501112233", contact_method: "telegram", contact_telegram: "irka",
    notes: "Telegram: @irka\nПодзвонити після 18", items: [Object.assign({ product_type: "basket", basket_model: "AVL-01", basket_model_name: "Суцільний",
      construction_type: "Суцільний · AVL-01", color: "RAL 6005", pattern: "Інший", pattern_custom: "дубове листя", quantity: 2,
      size_mode: "ac", size_w: 900, size_h: 550, size_d: 500, block_w: 800, block_h: 550, block_d: 300, covers_brackets: true }, zeros)] });
  const row = t.appended();
  assert.equal(row[17], 1.05, "площа порахована, хоч форма шле area_m2: 0");
  assert.deepEqual([row[19], row[21]], ["", ""], "ціни заявка з форми не має — рахує менеджер");
  assert.equal(row[10], "Інший: дубове листя", "опис власного візерунка не губиться");
  assert.equal(row[31], "Telegram: @irka\nПодзвонити після 18", "контакт у примітках — один раз");
  assert.equal(t.raw.data[1][42], "Блок кондиціонера (В×Ш×Г): 550×800×300 мм\nКошик закриває кронштейни (+120 мм висоти)");
  assert.equal(t.ctx.withCustom_("RAL 6005", ""), "RAL 6005");
  assert.equal(t.ctx.withCustom_("", "золото"), "золото");
  assert.equal(t.ctx.withCustom_("Інший", "Інший"), "Інший");

  // 3. Повідомлення: позиції без вартості видно, підсумки підписані як неповні, послуга — з назвою,
  //    коментар позиції не дублюється наприкінці.
  const mctx = load({ Utilities: { formatDate: () => "06.10.2026, 12:00" }, Date, PropertiesService: { getScriptProperties: () => makeProps() } });
  const msg = mctx.buildProductionMsg_({ order_number: ORD,
    notes: "Подзвонити після 18\nAVL-01: По 3 вуха на сторону\nAVL-01: посилання на кондиціонер https://x.test/a\nПо 3 вуха на сторону\nTelegram: @irka",
    items: [
      { product_type: "basket", construction_type: "Суцільний · AVL-01", size_w: 800, size_h: 500, size_d: 500, quantity: 1, unit: "шт.", cost_total: 1827, revenue: 2466, profit: 639, comment: "По 3 вуха на сторону" },
      { product_type: "basket", basket_type: "Антивандальний", construction_type: "Розбірний (з 3-х частин) · AVL-05", size_w: 750, size_h: 700, size_d: 440, quantity: 1, unit: "шт." },
      { product_type: "service", basket_model_name: "Монтаж", basket_type: "Монтаж", quantity: 1, unit: "шт.", cost_total: 1500, revenue: 1500, profit: 0 },
    ] }, { finance: true, notes: true }).replace(/<[^>]+>/g, "");
  [
    "• Кошик 1: 0.9 м² × 2 030 ₴/м² = 1 827 ₴",
    "• Послуга 3 · Монтаж: 1 500 ₴",
    "• Кошик 2: вартість уточнюється",
    "• Разом виробнича (без позицій, що уточнюються): 3 327 ₴",
    "• Ціна для клієнта (без позицій, ціну яких ще не визначено): 3 966 ₴",
  ].forEach((line) => assert.ok(msg.includes(line), line + "\n---\n" + msg));
  const tail = msg.slice(msg.indexOf("Додаткова інформація"));
  assert.ok(tail.includes("Подзвонити після 18"));
  assert.ok(!tail.includes("По 3 вуха") && !tail.includes("посилання на кондиціонер") && !tail.includes("@irka"), tail);
  // Усе пораховано — жодних «уточнюється» і приміток про неповноту.
  const full = mctx.buildProductionMsg_({ order_number: ORD, items: [
    { product_type: "basket", construction_type: "Суцільний · AVL-01", size_w: 800, size_h: 500, size_d: 500, quantity: 1, unit: "шт.", cost_total: 1827, revenue: 2466, profit: 639 },
    { product_type: "service", basket_model_name: "Монтаж", quantity: 1, unit: "шт.", cost_total: 1500, revenue: 1500, profit: 0 },
  ] }, { finance: true }).replace(/<[^>]+>/g, "");
  assert.ok(!full.includes("уточнюється") && !full.includes("без позицій"), full);
  assert.ok(full.includes("• Разом виробнича: 3 327 ₴") && full.includes("• Ціна для клієнта: 3 966 ₴"));
  // Нічого не пораховано (свіжа заявка) — розділу фінансів, як і раніше, немає.
  const fresh = mctx.buildProductionMsg_({ order_number: ORD, items: [
    { product_type: "basket", basket_type: "Антивандальний", construction_type: "Суцільний · AVL-01", size_w: 800, size_h: 500, size_d: 500, quantity: 1, unit: "шт." },
    { product_type: "bracket", basket_model_name: "AVL-K-01", quantity: 1, unit: "комп." },
  ] }, { finance: true });
  assert.ok(!fresh.includes("ФІНАНСИ"), "порожні «Фінанси» не друкуємо");

  // 4. Правка прямо в таблиці: вставлений діапазон, що зачепив розміри, перераховує рядки —
  //    навіть коли починається з колонки «Тип».
  const et = make([basket({ 7: "Декоративний", 10: "K1" })]);
  const recalced = [];
  et.ctx.recalcRow_ = (_sh, r) => { recalced.push(r); };
  const edit = (col, cols, oldValue, value) => et.ctx.onEditDelivery({ oldValue, range: {
    getSheet: () => Object.assign({ getName: () => "Замовлення" }, et.sh), getRow: () => 2, getColumn: () => col,
    getNumRows: () => 1, getNumColumns: () => cols, getValue: () => value } });
  edit(8, 10, undefined, "x");
  assert.deepEqual(recalced, [2], "діапазон H:Q зачепив розміри й кількість");
  // Діапазон, що починається НЕ з «цінової» колонки (A:Q, G:Q), теж перераховує.
  edit(1, 17, undefined, "x");
  edit(7, 11, undefined, "x");
  assert.deepEqual(recalced, [2, 2, 2]);
  edit(1, 5, undefined, "x");
  assert.deepEqual(recalced, [2, 2, 2], "A:E розмірів не зачіпає");
  recalced.length = 1;
  edit(8, 1, "Декоративний", "Стандарт");
  edit(11, 1, "K1", "K2");
  edit(43, 1, "", "Кронштейн: K2");
  assert.deepEqual(recalced, [2], "тип, звичайний візерунок і нейтральні характеристики суми не чіпають");
  et.raw.data[1][10] = "K2";
  edit(11, 1, "K3", "K2");
  assert.deepEqual(recalced, [2, 2], "складний візерунок замінили звичайним — повертається формула");
  edit(43, 1, "", "Матеріал: Алюміній");
  edit(14, 1, 800, 900);
  assert.deepEqual(recalced, [2, 2, 2, 2]);

  // 4а. Правка в таблиці, після якої позиції бракує розміру: суми зі старих розмірів прибираються.
  //     Одна клітинка — попередній стан відомий точно; діапазон — звіряємо площу з розмірами.
  const sheetEdit = (tt, col, cols, rows, oldValue) => tt.ctx.onEditDelivery({ oldValue, range: {
    getSheet: () => Object.assign({ getName: () => "Замовлення" }, tt.sh), getRow: () => 2, getColumn: () => col,
    getNumRows: () => rows, getNumColumns: () => cols, getValue: () => tt.raw.data[1][col - 1] } });
  const sums = (tt, i) => tt.raw.data[i].slice(17, 24);
  const CLEARED = ["", "", "", "", "", "", ""];
  const priced = (extra) => basket(Object.assign({ 9: "Сірий (RAL 7016)", 17: 0.9 }, extra));
  // Одна клітинка: стерли глибину (старе значення відоме).
  let st = make([priced({ 15: "" })]);
  sheetEdit(st, 16, 1, 1, 500);
  assert.deepEqual(sums(st, 1), CLEARED, "стерли глибину — суми прибрано");
  // Одна клітинка: екран (глибина не потрібна) став кошиком без глибини — через конструкцію чи модель.
  const screenSums = { 14: 540, 15: "", 17: 0.43, 19: 2577, 21: 3479, 22: 902 };
  st = make([priced(Object.assign({ 8: "Суцільний · AVL-01", 40: "Екран під утеплювач" }, screenSums))]);
  sheetEdit(st, 9, 1, 1, "Розбірна · AVL-02");
  assert.deepEqual(sums(st, 1), CLEARED, "екран став кошиком без глибини (колонка конструкції) — суми екрана прибрано");
  st = make([priced(Object.assign({ 8: "Суцільний", 40: "Суцільний AVL-01" }, screenSums))]);
  sheetEdit(st, 41, 1, 1, "Екран AVL-02");
  assert.deepEqual(sums(st, 1), CLEARED, "те саме через колонку моделі");
  // Одна клітинка, але старе значення невідоме (вставка): звіряємо площу з розмірами.
  st = make([priced({ 15: "" })]);
  sheetEdit(st, 16, 1, 1, undefined);
  assert.deepEqual(sums(st, 1), CLEARED);
  // Діапазон: глибину стерли одразу в кількох рядках.
  st = make([priced({ 15: "" }), priced({ 15: "" })]);
  sheetEdit(st, 16, 1, 2, undefined);
  assert.deepEqual([sums(st, 1), sums(st, 2)], [CLEARED, CLEARED], "стерли глибину в кількох рядках — суми прибрано в усіх");
  // Діапазон: екран без бортів вставкою зробили кошиком. Площа та сама (лицева стінка), але
  // собівартість — екрана (з комплектом кріплення): суми прибираються.
  st = make([priced(Object.assign({ 8: "Суцільний · AVL-01", 40: "Суцільний" }, screenSums, { 18: 2577 }))]);
  sheetEdit(st, 8, 3, 1, undefined);
  assert.deepEqual(sums(st, 1), CLEARED, "екран став кошиком у вставленому діапазоні — суми екрана прибрано");
  // Діапазон зачепив розміри, але позиція й була без розмірів, з ціною менеджера (площі немає).
  st = make([basket({ 9: "Сірий (RAL 7016)", 15: "", 19: 3000, 21: 4500, 22: 1500 })]);
  sheetEdit(st, 14, 3, 1, undefined);
  assert.deepEqual([st.raw.data[1][19], st.raw.data[1][21]], [3000, 4500], "ціну менеджера для позиції без розмірів не чіпаємо");
  // Рядок, який попередня версія порахувала без глибини (площа — одна лицева стінка), розмірів не втрачав.
  st = make([basket({ 9: "Сірий (RAL 7016)", 15: "", 17: 0.4, 18: 812, 19: 812, 21: 1096, 22: 284 })]);
  sheetEdit(st, 14, 3, 1, undefined);
  assert.deepEqual([st.raw.data[1][17], st.raw.data[1][19], st.raw.data[1][21]], [0.4, 812, 1096], "давній рядок без глибини не чіпаємо");
  // Правка лише кількості стан розмірів не міняє — нічого не прибирається.
  st = make([priced({ 15: "" })]);
  sheetEdit(st, 17, 1, 1, 1);
  assert.deepEqual([st.raw.data[1][19], st.raw.data[1][21]], [1827, 2466]);
  // Звичайна правка розміру рядка з усіма розмірами — формула рахує, як і раніше.
  st = make([priced({ 13: 900 })]);
  sheetEdit(st, 14, 1, 1, 800);
  assert.deepEqual([st.raw.data[1][17], st.raw.data[1][19], st.raw.data[1][21]], [0.95, 1929, 2603], "0,95 м² × 2 030 = 1 929 ₴; × 1,35 = 2 603 ₴");
}

testMessageOptions();
testStatusChangeFromCrmDoesNotAutoSend();
testResumableUpload();
testSendFileToContractor();
testContractorSendFlow();
testStatusesMigrationAndCanon();
testProcessingFlow();
testSheetStatusProcessing();
testFilesCountBackfill();
testSmallUpload();
testProcessingPreviewSections();
testServiceKind();
testModelPhotoAndFinanceLines();
testDeleteOrderItem();
testMarginOwedAndCancelReason();
testItemComments();
testAddOrderItem();
testUnifiedPricingInSheet();
testColorSurchargeInSheet();
testAuditFixes();
console.log("contractor-send tests: OK");
