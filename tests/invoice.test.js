// Рахунок на оплату (06.11.2026): реквізити, сума прописом, документ, журнал СФ-NNNN, сервер кабінету.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const vm = require("vm");
const inv = require("../lib/avalon-invoice");

// ── 1. Ядро (реквізити й сума прописом) — те саме, що в калькуляторі ──
const INVOICE_CORE_SHA256 = "0b68925d89fd2872559801575fe3f52d20e06a846ffde9e2b81e495748245018";
const src = fs.readFileSync(path.join(__dirname, "..", "lib", "avalon-invoice.js"), "utf8");
const core = src.slice(src.indexOf("// AVALON-INVOICE-CORE-START"), src.indexOf("// AVALON-INVOICE-CORE-END"));
assert.equal(crypto.createHash("sha256").update(core).digest("hex"), INVOICE_CORE_SHA256,
  "ядро рахунку змінилось — онови й копію в калькуляторі (src/lib/avalonInvoice.mjs) і хеш в обох тестах");

// ── 2. Реквізити: IBAN, ЄДРПОУ, РНОКПП, ІПН — контрольні цифри ──
function ibanOk(s) { const r = s.slice(4) + s.slice(0, 4); return BigInt(r.split("").map((c) => parseInt(c, 36)).join("")) % 97n === 1n; }
const { fop, tov } = inv.AVALON_INVOICE_SELLERS;
assert.ok(ibanOk(fop.iban) && fop.iban.length === 29, "IBAN ФОП");
assert.ok(ibanOk(tov.iban) && tov.iban.length === 29, "IBAN ТОВ");
assert.equal(tov.iban, "UA533052990000026005036003734");
assert.equal(tov.ipn.length, 12);
assert.equal(tov.ipn.slice(0, 7), tov.code.slice(0, 7));
assert.equal(fop.vat, false); assert.equal(tov.vat, true);

// ── 3. Сума прописом ──
const W = inv.avalonAmountInWords;
assert.equal(W(4300), "Чотири тисячі триста гривень 00 копійок");
assert.equal(W(1), "Одна гривня 00 копійок");
assert.equal(W(2), "Дві гривні 00 копійок");
assert.equal(W(11), "Одинадцять гривень 00 копійок");
assert.equal(W(21), "Двадцять одна гривня 00 копійок");
assert.equal(W(1001), "Одна тисяча одна гривня 00 копійок");
assert.equal(W(2000), "Дві тисячі гривень 00 копійок");
assert.equal(W(21000), "Двадцять одна тисяча гривень 00 копійок");
assert.equal(W(81396), "Вісімдесят одна тисяча триста дев'яносто шість гривень 00 копійок");
assert.equal(W(1000000), "Один мільйон гривень 00 копійок");
assert.equal(W(2500000.5), "Два мільйони п'ятсот тисяч гривень 50 копійок");
assert.equal(W(50.02), "П'ятдесят гривень 02 копійки");
assert.equal(W(0.01), "Нуль гривень 01 копійка");
assert.equal(inv.avalonVatOf(4229), 704.83);

// ── 4. Документ ──
const lines = [{ name: "Кошик для кондиціонера AVL-01, 700×900×600 мм, RAL 9005", qty: 1, unit: "шт.", sum: 4029 },
               { name: "Доплата за небазовий колір", qty: 1, unit: "шт.", sum: 200 }];
const hFop = inv.buildInvoiceHtml({ number: "СФ-0001", date: "06.11.2026", seller: "fop", order_number: "ORD-031126-001",
  buyer: { kind: "person", name: "Сергій <script>", phone: "+380 67 286 28 94" }, lines, order_total: 4229, paid_before: 0, amount: 4229 });
assert.ok(/РАХУНОК НА ОПЛАТУ № СФ-0001/.test(hFop));
assert.ok(/Арцаблюк/.test(hFop) && /UA893052990000026007016013258/.test(hFop) && /РНОКПП: 2784904055/.test(hFop));
assert.ok(/Без ПДВ/.test(hFop) && !/ПДВ 20/.test(hFop));
assert.ok(/Чотири тисячі двісті двадцять дев'ять гривень 00 копійок/.test(hFop));
assert.ok(!/<script>/.test(hFop) && /Сергій &lt;script&gt;/.test(hFop), "текст покупця екранується");
assert.ok(/Всього до оплати:/.test(hFop) && !/Сплачено раніше/.test(hFop));
assert.ok(/протягом 3 днів/.test(hFop) && !/10 днів/.test(hFop));
assert.ok(!/display:\s*flex/.test(hFop), "без flex — Word показує шапку й сторони таблицями");
// Рахунок на всю суму, коли клієнт уже платив, — «Сплачено раніше» видно (щоб не заплатили двічі).
const hAll = inv.buildInvoiceHtml({ number: "СФ-0003", date: "06.11.2026", seller: "fop", buyer: { name: "К" }, lines,
  order_total: 10000, paid_before: 6000, amount: 10000 });
assert.ok(/Сплачено раніше:<\/td><td class="r">6\u00a0000\u00a0₴/.test(hAll) && /більше за залишок/.test(hAll), "рахунок на всю суму при оплаті");
// Ціна з копійками, коли сума не ділиться на кількість.
const hKop = inv.buildInvoiceHtml({ number: "СФ-0004", date: "06.11.2026", seller: "fop", buyer: { name: "К" },
  lines: [{ name: "Кронштейни", qty: 3, unit: "комп.", sum: 1000 }], order_total: 1000, amount: 1000 });
assert.ok(/333,33\u00a0₴/.test(hKop), "ціна 1 000 / 3 = 333,33");
const hTov = inv.buildInvoiceHtml({ number: "СФ-0002", date: "06.11.2026", seller: "tov", order_number: "ORD-1",
  buyer: { kind: "company", name: "ТОВ «Клієнт»", code: "12345678" }, lines, order_total: 4229, paid_before: 1000, amount: 3229,
  stamp_url: "https://x/calc/img/stamp.png" });
assert.ok(/Валон-А/.test(hTov) && /UA533052990000026005036003734/.test(hTov) && /ІПН: 141522322252/.test(hTov) && /Платник ПДВ/.test(hTov));
assert.ok(/Сплачено раніше:/.test(hTov) && /До оплати за цим рахунком/.test(hTov));
assert.ok(/у т\. ч\. ПДВ 20 %:<\/td><td class="r">538,17\u00a0₴/.test(hTov), "ПДВ = 3229 / 6");
assert.ok(/Сума без ПДВ:<\/td><td class="r">2\u00a0690,83\u00a0₴/.test(hTov));
assert.ok(/stamp\.png/.test(hTov) && !/stamp\.png/.test(hFop), "печатка — лише ТОВ");
assert.ok(/Код ЄДРПОУ: 12345678/.test(hTov));
// Word — справжній .docx: ZIP з трьох частин, документ XML коректний і з тими самими даними, що й PDF.
const wd = { number: "СФ-0001", date: "06.11.2026", seller: "fop", order_number: "ORD-031126-001",
  buyer: { kind: "person", name: "Сергій <&>" }, lines, order_total: 4229, paid_before: 0, amount: 4229 };
const docx = inv.buildInvoiceDocx(wd);
assert.equal(Buffer.from(docx.slice(0, 4)).toString("hex"), "504b0304", "ZIP");
const docXml = inv.invoiceDocxXml(wd);
assert.ok(/Сергій &lt;&amp;&gt;/.test(docXml) && !/<&>/.test(docXml), "текст у XML екранується");
assert.ok(/Чотири тисячі двісті двадцять дев'ять гривень 00 копійок/.test(docXml) && /Без ПДВ/.test(docXml));
assert.ok(/w:tblLayout w:type="fixed"/.test(docXml), "фіксовані ширини колонок — без зсувів у Google Документах і Pages");
for (const part of ["[Content_Types].xml", "_rels/.rels", "word/document.xml"]) assert.ok(Buffer.from(docx).includes(Buffer.from(part)), part);
// Порядок елементів за схемою Word: tblW → jc → tblBorders; tcW → gridSpan → shd.
const tovXml = inv.invoiceDocxXml(Object.assign({}, wd, { seller: "tov", paid_before: 1000, amount: 3229 }));
assert.ok(!/<w:tblPr><w:jc/.test(tovXml) && /<w:tblW [^>]*\/><w:jc w:val="right"\/><w:tblBorders>/.test(tovXml), "jc після tblW");
assert.ok(!/<w:shd [^>]*\/><w:gridSpan/.test(docXml) && /<w:gridSpan w:val="2"\/>/.test(docXml), "gridSpan перед shd");
// Невидимі службові символи не ламають XML.
const ctlXml = inv.invoiceDocxXml(Object.assign({}, wd, { lines: [{ name: "Кошик\u0001\u001f x", qty: 1, unit: "шт.", sum: 100 }], order_total: 100, amount: 100 }));
assert.ok(/Кошик x/.test(ctlXml) && !/[\u0000-\u0008\u000E-\u001F]/.test(ctlXml), "керівні символи прибрано");
// Логотип і печатка ТОВ вбудовуються як PNG; у ФОП печатки немає.
const png = (w, h) => { const b = new Uint8Array(33); b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0); const dv = new DataView(b.buffer); dv.setUint32(16, w); dv.setUint32(20, h); return b; };
const has = (zip, s) => Buffer.from(zip).includes(Buffer.from(s));
const tovDocx = inv.buildInvoiceDocx(Object.assign({}, wd, { seller: "tov" }), { logo: png(800, 800), stamp: png(1024, 962) });
assert.ok(has(tovDocx, "word/media/logo.png") && has(tovDocx, "word/media/stamp.png") && has(tovDocx, 'r:embed="rIdStamp"') && has(tovDocx, "word/_rels/document.xml.rels"), "ТОВ: логотип і печатка");
assert.ok(has(tovDocx, 'cx="1463040" cy="1374458"'), "печатка 1,6 дюйма за пропорцією файлу");
const fopDocx = inv.buildInvoiceDocx(wd, { logo: png(800, 800), stamp: png(1024, 962) });
assert.ok(has(fopDocx, "word/media/logo.png") && !has(fopDocx, "stamp.png") && !has(fopDocx, "AVALON METAL DESIGN"), "ФОП: логотип замість напису, без печатки");
assert.ok(has(docx, "AVALON METAL DESIGN") && !has(docx, "media/"), "без картинок — напис, як раніше");
const hLogo = inv.buildInvoiceHtml(Object.assign({}, wd, { logo_url: "https://x/admin/img/avalon-logo.svg" }));
assert.ok(/<img class="logo" src="https:\/\/x\/admin\/img\/avalon-logo\.svg"/.test(hLogo) && !/кошики для кондиціонерів/.test(hLogo), "PDF: логотип замість напису");

// ── 5. Журнал рахунків у скрипті таблиці ──
const CODE = fs.readFileSync(path.join(__dirname, "..", "google-apps-script-v2.js"), "utf8");
function makeSheet(data, w) {
  const sh = { data, getLastRow: () => data.length, getMaxColumns: () => w,
    setColumnWidth() {}, setFrozenRows() {}, insertColumnsAfter() {}, setRowHeight() {},
    getRange(r, c, nr, nc) {
      if (typeof r === "string") return new Proxy({}, { get: () => function () { return this; } });
      const R = nr || 1, C = nc || 1;
      const rng = { getValues: () => { const o = []; for (let i = 0; i < R; i++) o.push((data[r - 1 + i] || new Array(w).fill("")).slice(c - 1, c - 1 + C)); return o; },
        setValues: (v) => { v.forEach((vr, i) => { while (data.length < r + i) data.push(new Array(w).fill("")); vr.forEach((x, j) => { data[r - 1 + i][c - 1 + j] = x; }); }); return px; },
        getValue: () => (data[r - 1] || [])[c - 1], setValue: (v) => { rng.setValues([[v]]); return px; } };
      const px = new Proxy(rng, { get: (t, p) => (p in t ? t[p] : () => px) });
      return px;
    } };
  return sh;
}
const orders = makeSheet([new Array(50).fill(""), Object.assign(new Array(50).fill(""), { 0: "ORD-031126-001" })], 50);
const sheets = {};
const propStore = {};
const ss = { getSheetByName: (n) => sheets[n] || null, insertSheet: (n) => (sheets[n] = makeSheet([], 26)) };
const ctx = vm.createContext({ console, Date, SpreadsheetApp: { getActiveSpreadsheet: () => ss, flush() {} },
  PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => (k in propStore ? propStore[k] : null), setProperty: (k, v) => { propStore[k] = String(v); } }) },
  Utilities: { formatDate: () => "2026-11-06" } });
vm.runInContext(CODE, ctx);
ctx.adminOrdersSheet_ = () => orders;
const base = { order_number: "ORD-031126-001", seller: "fop", amount: 4229, buyer: { kind: "person", name: "Сергій" },
  lines, order_total: 4229, paid_before: 0 };
const a1 = ctx.adminInvoiceCreate_(Object.assign({}, base, { request_id: "inv-000001" }));
assert.equal(a1.invoice.number, "СФ-0001");
assert.equal(a1.invoice.seller, "ФОП Арцаблюк");
assert.equal(a1.invoice.data.lines.length, 2);
const again = ctx.adminInvoiceCreate_(Object.assign({}, base, { request_id: "inv-000001" }));
assert.equal(again.duplicate, true);
assert.equal(again.invoice.number, "СФ-0001", "повтор — той самий рахунок, без нового номера");
const a2 = ctx.adminInvoiceCreate_(Object.assign({}, base, { request_id: "inv-000002", seller: "tov", amount: 2000 }));
assert.equal(a2.invoice.number, "СФ-0002");
assert.equal(a2.invoice.seller, "ТОВ «Валон-А»");
assert.equal(a2.invoices.length, 2);
assert.equal(a2.invoice.created_by, "власник");
// Видалили останній рядок журналу вручну — номер не повторюється.
sheets["Рахунки"].data.pop();
const a3 = ctx.adminInvoiceCreate_(Object.assign({}, base, { request_id: "inv-000006", created_by: "manager",
  buyer: { kind: "person", name: "=HYPERLINK(1)" } }));
assert.equal(a3.invoice.number, "СФ-0003", "лічильник не зменшується");
assert.equal(a3.invoice.created_by, "менеджер");
assert.equal(sheets["Рахунки"].data[sheets["Рахунки"].data.length - 1][4], "'=HYPERLINK(1)", "імʼя — текстом, не формулою");
assert.equal(a3.invoice.buyer_name, "=HYPERLINK(1)");
sheets["Рахунки"].data.push(a2.invoice && ["2026-11-06", "СФ-0002", "ORD-031126-001", "ТОВ «Валон-А»", "Сергій", 2000, "inv-000002", "{}", "власник"]);
assert.equal(ctx.readInvoices_("ORD-031126-001").length, 3);
assert.throws(() => ctx.adminInvoiceCreate_(Object.assign({}, base, { request_id: "inv-000003", order_number: "ORD-999999-999" })), /не знайдено/);
assert.throws(() => ctx.adminInvoiceCreate_(Object.assign({}, base, { request_id: "inv-000004", seller: "xxx" })), /отримувач/);
assert.throws(() => ctx.adminInvoiceCreate_(Object.assign({}, base, { request_id: "inv-000005", amount: 0 })), /суму/);
// Виправити найменування вже виставленого рахунку: номер і суми ті самі.
const upd = ctx.adminInvoiceUpdateLines_({ order_number: "ORD-031126-001", number: "СФ-0001",
  names: ["Кошик-екран під утеплювач AVL-02, розбірний", "Доплата за колір RAL 9016"] });
assert.equal(upd.invoice.number, "СФ-0001");
assert.equal(upd.invoice.amount, 4229);
assert.equal(upd.invoice.data.lines[0].name, "Кошик-екран під утеплювач AVL-02, розбірний");
assert.equal(upd.invoice.data.lines[0].sum, 4029, "суми не змінюються");
assert.throws(() => ctx.adminInvoiceUpdateLines_({ order_number: "ORD-031126-001", number: "СФ-0001", names: ["лише одна"] }), /змінився/);
assert.throws(() => ctx.adminInvoiceUpdateLines_({ order_number: "ORD-031126-001", number: "СФ-0001", names: ["x", " "] }), /порожнє/);
assert.throws(() => ctx.adminInvoiceUpdateLines_({ order_number: "ORD-031126-001", number: "СФ-0999", names: ["x", "y"] }), /не знайдено/);
// Документ із журналу — той самий, що створювали.
const html = inv.buildInvoiceHtml({ number: a2.invoice.number, date: "06.11.2026", seller: "tov", order_number: "ORD-031126-001",
  buyer: a2.invoice.data.buyer, lines: a2.invoice.data.lines, order_total: a2.invoice.data.order_total, paid_before: 0, amount: a2.invoice.amount });
assert.ok(/СФ-0002/.test(html) && /2\u00a0000\u00a0₴/.test(html));

// ── 6. Сервер кабінету ──
(async () => {
  process.env.ADMIN_PASSWORD = "owner-password";
  process.env.ADMIN_SESSION_SECRET = "session-secret-for-tests";
  process.env.MANAGER_PASSWORD = "manager-password";
  const sheetsPath = require.resolve("../lib/admin-sheets");
  const real = require(sheetsPath);
  const calls = [];
  require.cache[sheetsPath].exports = { sendError: real.sendError, TIMING: real.TIMING,
    callAdminSheets: async (action, payload) => { calls.push({ action, payload }); return { status: "ok", invoice: { number: "СФ-0001" }, invoices: [] }; } };
  delete require.cache[require.resolve("../lib/admin-invoice-handler")];
  delete require.cache[require.resolve("../api/admin/order")];
  const handler = require("../api/admin/order");
  const { issueToken } = require("../lib/admin-auth");
  async function call(body, auth) {
    const res = { statusCode: 200, body: null, setHeader() {}, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; }, end() { return this; } };
    await handler({ method: "POST", query: { resource: "invoice" }, body, headers: auth ? { authorization: auth } : {} }, res);
    return res;
  }
  const manager = "Bearer " + issueToken(true, "manager");
  const ok = { order_number: "ORD-031126-001", request_id: "inv-100001", seller: "tov", amount: 4229.4,
    buyer: { kind: "company", name: "  ТОВ  «Клієнт» ", iban: "ua53 3052 9900 0002 6005 0360 0373 4", evil: "x" },
    lines: [{ name: "Кошик", qty: 1, sum: 4229 }], order_total: 4229 };
  assert.equal((await call(ok)).statusCode, 401, "без входу — ні");
  const r = await call(ok, manager);
  assert.equal(r.statusCode, 200, "менеджер теж виставляє рахунки");
  const sent = calls.pop();
  assert.equal(sent.action, "invoice_create");
  assert.equal(sent.payload.amount, 4229);
  assert.equal(sent.payload.buyer.name, "ТОВ «Клієнт»");
  assert.equal(sent.payload.buyer.iban, "UA533052990000026005036003734");
  assert.ok(!("evil" in sent.payload.buyer));
  assert.equal((await call(Object.assign({}, ok, { seller: "інше" }), manager)).statusCode, 400);
  assert.equal((await call(Object.assign({}, ok, { amount: 0 }), manager)).statusCode, 400);
  assert.equal((await call(Object.assign({}, ok, { buyer: { name: " " } }), manager)).statusCode, 400);
  assert.equal((await call(Object.assign({}, ok, { lines: [] }), manager)).statusCode, 400);
  assert.equal((await call(Object.assign({}, ok, { order_number: "x<y" }), manager)).statusCode, 400);
  // Правка найменувань — через сервер, порожні не пропускає.
  const up = await call({ action: "update_lines", order_number: "ORD-031126-001", number: "СФ-0001", names: [" Нова  назва ", "Друга"] }, manager);
  assert.equal(up.statusCode, 200);
  assert.deepEqual(calls.pop(), { action: "invoice_update_lines", payload: { order_number: "ORD-031126-001", number: "СФ-0001", names: ["Нова назва", "Друга"] } });
  assert.equal((await call({ action: "update_lines", order_number: "ORD-031126-001", number: "СФ-0001", names: ["x", ""] }, manager)).statusCode, 400);
  assert.equal((await call({ action: "update_lines", order_number: "ORD-031126-001", number: "1; DROP", names: ["x"] }, manager)).statusCode, 400);
  // Журнал рахунків для картки з кешу.
  const g = { statusCode: 200, body: null, setHeader() {}, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; }, end() { return this; } };
  await handler({ method: "GET", query: { resource: "invoice", order_number: "ORD-031126-001" }, headers: { authorization: manager } }, g);
  assert.equal(g.statusCode, 200);
  assert.deepEqual(calls.pop(), { action: "invoice_list", payload: { order_number: "ORD-031126-001" } });
  console.log("invoice tests: OK");
})().catch((e) => { console.error(e); process.exit(1); });
