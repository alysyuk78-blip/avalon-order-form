// Рахунок як справжній PDF-файл: відкривається, одна сторінка для звичайного рахунку, довгий — переходить на наступну.
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { PDFDocument, rgb } = require("pdf-lib");
const fontkit = require("@pdf-lib/fontkit");
const inv = require("../lib/avalon-invoice.js");

const root = path.join(__dirname, "..");
const bytes = (p) => new Uint8Array(fs.readFileSync(path.join(root, p)));
// Печатка — та сама картинка, що в калькуляторі; для тесту годиться логотип (будь-який PNG).
const deps = { PDFDocument, rgb, fontkit,
  fonts: { regular: bytes("public/admin/fonts/Arimo-Regular.ttf"), bold: bytes("public/admin/fonts/Arimo-Bold.ttf") },
  images: { logo: bytes("public/admin/img/avalon-logo.png"), stamp: bytes("public/admin/img/avalon-logo.png") } };
const lines = [{ name: "Кошик для кондиціонера AVL-02, 600×800×100 мм (В×Ш×Г), Білий RAL (9016), візерунок К1 — «Їжак» ґ є ʼ", qty: 47, unit: "шт.", sum: 144525 }];
const base = { number: "СФ-0001", date: "06.11.2026", seller: "fop", order_number: "ORD-261026-010",
  buyer: { kind: "person", name: "Бакатюк В.В.", phone: "+380680265430" }, lines, order_total: 144525, amount: 144525 };

(async () => {
  const fop = await inv.buildInvoicePdf(base, deps);
  assert.equal(Buffer.from(fop.slice(0, 5)).toString(), "%PDF-");
  const fopDoc = await PDFDocument.load(fop);
  assert.equal(fopDoc.getPageCount(), 1);
  assert.equal(fopDoc.getTitle(), "Рахунок СФ-0001 — ORD-261026-010");

  const tov = await inv.buildInvoicePdf(Object.assign({}, base, { seller: "tov", paid_before: 44525, amount: 100000 }), deps);
  assert.ok(tov.length > fop.length, "у рахунку ТОВ є печатка (ще одна картинка)");
  const noImg = await inv.buildInvoicePdf(base, Object.assign({}, deps, { images: {} }));
  assert.ok(noImg.length < fop.length, "без логотипа — напис замість картинки");

  const many = Array.from({ length: 40 }, (_, i) => ({ name: "Позиція " + (i + 1) + " з довгою назвою, щоб переносилась на кілька рядків у колонці «Найменування»", qty: 1, unit: "шт.", sum: 1000 }));
  const long = await inv.buildInvoicePdf(Object.assign({}, base, { lines: many, order_total: 40000, amount: 40000 }), deps);
  assert.ok((await PDFDocument.load(long)).getPageCount() >= 2, "довгий рахунок — на кількох сторінках");
  // Рядки без кількості, знижка з мінусом і примітки (рахунок з калькулятора) не ламають PDF.
  const calc = await inv.buildInvoicePdf(Object.assign({}, base, { order_number: "", notes: ["Доставка: за тарифом перевізника (не включено в суму)."],
    lines: lines.concat([{ name: "Знижка 5 %", qty: null, sum: -500 }]), order_total: 144025, amount: 144025 }), deps);
  assert.equal((await PDFDocument.load(calc)).getPageCount(), 1);
  // Символи поза шрифтом (емодзі) не ламають рахунок — стають «?»; польські/чеські літери є в шрифті.
  const odd = await inv.buildInvoicePdf(Object.assign({}, base, { buyer: { kind: "person", name: "Łukasz Šťastný 😀 ТОВ «Ёлка»" } }), deps);
  assert.equal((await PDFDocument.load(odd)).getPageCount(), 1);
  // Рахунок ТОВ на 4 довгі позиції — підпис із печаткою лишається на першій сторінці (місце — під коло 40 мм).
  const five = Array.from({ length: 4 }, (_, i) => ({ name: lines[0].name + " — варіант " + (i + 1), qty: 2, unit: "шт.", sum: 6150 }));
  const tov5 = await inv.buildInvoicePdf(Object.assign({}, base, { seller: "tov", lines: five, order_total: 24600, amount: 24600 }), deps);
  assert.equal((await PDFDocument.load(tov5)).getPageCount(), 1, "підпис з печаткою не переїжджає сам на другу сторінку");
  console.log("invoice pdf tests: OK");
})().catch((e) => { console.error(e); process.exit(1); });
