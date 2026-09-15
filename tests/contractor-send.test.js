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
  const W = 48;
  const pad = (r) => { const a = r.slice(); while (a.length < W) a.push(""); return a; };
  const data = [new Array(W).fill("")].concat(rows.map(pad));
  return {
    data,
    getLastRow: () => data.length,
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
  const r = new Array(48).fill("");
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
  assert.equal(ctx.ADMIN_ORDER_COLS, 48);
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
console.log("contractor-send tests: OK");
