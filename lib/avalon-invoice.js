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

// AVALON-INVOICE-DOC-START — вигляд рахунку (PDF і Word). Дослівно той самий блок у калькуляторі
// (avalon-calculator/src/lib/avalonInvoice.mjs), хеш INVOICE_DOC_SHA256 у тестах обох — рахунки однакові.
function esc(v) {
  return String(v == null ? "" : v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
// Пробіли в сумах — нерозривні: «24 087,50 ₴» не розривається на два рядки.
const NB = "\u00a0";
function uah(n) {
  const v = Math.round(Number(n) || 0);
  return (v < 0 ? "−" : "") + Math.abs(v).toString().replace(/\B(?=(\d{3})+(?!\d))/g, NB) + NB + "₴";
}
function uah2(n) {
  const [i, f] = (Math.round((Number(n) || 0) * 100) / 100).toFixed(2).split(".");
  return i.replace(/\B(?=(\d{3})+(?!\d))/g, NB) + "," + f + NB + "₴";
}

/**
 * Дані рахунку для друку — один раз для PDF (HTML) і Word (DOCX), щоб числа й тексти в обох були однакові.
 * inv: { number, date (дд.мм.рррр), seller: "fop"|"tov", order_number,
 *   buyer: { kind: "person"|"fop"|"company", name, code, ipn, iban, bank, address, phone, email },
 *   lines: [{ name, qty, unit, sum }], order_total, paid_before, amount, stamp_url, logo_url, notes: [текст] }
 * Рядок із qty: null — без кількості й ціни (знижка, доставка); сума може бути відʼємною (знижка).
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
    b.mfo ? "МФО: " + b.mfo : "",
    b.address ? "Адреса: " + b.address : "",
    b.phone ? "Телефон: " + b.phone : "",
    b.email ? "E-mail: " + b.email : "",
  ].filter(Boolean);
  const items = lines.map((l, i) => {
    const sum = Math.round(Number(l.sum) || 0);
    if (l.qty === null) return { n: String(i + 1), name: String(l.name || ""), qty: "", price: "", sum: uah(sum) };
    const qty = Number(l.qty) || 1;
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
    notes: (inv.notes || []).map(String).filter(Boolean),
    stamp: s.vat && inv.stamp_url ? inv.stamp_url : "",
    logo: inv.logo_url || "",
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
  table.head, table.parties { width: 100%; border-collapse: collapse; }
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
  .sign { position: relative; margin-top: 30px; }
  /* Печатка в реальному розмірі (коло 40 мм) на кінці «Виписав(ла)», лінію підпису не закриває. */
  .sign.with-stamp { margin-top: 26mm; } .sign.with-stamp .line { position: absolute; left: 60mm; }
  .stamp { position: absolute; width: 68.4mm; height: auto; left: 1.46mm; top: -28.76mm; }
  .logo { height: 48px; width: auto; display: block; margin-left: auto; }
</style></head>
<body><div class="wrap">
  <table class="head"><tr>
    <td><h1>${esc(m.title)}</h1><div class="muted">${esc(m.subtitle)}</div></td>
    <td class="r">${m.logo ? `<img class="logo" src="${esc(m.logo)}" alt="AVALON METAL DESIGN">` : `<b>AVALON METAL DESIGN</b><div class="muted">кошики для кондиціонерів</div>`}</td>
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
  ${m.notes.map(n => `<div class="muted" style="margin-bottom:6px">${esc(n)}</div>`).join("")}
  <div class="muted">${esc(m.purpose)}</div>
  <div class="muted" style="margin-top:6px">${esc(m.validity)}</div>
  <div class="sign${m.stamp ? " with-stamp" : ""}">Виписав(ла): <span class="line">______________________</span>${m.stamp ? `<img class="stamp" src="${esc(m.stamp)}" alt="">` : ""}</div>
</div></body></html>`;
}

// ── Word (.docx): справжній документ Office Open XML — відкривають Word (і без підписки — для перегляду),
//    Pages, Google Документи, LibreOffice. ZIP без стиснення, без сторонніх бібліотек. ──
function xmlEsc(v) {
  return String(v == null ? "" : v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
/** Розміри PNG (ширина, висота) із заголовка файлу. */
function pngSize(bytes) {
  if (!bytes || bytes.length < 24 || bytes[0] !== 0x89 || bytes[1] !== 0x50) return null;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { w: dv.getUint32(16), h: dv.getUint32(20) };
}
// Печатка друкується в реальному розмірі: коло 40 мм. На картинці stamp.png коло займає 58,5 % ширини
// (центр — 50,5 % по ширині, 48,6 % по висоті), тож уся картинка — 40 / 0,585 ≈ 68,4 мм.
const STAMP_MM = { circle: 40, imgW: 68.4, cx: 0.505, cy: 0.4865 };
// Відбиток — на кінці підпису «Виписав(ла)», а не на лінії підпису (Правила діловодства, наказ Мін'юсту № 1000/5, розд. II, гл. 3, п. 8).
const STAMP_AT_MM = { x: 36, y: 2.5 }; // центр кола: ліва частина відбитка захоплює останні літери «Виписав(ла):»
const SIGN_LINE_MM = 60; // у рахунку з печаткою лінія підпису починається правіше відбитка

function invoiceDocxXml(inv, images) {
  images = images || {};
  const m = invoiceModel(inv);
  const s = m.seller;
  const DARK = "383E42", MUTED = "66716B", LINE = "DFE3E0", ROWLINE = "E5E7EB", SOFT = "F4F6F5";
  const MM = 36000; // EMU в 1 мм
  const TW = 56.7;  // twips в 1 мм
  const run = (text, o) => {
    o = o || {};
    // Порядок у rPr за схемою: rFonts, b, caps, color, spacing, sz.
    const pr = [o.b ? "<w:b/>" : "", o.caps ? "<w:caps/>" : "", o.color ? `<w:color w:val="${o.color}"/>` : "",
      o.spacing ? `<w:spacing w:val="${o.spacing}"/>` : "", `<w:sz w:val="${o.sz || 21}"/><w:szCs w:val="${o.sz || 21}"/>`].join("");
    return `<w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/>${pr}</w:rPr><w:t xml:space="preserve">${xmlEsc(text)}</w:t></w:r>`;
  };
  const para = (runs, o) => {
    o = o || {};
    // Порядок у pPr: pBdr, shd, tabs, spacing, ind, jc.
    return `<w:p><w:pPr>${o.bar ? `<w:pBdr><w:left w:val="single" w:sz="24" w:space="8" w:color="${DARK}"/></w:pBdr><w:shd w:val="clear" w:color="auto" w:fill="${SOFT}"/>` : ""}`
      + `${o.tab ? `<w:tabs><w:tab w:val="left" w:pos="${o.tab}"/></w:tabs>` : ""}`
      + `<w:spacing w:before="${o.before || 0}" w:after="${o.after == null ? 60 : o.after}" w:line="${o.line || 264}" w:lineRule="auto"/>`
      + `${o.ind ? `<w:ind w:left="${o.ind}" w:right="${o.ind}"/>` : ""}${o.jc ? `<w:jc w:val="${o.jc}"/>` : ""}</w:pPr>${runs}</w:p>`;
  };
  const edge = (side, b) => b ? `<w:${side} w:val="single" w:sz="${b.sz}" w:space="0" w:color="${b.color}"/>` : "";
  const cell = (content, o) => {
    o = o || {};
    // Порядок у tcPr: tcW, gridSpan, tcBorders, shd, tcMar, vAlign.
    const borders = o.top || o.bottom ? `<w:tcBorders>${edge("top", o.top)}${edge("bottom", o.bottom)}</w:tcBorders>` : "";
    const pad = o.pad || [60, 0, 60, 0]; // зверху, праворуч, знизу, ліворуч
    return `<w:tc><w:tcPr><w:tcW w:w="${o.w || 0}" w:type="dxa"/>${o.span ? `<w:gridSpan w:val="${o.span}"/>` : ""}${borders}`
      + `${o.fill ? `<w:shd w:val="clear" w:color="auto" w:fill="${o.fill}"/>` : ""}`
      + `<w:tcMar><w:top w:w="${pad[0]}" w:type="dxa"/><w:left w:w="${pad[3]}" w:type="dxa"/><w:bottom w:w="${pad[2]}" w:type="dxa"/><w:right w:w="${pad[1]}" w:type="dxa"/></w:tcMar>`
      + `${o.valign ? `<w:vAlign w:val="${o.valign}"/>` : ""}</w:tcPr>${content}</w:tc>`;
  };
  // Таблиці без власних рамок — лінії лише там, де вони були в попередньому вигляді (рамки клітинок).
  // Порядок у tblPr: tblW, jc, tblBorders, tblLayout, tblCellMar.
  const NIL = `<w:tblBorders>${["top", "left", "bottom", "right", "insideH", "insideV"].map(k => `<w:${k} w:val="nil"/>`).join("")}</w:tblBorders>`;
  const table = (rows, widths, jc) => `<w:tbl><w:tblPr><w:tblW w:w="${widths.reduce((a, b) => a + b, 0)}" w:type="dxa"/>`
    + `${jc ? `<w:jc w:val="${jc}"/>` : ""}${NIL}<w:tblLayout w:type="fixed"/>`
    + `<w:tblCellMar><w:left w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tblCellMar></w:tblPr>`
    + `<w:tblGrid>${widths.map(w => `<w:gridCol w:w="${w}"/>`).join("")}</w:tblGrid>${rows.join("")}</w:tbl>`;
  const tr = (cells) => `<w:tr><w:trPr><w:cantSplit/></w:trPr>${cells.join("")}</w:tr>`;
  const W = 9638; // ширина тексту: A4 210 мм − поля по 20 мм

  let picId = 0;
  const graphic = (rid, cx, cy) => `<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">`
    + `<pic:pic><pic:nvPicPr><pic:cNvPr id="${picId}" name="${rid}.png"/><pic:cNvPicPr/></pic:nvPicPr>`
    + `<pic:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>`
    + `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>`
    + `</pic:pic></a:graphicData></a:graphic>`;
  const sizeOf = (bytes, widthMm) => {
    const sz = pngSize(bytes) || { w: 1, h: 1 };
    const cx = Math.round(widthMm * MM);
    return { cx, cy: Math.round(cx * sz.h / sz.w) };
  };
  // Картинка в рядку тексту (логотип).
  const inlinePic = (rid, bytes, widthMm) => {
    const { cx, cy } = sizeOf(bytes, widthMm);
    picId += 1;
    return `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/>`
      + `<wp:docPr id="${picId}" name="Picture ${picId}"/>${graphic(rid, cx, cy)}</wp:inline></w:drawing></w:r>`;
  };
  // Картинка поверх тексту з точним місцем (печатка); x, y — зсув лівого верхнього кута від початку абзацу, мм.
  const floatPic = (rid, bytes, widthMm, xMm, yMm) => {
    const { cx, cy } = sizeOf(bytes, widthMm);
    picId += 1;
    return `<w:r><w:drawing><wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="${251659264 + picId}" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1">`
      + `<wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="column"><wp:posOffset>${Math.round(xMm * MM)}</wp:posOffset></wp:positionH>`
      + `<wp:positionV relativeFrom="paragraph"><wp:posOffset>${Math.round(yMm * MM)}</wp:posOffset></wp:positionV>`
      + `<wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapNone/>`
      + `<wp:docPr id="${picId}" name="Stamp ${picId}"/><wp:cNvGraphicFramePr/>${graphic(rid, cx, cy)}</wp:anchor></w:drawing></w:r>`;
  };

  const body = [];
  // Шапка: назва ліворуч, логотип праворуч, під ними темна лінія.
  const headLine = { sz: 18, color: DARK };
  const brand = images.logo
    ? para(inlinePic("rIdLogo", images.logo, 12.7), { jc: "right", after: 0 })
    : para(run("AVALON METAL DESIGN", { b: true, sz: 22 }), { jc: "right", after: 0 }) + para(run("кошики для кондиціонерів", { color: MUTED }), { jc: "right", after: 0 });
  body.push(table([tr([
    cell(para(run(m.title, { b: true, sz: 34 }), { after: 20 }) + para(run(m.subtitle, { color: MUTED }), { after: 0 }), { w: 6638, bottom: headLine, valign: "bottom", pad: [0, 0, 120, 0] }),
    cell(brand, { w: 3000, bottom: headLine, valign: "bottom", pad: [0, 0, 120, 0] }),
  ])], [6638, 3000]));
  body.push(para("", { after: 120 }));
  // Сторони: підпис дрібними літерами, назва жирним, реквізити; під кожною — тонка лінія.
  const party = (t, name, rows, extra) => para(run(t, { caps: true, color: MUTED, sz: 17, spacing: 10 }), { after: 120 })
    + para(run(name, { b: true }), { after: 120 }) + rows.map(r => para(run(r), { after: 120 })).join("")
    + (extra ? para(run(extra, { color: MUTED }), { after: 120 }) : "");
  const partyLine = { sz: 6, color: LINE };
  body.push(table([tr([
    cell(party("Постачальник", s.name, m.sellerRows, s.vat ? "Платник ПДВ" : "Неплатник ПДВ"), { w: 4600, bottom: partyLine, pad: [80, 0, 80, 0] }),
    cell(para(""), { w: 438 }),
    cell(party("Покупець", m.buyer.name || "—", m.buyerRows), { w: 4600, bottom: partyLine, pad: [80, 0, 80, 0] }),
  ])], [4600, 438, 4600]));
  body.push(para("", { after: 160 }));
  // Позиції: темна шапка з білим текстом, під кожним рядком — світла лінія.
  const iw = [520, 4918, 1200, 1500, 1500];
  const head = ["№", "Найменування", "Кількість", "Ціна" + (s.vat ? " з ПДВ" : ""), "Сума" + (s.vat ? " з ПДВ" : "")];
  const ipad = [140, 120, 140, 120];
  const itemRows = [tr(head.map((h, i) => cell(para(run(h, { b: true, color: "FFFFFF", sz: 20 }), { jc: i >= 2 ? "right" : "left", after: 0 }), { w: iw[i], fill: DARK, pad: ipad, valign: "center" })))]
    .concat(m.items.map(it => tr([it.n, it.name, it.qty, it.price, it.sum].map((v, i) => cell(para(run(v), { jc: i === 0 ? "center" : i >= 2 ? "right" : "left", after: 0 }), { w: iw[i], bottom: { sz: 6, color: ROWLINE }, pad: ipad })))));
  body.push(table(itemRows, iw));
  body.push(para("", { after: 80 }));
  // Підсумки: рядок «до оплати» жирним над темною лінією, «Без ПДВ» — сірим під сумою.
  const tw = [3900, 1900];
  const tpad = [70, 120, 70, 120];
  body.push(table(m.totals.map(t => tr(t.muted
    ? [cell(para(run(t.value, { color: MUTED }), { jc: "right", after: 0 }), { w: tw[0] + tw[1], span: 2, pad: tpad })]
    : [cell(para(run(t.label, { b: !!t.due, sz: t.due ? 25 : 21 }), { after: 0 }), { w: tw[0], top: t.due ? { sz: 12, color: DARK } : null, pad: tpad }),
       cell(para(run(t.value, { b: !!t.due, sz: t.due ? 25 : 21 }), { jc: "right", after: 0 }), { w: tw[1], top: t.due ? { sz: 12, color: DARK } : null, pad: tpad })])), tw));
  // Сума прописом — на сірому тлі з темною смугою ліворуч.
  body.push(para(run("Всього до оплати: ") + run(m.words, { b: true }) + run(m.vatText + "."), { bar: true, before: 240, after: 200, ind: 160 }));
  m.notes.forEach(n => body.push(para(run(n, { color: MUTED }), { after: 100 })));
  body.push(para(run(m.purpose, { color: MUTED }), { after: 100 }));
  body.push(para(run(m.validity, { color: MUTED }), { after: 0 }));
  // Підпис. Печатка ТОВ — коло 40 мм на кінці «Виписав(ла)», лінію підпису не закриває.
  const withStamp = !!(s.vat && images.stamp);
  const stamp = withStamp ? floatPic("rIdStamp", images.stamp, STAMP_MM.imgW,
    STAMP_AT_MM.x - STAMP_MM.imgW * STAMP_MM.cx,
    STAMP_AT_MM.y - (STAMP_MM.imgW * (pngSize(images.stamp) || { w: 1, h: 1 }).h / (pngSize(images.stamp) || { w: 1, h: 1 }).w) * STAMP_MM.cy) : "";
  body.push(withStamp
    ? para("", { after: 1300 }) + table([tr([
        cell(para(stamp + run("Виписав(ла):"), { after: 0 }), { w: Math.round(SIGN_LINE_MM * TW), pad: [0, 0, 0, 0] }),
        cell(para(run("______________________"), { after: 0 }), { w: W - Math.round(SIGN_LINE_MM * TW), pad: [0, 0, 0, 0] }),
      ])], [Math.round(SIGN_LINE_MM * TW), W - Math.round(SIGN_LINE_MM * TW)])
    : para("", { after: 600 }) + para(run("Виписав(ла): ______________________"), { after: 0 }));
  const sect = '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1000" w:right="1134" w:bottom="1000" w:left="1134" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr>';
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'
    + ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'
    + ' xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"'
    + ' xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"'
    + ' xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>' + body.join("") + sect + "</w:body></w:document>";
}

const CRC_TABLE = (() => { const t = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(bytes) { let c = 0xFFFFFFFF; for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
/** ZIP (без стиснення) з файлів { шлях: текст або Uint8Array }. */
function zipStore(files) {
  const enc = new TextEncoder();
  const chunks = [], central = [];
  let offset = 0;
  Object.keys(files).forEach((name) => {
    const v = files[name];
    const nameB = enc.encode(name), data = typeof v === "string" ? enc.encode(v) : v, crc = crc32(data);
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
/**
 * Рахунок як файл Word (.docx) — байти для завантаження.
 * images (необовʼязково): { logo: PNG-байти логотипа, stamp: PNG-байти печатки ТОВ } — вбудовуються у файл.
 */
function buildInvoiceDocx(inv, images) {
  const imgs = {};
  if (images && pngSize(images.logo)) imgs.logo = images.logo;
  const tov = (AVALON_INVOICE_SELLERS[inv.seller] || {}).vat;
  if (images && tov && pngSize(images.stamp)) imgs.stamp = images.stamp;
  const rels = [];
  if (imgs.logo) rels.push('<Relationship Id="rIdLogo" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/logo.png"/>');
  if (imgs.stamp) rels.push('<Relationship Id="rIdStamp" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/stamp.png"/>');
  const files = {
    "[Content_Types].xml": '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
      + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'
      + '<Default Extension="png" ContentType="image/png"/>'
      + '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    "_rels/.rels": '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    "word/document.xml": invoiceDocxXml(inv, imgs),
  };
  if (rels.length) {
    files["word/_rels/document.xml.rels"] = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + rels.join("") + "</Relationships>";
  }
  if (imgs.logo) files["word/media/logo.png"] = imgs.logo;
  if (imgs.stamp) files["word/media/stamp.png"] = imgs.stamp;
  return zipStore(files);
}
/**
 * Рахунок як справжній PDF-файл (не сторінка в браузері) — його можна зберегти й надіслати файлом.
 * Вигляд — як у buildInvoiceHtml. Бібліотеки передаються ззовні, щоб блок був однаковий у CRM і калькуляторі:
 * deps = { PDFDocument, rgb, fontkit, fonts: { regular, bold } (байти TTF), images: { logo, stamp } (байти PNG) }.
 */
async function buildInvoicePdf(inv, deps) {
  const m = invoiceModel(inv);
  const s = m.seller;
  const { PDFDocument, rgb, fontkit } = deps;
  const images = deps.images || {};
  const MMPT = 72 / 25.4;
  const hex = (h) => rgb(parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255);
  const C = { text: hex("1f2326"), dark: hex("383e42"), muted: hex("66716b"), line: hex("dfe3e0"), row: hex("e5e7eb"), soft: hex("f4f6f5"), white: rgb(1, 1, 1) };
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  doc.setTitle(m.docTitle);
  doc.setAuthor(s.name);
  // Шрифт вбудовуємо цілим: часткове вбудовування в pdf-lib губить літери (перевірено на Arimo).
  const F = { r: await doc.embedFont(deps.fonts.regular), b: await doc.embedFont(deps.fonts.bold) };
  const logo = images.logo ? await doc.embedPng(images.logo) : null;
  const stamp = s.vat && images.stamp ? await doc.embedPng(images.stamp) : null;

  const PW = 595.28, PH = 841.89, MX = 14 * MMPT, MY = 14 * MMPT, W = PW - 2 * MX;
  let page = doc.addPage([PW, PH]);
  let y = PH - MY; // верх наступного елемента
  const ensure = (h) => { if (y - h < MY) { page = doc.addPage([PW, PH]); y = PH - MY; } };
  // Нерозривний пробіл малюємо звичайним (у шрифті він порожній), але рядок по ньому не розриваємо.
  // Символ, якого немає в шрифті (емодзі тощо), — «?»: інакше PDF мовчки лишив би порожнє місце.
  const known = new Set(F.r.getCharacterSet().filter(c => F.b.getCharacterSet().includes(c)));
  const vis = (t) => Array.from(String(t).replace(/\u00a0/g, " "), ch => (known.has(ch.codePointAt(0)) ? ch : "?")).join("");
  const width = (t, o) => (o.bold ? F.b : F.r).widthOfTextAtSize(vis(t), o.size);
  // Перенос тексту з частин різної жирності: [{ text, bold }] → рядки з частин.
  const wrap = (parts, size, maxW) => {
    const words = [];
    parts.forEach(p => String(p.text).split(/([ \t\n]+)/).filter(x => x !== "").forEach(w => words.push({ text: w, bold: !!p.bold })));
    const lines = [[]];
    let lw = 0;
    words.forEach(w => {
      const space = /^[ \t\n]+$/.test(w.text);
      const ww = width(w.text, { size, bold: w.bold });
      if (!space && lw + ww > maxW && lines[lines.length - 1].length) { lines.push([]); lw = 0; }
      if (space && lw === 0) return;
      if (!space && ww > maxW) { // одне довге слово — ріжемо по літерах
        let chunk = "";
        [...w.text].forEach(ch => {
          if (width(chunk + ch, { size, bold: w.bold }) > maxW - lw && chunk) { lines[lines.length - 1].push({ text: chunk, bold: w.bold }); lines.push([]); lw = 0; chunk = ""; }
          chunk += ch;
        });
        lines[lines.length - 1].push({ text: chunk, bold: w.bold }); lw += width(chunk, { size, bold: w.bold });
        return;
      }
      lines[lines.length - 1].push(w); lw += ww;
    });
    return lines.map(l => { while (l.length && /^[ \t\n]+$/.test(l[l.length - 1].text)) l.pop(); return l; });
  };
  const lineW = (l, size) => l.reduce((a, p) => a + width(p.text, { size, bold: p.bold }), 0);
  // Малює рядок частин; top — верх рядка, align — left/right відносно x..x+w.
  const drawLine = (l, x, top, size, color, align, w) => {
    let cx = align === "right" ? x + w - lineW(l, size) : align === "center" ? x + (w - lineW(l, size)) / 2 : x;
    const base = top - size * 0.93;
    l.forEach(p => { page.drawText(vis(p.text), { x: cx, y: base, size, font: p.bold ? F.b : F.r, color }); cx += width(p.text, { size, bold: p.bold }); });
  };
  // Блок тексту з переносами; повертає висоту.
  const LH = 1.5;
  const block = (parts, x, top, w, o) => {
    const lines = wrap(parts, o.size, w);
    lines.forEach((l, i) => drawLine(l, x, top - i * o.size * LH, o.size, o.color || C.text, o.align, w));
    return lines.length * o.size * LH;
  };
  const measure = (parts, w, size) => wrap(parts, size, w).length * size * LH;
  const rect = (x, top, w, h, o) => page.drawRectangle({ x, y: top - h, width: w, height: h, color: o.fill, borderColor: o.border, borderWidth: o.border ? (o.bw || 0.75) : 0 });
  const hline = (x, yy, w, t, color) => page.drawLine({ start: { x, y: yy }, end: { x: x + w, y: yy }, thickness: t, color });

  // ── Шапка: назва ліворуч, логотип праворуч, темна лінія ──
  const logoH = 36, logoW = logo ? logoH * logo.width / logo.height : 0;
  const titleW = W - (logo ? logoW + 12 : 150);
  const tH = measure([{ text: m.title, bold: true }], titleW, 15);
  const headH = Math.max(tH + 9.4 * LH, logoH);
  block([{ text: m.title, bold: true }], MX, y - (headH - tH - 9.4 * LH), titleW, { size: 15 });
  block([{ text: m.subtitle }], MX, y - headH + 9.4 * LH, titleW, { size: 9.4, color: C.muted });
  if (logo) page.drawImage(logo, { x: MX + W - logoW, y: y - headH, width: logoW, height: logoH });
  else {
    block([{ text: "AVALON METAL DESIGN", bold: true }], MX + W - 150, y - headH + 2 * 9.4 * LH, 150, { size: 9.4, align: "right" });
    block([{ text: "кошики для кондиціонерів" }], MX + W - 150, y - headH + 9.4 * LH, 150, { size: 9.4, color: C.muted, align: "right" });
  }
  y -= headH + 6;
  hline(MX, y, W, 1.5, C.dark);
  y -= 10.5;

  // ── Сторони: дві рамки ──
  const gap = 10.5, bw = (W - gap) / 2, padX = 9, padY = 7.5, BS = 9.4;
  const partyParts = (t, name, rows, extra) => [
    { parts: [{ text: t.toUpperCase() }], size: 8.25, color: C.muted, after: 3 },
    { parts: [{ text: name, bold: true }], size: BS },
    ...rows.map(r => ({ parts: [{ text: r }], size: BS })),
    ...(extra ? [{ parts: [{ text: extra }], size: BS, color: C.muted }] : []),
  ];
  const sides = [partyParts("Постачальник", s.name, m.sellerRows, s.vat ? "Платник ПДВ" : "Неплатник ПДВ"),
    partyParts("Покупець", m.buyer.name || "—", m.buyerRows)];
  const sideH = sides.map(list => list.reduce((a, it) => a + measure(it.parts, bw - 2 * padX, it.size) + (it.after || 0), 0) + 2 * padY);
  const boxH = Math.max(sideH[0], sideH[1]);
  ensure(boxH);
  sides.forEach((list, i) => {
    const x = MX + i * (bw + gap);
    rect(x, y, bw, sideH[i], { border: C.line });
    let ty = y - padY;
    list.forEach(it => { ty -= block(it.parts, x + padX, ty, bw - 2 * padX, { size: it.size, color: it.color }) + (it.after || 0); });
  });
  y -= boxH + 10.5;

  // ── Позиції ──
  const cw = [21, 0, 62, 72, 78];
  cw[1] = W - cw[0] - cw[2] - cw[3] - cw[4];
  const cx = cw.reduce((a, w, i) => { a.push(i ? a[i - 1] + cw[i - 1] : MX); return a; }, []);
  const ipx = 6, ipy = 5.25, IS = 9;
  const head = ["№", "Найменування", "Кількість", "Ціна" + (s.vat ? " з ПДВ" : ""), "Сума" + (s.vat ? " з ПДВ" : "")];
  const headRow = () => {
    const h = Math.max(...head.map((t, i) => measure([{ text: t, bold: true }], cw[i] - 2 * ipx, IS))) + 2 * ipy;
    ensure(h);
    rect(MX, y, W, h, { fill: C.dark });
    head.forEach((t, i) => block([{ text: t, bold: true }], cx[i] + ipx, y - ipy, cw[i] - 2 * ipx, { size: IS, color: C.white, align: i >= 2 ? "right" : i === 0 ? "center" : "left" }));
    y -= h;
  };
  headRow();
  m.items.forEach(it => {
    const cells = [it.n, it.name, it.qty, it.price, it.sum];
    const h = Math.max(...cells.map((t, i) => measure([{ text: t }], cw[i] - 2 * ipx, BS))) + 2 * ipy;
    if (y - h < MY) { page = doc.addPage([PW, PH]); y = PH - MY; headRow(); }
    cells.forEach((t, i) => block([{ text: t }], cx[i] + ipx, y - ipy, cw[i] - 2 * ipx, { size: BS, align: i >= 2 ? "right" : i === 0 ? "center" : "left" }));
    y -= h;
    hline(MX, y, W, 0.75, C.row);
  });
  y -= 9;

  // ── Підсумки праворуч ──
  const tw = [190, 75], tx = MX + W - tw[0] - tw[1], tpx = 6, tpy = 3;
  m.totals.forEach(t => {
    const size = t.due ? 10.5 : BS;
    const h = Math.max(measure([{ text: t.label, bold: !!t.due }], tw[0] - 2 * tpx, size), size * LH) + 2 * tpy + (t.due ? 2 : 0);
    ensure(h);
    if (t.due) hline(tx, y, tw[0] + tw[1], 1.5, C.dark);
    if (t.muted) block([{ text: t.value }], tx + tpx, y - tpy, tw[0] + tw[1] - 2 * tpx, { size, color: C.muted, align: "right" });
    else {
      block([{ text: t.label, bold: !!t.due }], tx + tpx, y - tpy - (t.due ? 2 : 0), tw[0] - 2 * tpx, { size });
      block([{ text: t.value, bold: !!t.due }], tx + tw[0] + tpx, y - tpy - (t.due ? 2 : 0), tw[1] - 2 * tpx, { size, align: "right" });
    }
    y -= h;
  });

  // ── Сума прописом на сірому тлі зі смугою ──
  y -= 9;
  const wordsParts = [{ text: "Всього до оплати: " }, { text: m.words, bold: true }, { text: m.vatText + "." }];
  const wH = measure(wordsParts, W - 18 - 2.25, BS) + 15;
  ensure(wH);
  rect(MX, y, W, wH, { fill: C.soft });
  rect(MX, y, 2.25, wH, { fill: C.dark });
  block(wordsParts, MX + 2.25 + 9, y - 7.5, W - 18 - 2.25, { size: BS });
  y -= wH + 9;
  m.notes.concat([m.purpose, m.validity]).forEach(n => {
    const h = measure([{ text: n }], W, BS);
    ensure(h);
    block([{ text: n }], MX, y, W, { size: BS, color: C.muted });
    y -= h + 3;
  });

  // ── Підпис; печатка ТОВ — коло 40 мм на кінці «Виписав(ла):», лінію підпису не закриває ──
  const stampW = STAMP_MM.imgW * MMPT, stampH = stamp ? stampW * stamp.height / stamp.width : 0;
  const before = stamp ? 26 * MMPT : 22.5;
  const stampRise = stamp ? (STAMP_MM.imgW * stamp.height / stamp.width * STAMP_MM.cy - STAMP_AT_MM.y) * MMPT : 0; // верх відбитка над рядком
  // Місце — під коло печатки (40 мм), а не під прозору рамку картинки: інакше підпис зайве переїжджає на нову сторінку.
  const circleBelow = stamp ? (STAMP_AT_MM.y + STAMP_MM.circle / 2) * MMPT : 0;
  ensure(before + Math.max(BS * LH, circleBelow));
  y -= before;
  drawLine([{ text: "Виписав(ла): " }], MX, y, BS, C.text, "left", W);
  const lineX = stamp ? MX + SIGN_LINE_MM * MMPT : MX + width("Виписав(ла): ", { size: BS });
  drawLine([{ text: "______________________" }], lineX, y, BS, C.text, "left", W);
  if (stamp) page.drawImage(stamp, { x: MX + (STAMP_AT_MM.x - STAMP_MM.imgW * STAMP_MM.cx) * MMPT, y: y + stampRise - stampH, width: stampW, height: stampH });
  return doc.save();
}
// AVALON-INVOICE-DOC-END

module.exports = { AVALON_INVOICE_SELLERS, avalonAmountInWords, avalonVatOf, invoiceModel, buildInvoiceHtml, buildInvoiceDocx, invoiceDocxXml, buildInvoicePdf };
