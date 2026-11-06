// Рахунок на оплату (06.11.2026): реквізити отримувачів, сума прописом і сам документ (HTML → друк у PDF / Word).
// Ядро між маркерами AVALON-INVOICE-CORE дослівно те саме, що в калькуляторі (src/lib/avalonInvoice.mjs) —
// тести обох репозиторіїв звіряють його хеш (INVOICE_CORE_SHA256). Міняєте реквізити — міняйте в обох.

// AVALON-INVOICE-CORE-START
// Реквізити — з документа власника 06.11.2026; IBAN і коди перевірені контрольними цифрами.
const AVALON_INVOICE_SELLERS = {
  fop: {
    id: "fop",
    label: "ФОП Арцаблюк В. В. (без ПДВ)",
    name: "Фізична особа-підприємець Арцаблюк Валерій Вікторович",
    codeLabel: "РНОКПП",
    code: "2784904055",
    iban: "UA893052990000026007016013258",
    bank: "АТ КБ «ПРИВАТБАНК»",
    vat: false,
  },
  tov: {
    id: "tov",
    label: "ТОВ «Валон-А» (з ПДВ)",
    name: "Товариство з обмеженою відповідальністю «Валон-А»",
    codeLabel: "Код ЄДРПОУ",
    code: "14152239",
    ipn: "141522322252",
    iban: "UA533052990000026005036003734",
    bank: "КБ «ПРИВАТБАНК», м. Дніпро",
    address: "29006, Хмельницька обл., м. Хмельницький, вул. Дудченка Володимира Героя України, 9",
    vat: true,
  },
};

// Сума прописом українською: «чотири тисячі триста гривень 00 копійок». Гривня й тисяча — жіночого роду.
function avalonAmountInWords(amount) {
  const value = Math.round((Number(amount) || 0) * 100);
  const hryvni = Math.floor(value / 100);
  const kop = value % 100;
  const unitsM = ["", "один", "два", "три", "чотири", "п'ять", "шість", "сім", "вісім", "дев'ять"];
  const unitsF = ["", "одна", "дві", "три", "чотири", "п'ять", "шість", "сім", "вісім", "дев'ять"];
  const teens = ["десять", "одинадцять", "дванадцять", "тринадцять", "чотирнадцять", "п'ятнадцять", "шістнадцять",
    "сімнадцять", "вісімнадцять", "дев'ятнадцять"];
  const tens = ["", "", "двадцять", "тридцять", "сорок", "п'ятдесят", "шістдесят", "сімдесят", "вісімдесят", "дев'яносто"];
  const hundreds = ["", "сто", "двісті", "триста", "чотириста", "п'ятсот", "шістсот", "сімсот", "вісімсот", "дев'ятсот"];
  function triad(n, fem) {
    const out = [];
    if (Math.floor(n / 100)) out.push(hundreds[Math.floor(n / 100)]);
    const rest = n % 100;
    if (rest >= 10 && rest < 20) out.push(teens[rest - 10]);
    else {
      if (Math.floor(rest / 10)) out.push(tens[Math.floor(rest / 10)]);
      if (rest % 10) out.push((fem ? unitsF : unitsM)[rest % 10]);
    }
    return out.join(" ");
  }
  function plural(n, one, few, many) {
    const t = n % 100, u = n % 10;
    if (t >= 11 && t <= 14) return many;
    if (u === 1) return one;
    if (u >= 2 && u <= 4) return few;
    return many;
  }
  const parts = [];
  const millions = Math.floor(hryvni / 1000000);
  const thousands = Math.floor(hryvni / 1000) % 1000;
  const rest = hryvni % 1000;
  if (millions) parts.push(triad(millions, false), plural(millions, "мільйон", "мільйони", "мільйонів"));
  if (thousands) parts.push(triad(thousands, true), plural(thousands, "тисяча", "тисячі", "тисяч"));
  if (rest || !parts.length) parts.push(rest ? triad(rest, true) : "нуль");
  const words = parts.join(" ").replace(/\s+/g, " ").trim();
  const text = words + " " + plural(hryvni, "гривня", "гривні", "гривень") + " "
    + String(kop).padStart(2, "0") + " " + plural(kop, "копійка", "копійки", "копійок");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// ПДВ 20 % «у т. ч.» = сума / 6 (до копійок).
function avalonVatOf(total) {
  return Math.round((Number(total) || 0) / 6 * 100) / 100;
}
// AVALON-INVOICE-CORE-END

function esc(v) {
  return String(v == null ? "" : v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
// Пробіли в сумах — нерозривні: «24 087,50 ₴» не розривається на два рядки.
const NB = "\u00a0";
function uah(n) {
  return Math.round(Number(n) || 0).toString().replace(/\B(?=(\d{3})+(?!\d))/g, NB) + NB + "₴";
}
function uah2(n) {
  const [i, f] = (Math.round((Number(n) || 0) * 100) / 100).toFixed(2).split(".");
  return i.replace(/\B(?=(\d{3})+(?!\d))/g, NB) + "," + f + NB + "₴";
}

/**
 * Дані рахунку для друку — один раз для PDF (HTML) і Word (DOCX), щоб числа й тексти в обох були однакові.
 * inv: { number, date (дд.мм.рррр), seller: "fop"|"tov", order_number,
 *   buyer: { kind: "person"|"fop"|"company", name, code, ipn, iban, bank, address, phone, email },
 *   lines: [{ name, qty, unit, sum }], order_total, paid_before, amount, stamp_url }
 * Сума рахунку — amount: усе замовлення, залишок чи передоплата; позиції показуються завжди.
 */
function invoiceModel(inv) {
  const s = AVALON_INVOICE_SELLERS[inv.seller] || AVALON_INVOICE_SELLERS.fop;
  const b = inv.buyer || {};
  const lines = inv.lines || [];
  const amount = Math.round(Number(inv.amount) || 0);
  const orderTotal = Math.round(Number(inv.order_total) || lines.reduce((sum, l) => sum + (Number(l.sum) || 0), 0));
  const paidBefore = Math.round(Number(inv.paid_before) || 0);
  const rest = orderTotal - paidBefore;
  const vat = s.vat ? avalonVatOf(amount) : 0;
  const sellerRows = [s.codeLabel + ": " + s.code, s.ipn ? "ІПН: " + s.ipn : "", "IBAN: " + s.iban, "Банк: " + s.bank,
    s.address ? "Адреса: " + s.address : ""].filter(Boolean);
  const buyerRows = [
    b.code ? (b.kind === "company" ? "Код ЄДРПОУ: " : "РНОКПП / код: ") + b.code : "",
    b.ipn ? "ІПН: " + b.ipn : "",
    b.iban ? "IBAN: " + b.iban : "",
    b.bank ? "Банк: " + b.bank : "",
    b.address ? "Адреса: " + b.address : "",
    b.phone ? "Телефон: " + b.phone : "",
    b.email ? "E-mail: " + b.email : "",
  ].filter(Boolean);
  const items = lines.map((l, i) => {
    const qty = Number(l.qty) || 1;
    const sum = Math.round(Number(l.sum) || 0);
    const price = sum / qty;
    // Ціна з копійками, коли сума не ділиться на кількість націло (3 шт. на 1 000 ₴ → 333,33 ₴).
    const priceText = Math.abs(price - Math.round(price)) < 0.005 ? uah(price) : uah2(price);
    return { n: String(i + 1), name: String(l.name || ""), qty: String(qty).replace(".", ",") + " " + (l.unit || "шт."), price: priceText, sum: uah(sum) };
  });
  const totals = [{ label: "Разом за замовленням" + (s.vat ? " (з ПДВ)" : "") + ":", value: uah(orderTotal) }];
  // «Сплачено раніше» — завжди, коли клієнт уже платив (інакше рахунок на всю суму виглядав би як повна оплата).
  if (paidBefore >= 1) totals.push({ label: "Сплачено раніше:", value: uah(paidBefore) });
  if (paidBefore >= 1 || Math.abs(amount - orderTotal) >= 1) {
    const note = amount < rest - 0.5 ? " (часткова оплата / передоплата)" : amount > rest + 0.5 ? " (більше за залишок)" : "";
    totals.push({ label: "До оплати за цим рахунком" + note + ":", value: uah(amount), due: true });
  } else {
    totals.push({ label: "Всього до оплати:", value: uah(amount), due: true });
  }
  if (s.vat) {
    totals.push({ label: "у т. ч. ПДВ 20 %:", value: uah2(vat) });
    totals.push({ label: "Сума без ПДВ:", value: uah2(amount - vat) });
  } else {
    totals.push({ label: "", value: "Без ПДВ", muted: true });
  }
  const vatText = s.vat ? ", у т. ч. ПДВ " + uah2(vat) : ", без ПДВ";
  return {
    seller: s, buyer: b, sellerRows, buyerRows, items, totals,
    title: "РАХУНОК НА ОПЛАТУ № " + inv.number,
    subtitle: "від " + inv.date + (inv.order_number ? " · замовлення " + inv.order_number : ""),
    words: avalonAmountInWords(amount), vatText,
    purpose: "Призначення платежу: оплата за рахунком № " + inv.number + " від " + inv.date
      + (inv.order_number ? ", замовлення " + inv.order_number : "") + vatText + ".",
    validity: "Рахунок дійсний до оплати протягом 3 днів з дати виставлення.",
    stamp: s.vat && inv.stamp_url ? inv.stamp_url : "",
    docTitle: "Рахунок " + inv.number + " — " + (inv.order_number || ""),
  };
}

/** Документ рахунку (HTML, A4) — для друку в PDF. */
function buildInvoiceHtml(inv) {
  const m = invoiceModel(inv);
  const s = m.seller;
  const rows = m.items.map(it => `<tr><td class="c">${esc(it.n)}</td><td>${esc(it.name)}</td><td class="r">${esc(it.qty)}</td>`
    + `<td class="r">${esc(it.price)}</td><td class="r">${esc(it.sum)}</td></tr>`).join("");
  const totals = m.totals.map(t => t.muted
    ? `<tr><td colspan="2" class="r muted">${esc(t.value)}</td></tr>`
    : `<tr${t.due ? ' class="due"' : ""}><td>${esc(t.label)}</td><td class="r">${esc(t.value)}</td></tr>`).join("");
  return `<!DOCTYPE html>
<html lang="uk"><head><meta charset="utf-8"><title>${esc(m.docTitle)}</title>
<style>
  @page { size: A4; margin: 14mm; }
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 12.5px; color: #1f2326; margin: 0; }
  .wrap { max-width: 760px; margin: 0 auto; padding: 8px; }
  h1 { font-size: 20px; margin: 0 0 2px; }
  .muted { color: #66716b; }
  table.head, table.parties, table.sign { width: 100%; border-collapse: collapse; }
  table.head { border-bottom: 2px solid #383e42; margin-bottom: 14px; } table.head td { padding: 0 0 8px; vertical-align: bottom; }
  table.parties { margin-bottom: 14px; } table.parties td { width: 50%; vertical-align: top; padding: 0 7px 0 0; }
  table.parties td + td { padding: 0 0 0 7px; }
  .party { border: 1px solid #dfe3e0; padding: 10px 12px; line-height: 1.55; }
  .party .t { font-size: 11px; text-transform: uppercase; color: #66716b; margin-bottom: 4px; letter-spacing: .03em; }
  table.items { width: 100%; border-collapse: collapse; margin-bottom: 12px; }
  table.items th { background: #383e42; color: #fff; font-weight: 600; padding: 7px 8px; text-align: left; font-size: 12px; }
  table.items td { border-bottom: 1px solid #e5e7eb; padding: 7px 8px; vertical-align: top; }
  .r { text-align: right; white-space: nowrap; } .c { text-align: center; }
  table.tot { margin-left: auto; border-collapse: collapse; min-width: 340px; }
  table.tot td { padding: 4px 8px; } table.tot tr.due td { font-weight: 700; font-size: 14px; border-top: 2px solid #383e42; }
  .words { margin: 12px 0; padding: 10px 12px; background: #f4f6f5; border-left: 3px solid #383e42; }
  table.sign { margin-top: 30px; } table.sign td { vertical-align: bottom; }
  .stamp { width: 170px; height: 170px; object-fit: contain; margin-top: -60px; }
</style></head>
<body><div class="wrap">
  <table class="head"><tr>
    <td><h1>${esc(m.title)}</h1><div class="muted">${esc(m.subtitle)}</div></td>
    <td class="r"><b>AVALON METAL DESIGN</b><div class="muted">кошики для кондиціонерів</div></td>
  </tr></table>
  <table class="parties"><tr>
    <td><div class="party"><div class="t">Постачальник</div><b>${esc(s.name)}</b>
      ${m.sellerRows.map(r => `<div>${esc(r)}</div>`).join("")}
      <div class="muted">${s.vat ? "Платник ПДВ" : "Неплатник ПДВ"}</div></div></td>
    <td><div class="party"><div class="t">Покупець</div><b>${esc(m.buyer.name || "—")}</b>${m.buyerRows.map(r => `<div>${esc(r)}</div>`).join("")}</div></td>
  </tr></table>
  <table class="items">
    <tr><th class="c" style="width:28px">№</th><th>Найменування</th><th class="r">Кількість</th><th class="r">Ціна${s.vat ? " з ПДВ" : ""}</th><th class="r">Сума${s.vat ? " з ПДВ" : ""}</th></tr>
    ${rows}
  </table>
  <table class="tot">${totals}</table>
  <div class="words">Всього до оплати: <b>${esc(m.words)}</b>${esc(m.vatText)}.</div>
  <div class="muted">${esc(m.purpose)}</div>
  <div class="muted" style="margin-top:6px">${esc(m.validity)}</div>
  <table class="sign"><tr><td>Виписав(ла): ______________________</td><td class="r">${m.stamp ? `<img class="stamp" src="${esc(m.stamp)}" alt="">` : ""}</td></tr></table>
</div></body></html>`;
}

// ── Word (.docx): справжній документ Office Open XML — відкривають Word (і без підписки — для перегляду),
//    Pages, Google Документи, LibreOffice. ZIP без стиснення, без сторонніх бібліотек. ──
function xmlEsc(v) {
  return String(v == null ? "" : v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function invoiceDocxXml(inv) {
  const m = invoiceModel(inv);
  const s = m.seller;
  const run = (text, o) => {
    o = o || {};
    const pr = [o.b ? "<w:b/>" : "", o.color ? `<w:color w:val="${o.color}"/>` : "", `<w:sz w:val="${o.sz || 20}"/>`].join("");
    return `<w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/>${pr}</w:rPr><w:t xml:space="preserve">${xmlEsc(text)}</w:t></w:r>`;
  };
  const para = (runs, o) => {
    o = o || {};
    return `<w:p><w:pPr><w:spacing w:before="0" w:after="${o.after == null ? 60 : o.after}"/>${o.jc ? `<w:jc w:val="${o.jc}"/>` : ""}</w:pPr>${runs}</w:p>`;
  };
  const cell = (content, o) => {
    o = o || {};
    return `<w:tc><w:tcPr><w:tcW w:w="${o.w || 0}" w:type="dxa"/>${o.fill ? `<w:shd w:val="clear" w:color="auto" w:fill="${o.fill}"/>` : ""}`
      + `${o.span ? `<w:gridSpan w:val="${o.span}"/>` : ""}</w:tcPr>${content}</w:tc>`;
  };
  const borders = (sz) => `<w:tblBorders>${["top", "left", "bottom", "right", "insideH", "insideV"].map(k => `<w:${k} w:val="${sz ? "single" : "nil"}" w:sz="${sz || 0}" w:color="BFC5C1"/>`).join("")}</w:tblBorders>`;
  const table = (rows, widths, sz) => `<w:tbl><w:tblPr><w:tblW w:w="${widths.reduce((a, b) => a + b, 0)}" w:type="dxa"/>${borders(sz)}<w:tblLayout w:type="fixed"/>`
    + `<w:tblCellMar><w:left w:w="80" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tblCellMar></w:tblPr>`
    + `<w:tblGrid>${widths.map(w => `<w:gridCol w:w="${w}"/>`).join("")}</w:tblGrid>${rows.join("")}</w:tbl>`;
  const tr = (cells) => `<w:tr>${cells.join("")}</w:tr>`;
  const W = 9600;
  const body = [];
  body.push(table([tr([
    cell(para(run(m.title, { b: true, sz: 30 }), { after: 20 }) + para(run(m.subtitle, { color: "66716B" })), { w: 6400 }),
    cell(para(run("AVALON METAL DESIGN", { b: true }), { jc: "right", after: 20 }) + para(run("кошики для кондиціонерів", { color: "66716B" }), { jc: "right" }), { w: 3200 }),
  ])], [6400, 3200], 0));
  body.push(para("", { after: 120 }));
  const party = (t, name, rows, extra) => para(run(t, { color: "66716B", sz: 16 }), { after: 40 }) + para(run(name, { b: true }))
    + rows.map(r => para(run(r))).join("") + (extra ? para(run(extra, { color: "66716B" })) : "");
  body.push(table([tr([
    cell(party("ПОСТАЧАЛЬНИК", s.name, m.sellerRows, s.vat ? "Платник ПДВ" : "Неплатник ПДВ"), { w: W / 2 }),
    cell(party("ПОКУПЕЦЬ", m.buyer.name || "—", m.buyerRows), { w: W / 2 }),
  ])], [W / 2, W / 2], 4));
  body.push(para("", { after: 120 }));
  const iw = [500, 5000, 1300, 1400, 1400];
  const head = ["№", "Найменування", "Кількість", "Ціна" + (s.vat ? " з ПДВ" : ""), "Сума" + (s.vat ? " з ПДВ" : "")];
  const itemRows = [tr(head.map((h, i) => cell(para(run(h, { b: true, color: "FFFFFF" }), { jc: i >= 2 ? "right" : "left" }), { w: iw[i], fill: "383E42" })))]
    .concat(m.items.map(it => tr([it.n, it.name, it.qty, it.price, it.sum].map((v, i) => cell(para(run(v), { jc: i >= 2 ? "right" : "left" }), { w: iw[i] })))));
  body.push(table(itemRows, iw, 4));
  body.push(para("", { after: 80 }));
  body.push(table(m.totals.map(t => tr(t.muted
    ? [cell(para(run(t.value, { color: "66716B" }), { jc: "right" }), { w: 5600, span: 2 })]
    : [cell(para(run(t.label, { b: !!t.due })), { w: 3800 }), cell(para(run(t.value, { b: !!t.due }), { jc: "right" }), { w: 1800 })])), [3800, 1800], 0)
    .replace("<w:tblPr>", '<w:tblPr><w:jc w:val="right"/>'));
  body.push(para("", { after: 80 }));
  body.push(para(run("Всього до оплати: ") + run(m.words, { b: true }) + run(m.vatText + ".")));
  body.push(para(run(m.purpose, { color: "66716B" })));
  body.push(para(run(m.validity, { color: "66716B" }), { after: 360 }));
  body.push(para(run("Виписав(ла): ______________________")));
  const sect = '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="900" w:right="1000" w:bottom="900" w:left="1000" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr>';
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' + body.join("") + sect + "</w:body></w:document>";
}
const CRC_TABLE = (() => { const t = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(bytes) { let c = 0xFFFFFFFF; for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
/** ZIP (без стиснення) з файлів { шлях: текст }. */
function zipStore(files) {
  const enc = new TextEncoder();
  const chunks = [], central = [];
  let offset = 0;
  Object.keys(files).forEach((name) => {
    const nameB = enc.encode(name), data = enc.encode(files[name]), crc = crc32(data);
    const local = new Uint8Array(30 + nameB.length), dv = new DataView(local.buffer);
    dv.setUint32(0, 0x04034b50, true); dv.setUint16(4, 20, true); dv.setUint16(6, 0x0800, true); dv.setUint16(8, 0, true);
    dv.setUint16(10, 0, true); dv.setUint16(12, 0x21, true); dv.setUint32(14, crc, true); dv.setUint32(18, data.length, true);
    dv.setUint32(22, data.length, true); dv.setUint16(26, nameB.length, true); dv.setUint16(28, 0, true);
    local.set(nameB, 30);
    const cen = new Uint8Array(46 + nameB.length), cv = new DataView(cen.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true); cv.setUint16(12, 0, true); cv.setUint16(14, 0x21, true); cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true); cv.setUint32(24, data.length, true); cv.setUint16(28, nameB.length, true);
    cv.setUint32(42, offset, true); cen.set(nameB, 46);
    chunks.push(local, data); central.push(cen);
    offset += local.length + data.length;
  });
  const cenSize = central.reduce((a, c) => a + c.length, 0);
  const end = new Uint8Array(22), ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, central.length, true); ev.setUint16(10, central.length, true);
  ev.setUint32(12, cenSize, true); ev.setUint32(16, offset, true);
  const all = chunks.concat(central, [end]);
  const out = new Uint8Array(all.reduce((a, c) => a + c.length, 0));
  let p = 0; all.forEach((c) => { out.set(c, p); p += c.length; });
  return out;
}
/** Рахунок як файл Word (.docx) — байти для завантаження. */
function buildInvoiceDocx(inv) {
  return zipStore({
    "[Content_Types].xml": '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
      + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'
      + '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    "_rels/.rels": '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    "word/document.xml": invoiceDocxXml(inv),
  });
}

module.exports = { AVALON_INVOICE_SELLERS, avalonAmountInWords, avalonVatOf, invoiceModel, buildInvoiceHtml, buildInvoiceDocx, invoiceDocxXml };
