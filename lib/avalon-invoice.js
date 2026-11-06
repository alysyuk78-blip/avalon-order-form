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
function uah(n) {
  return Math.round(Number(n) || 0).toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ") + " ₴";
}
function uah2(n) {
  const [i, f] = (Math.round((Number(n) || 0) * 100) / 100).toFixed(2).split(".");
  return i.replace(/\B(?=(\d{3})+(?!\d))/g, " ") + "," + f + " ₴";
}

/**
 * Документ рахунку (HTML, A4). inv: { number, date (дд.мм.рррр), seller: "fop"|"tov", order_number,
 *   buyer: { kind: "person"|"fop"|"company", name, code, ipn, iban, bank, address, phone, email },
 *   lines: [{ name, qty, unit, sum }], order_total, paid_before, amount, stamp_url }
 * Сума рахунку — amount: усе замовлення, залишок чи передоплата; позиції показуються завжди.
 */
function buildInvoiceHtml(inv) {
  const s = AVALON_INVOICE_SELLERS[inv.seller] || AVALON_INVOICE_SELLERS.fop;
  const b = inv.buyer || {};
  const lines = inv.lines || [];
  const amount = Math.round(Number(inv.amount) || 0);
  const orderTotal = Math.round(Number(inv.order_total) || lines.reduce((sum, l) => sum + (Number(l.sum) || 0), 0));
  const paidBefore = Math.round(Number(inv.paid_before) || 0);
  const rest = orderTotal - paidBefore;
  const vat = s.vat ? avalonVatOf(amount) : 0;
  const buyerRows = [
    b.code ? (b.kind === "company" ? "Код ЄДРПОУ: " : "РНОКПП / код: ") + esc(b.code) : "",
    b.ipn ? "ІПН: " + esc(b.ipn) : "",
    b.iban ? "IBAN: " + esc(b.iban) : "",
    b.bank ? "Банк: " + esc(b.bank) : "",
    b.address ? "Адреса: " + esc(b.address) : "",
    b.phone ? "Телефон: " + esc(b.phone) : "",
    b.email ? "E-mail: " + esc(b.email) : "",
  ].filter(Boolean).map(r => `<div>${r}</div>`).join("");
  const rows = lines.map((l, i) => {
    const qty = Number(l.qty) || 1;
    const sum = Math.round(Number(l.sum) || 0);
    const price = sum / qty;
    // Ціна з копійками, коли сума не ділиться на кількість націло (3 шт. на 1 000 ₴ → 333,33 ₴).
    const priceText = Math.abs(price - Math.round(price)) < 0.005 ? uah(price) : uah2(price);
    return `<tr><td class="c">${i + 1}</td><td>${esc(l.name)}</td><td class="r">${esc(String(qty).replace(".", ","))} ${esc(l.unit || "шт.")}</td>`
      + `<td class="r">${priceText}</td><td class="r">${uah(sum)}</td></tr>`;
  }).join("");
  const totals = [`<tr><td>Разом за замовленням${s.vat ? " (з ПДВ)" : ""}:</td><td class="r">${uah(orderTotal)}</td></tr>`];
  // «Сплачено раніше» — завжди, коли клієнт уже платив (інакше рахунок на всю суму виглядав би як повна оплата).
  if (paidBefore >= 1) totals.push(`<tr><td>Сплачено раніше:</td><td class="r">${uah(paidBefore)}</td></tr>`);
  if (paidBefore >= 1 || Math.abs(amount - orderTotal) >= 1) {
    const note = amount < rest - 0.5 ? " (часткова оплата / передоплата)" : amount > rest + 0.5 ? " (більше за залишок)" : "";
    totals.push(`<tr class="due"><td>До оплати за цим рахунком${note}:</td><td class="r">${uah(amount)}</td></tr>`);
  } else {
    totals.push(`<tr class="due"><td>Всього до оплати:</td><td class="r">${uah(amount)}</td></tr>`);
  }
  if (s.vat) {
    totals.push(`<tr><td>у т. ч. ПДВ 20 %:</td><td class="r">${uah2(vat)}</td></tr>`);
    totals.push(`<tr><td>Сума без ПДВ:</td><td class="r">${uah2(amount - vat)}</td></tr>`);
  } else {
    totals.push(`<tr><td colspan="2" class="r muted">Без ПДВ</td></tr>`);
  }
  return `<!DOCTYPE html>
<html lang="uk"><head><meta charset="utf-8"><title>Рахунок ${esc(inv.number)} — ${esc(inv.order_number || "")}</title>
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
    <td><h1>РАХУНОК НА ОПЛАТУ № ${esc(inv.number)}</h1><div class="muted">від ${esc(inv.date)}${inv.order_number ? " · замовлення " + esc(inv.order_number) : ""}</div></td>
    <td class="r"><b>AVALON METAL DESIGN</b><div class="muted">кошики для кондиціонерів</div></td>
  </tr></table>
  <table class="parties"><tr>
    <td><div class="party"><div class="t">Постачальник</div><b>${esc(s.name)}</b>
      <div>${esc(s.codeLabel)}: ${esc(s.code)}</div>${s.ipn ? `<div>ІПН: ${esc(s.ipn)}</div>` : ""}
      <div>IBAN: ${esc(s.iban)}</div><div>Банк: ${esc(s.bank)}</div>${s.address ? `<div>Адреса: ${esc(s.address)}</div>` : ""}
      <div class="muted">${s.vat ? "Платник ПДВ" : "Неплатник ПДВ"}</div></div></td>
    <td><div class="party"><div class="t">Покупець</div><b>${esc(b.name || "—")}</b>${buyerRows}</div></td>
  </tr></table>
  <table class="items">
    <tr><th class="c" style="width:28px">№</th><th>Найменування</th><th class="r">Кількість</th><th class="r">Ціна${s.vat ? " з ПДВ" : ""}</th><th class="r">Сума${s.vat ? " з ПДВ" : ""}</th></tr>
    ${rows}
  </table>
  <table class="tot">${totals.join("")}</table>
  <div class="words">Всього до оплати: <b>${esc(avalonAmountInWords(amount))}</b>${s.vat ? `, у т. ч. ПДВ ${esc(uah2(vat))}` : ", без ПДВ"}.</div>
  <div class="muted">Призначення платежу: оплата за рахунком № ${esc(inv.number)} від ${esc(inv.date)}${inv.order_number ? ", замовлення " + esc(inv.order_number) : ""}${s.vat ? `, у т. ч. ПДВ ${esc(uah2(vat))}` : ", без ПДВ"}.</div>
  <div class="muted" style="margin-top:6px">Рахунок дійсний до оплати протягом 3 днів з дати виставлення.</div>
  <table class="sign"><tr><td>Виписав(ла): ______________________</td><td class="r">${s.vat && inv.stamp_url ? `<img class="stamp" src="${esc(inv.stamp_url)}" alt="">` : ""}</td></tr></table>
</div></body></html>`;
}

/** Той самий документ як файл Word (.doc на основі HTML — Word і Google Документи його відкривають). */
function invoiceWordHtml(html) {
  const body = String(html).replace(/^[\s\S]*?<body[^>]*>/i, "").replace(/<\/body>[\s\S]*$/i, "");
  const style = (String(html).match(/<style>[\s\S]*?<\/style>/i) || [""])[0];
  return '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" '
    + 'xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8">' + style + "</head><body>" + body + "</body></html>";
}

module.exports = { AVALON_INVOICE_SELLERS, avalonAmountInWords, avalonVatOf, buildInvoiceHtml, invoiceWordHtml };
