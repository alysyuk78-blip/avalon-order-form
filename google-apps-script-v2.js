/**
 * Google Apps Script — Avalon Order Form v3.0 (облікова система)
 *
 * Аркуші:
 *   • Замовлення — авто з форми (1 рядок = 1 кошик). 32 колонки A–AF.
 *   • Дропшипери — реєстр партнерів за ?ref: ставка за кошик, продано, виручка,
 *     нараховано/виплачено/залишок (формули авто).
 *   • Виплати — лог фактичних виплат дропшиперам.
 *   • Витрати — лог витрат (реклама тощо).
 *   • Зведення — фінансовий підсумок: загалом + помісячно
 *     (виручка, собівартість, валовий прибуток, маржинальність, комісії, витрати, чистий прибуток).
 *
 * ПЕРШЕ НАЛАШТУВАННЯ: заміни весь код → Зберегти → запусти один раз rebuildAll()
 *   (старий аркуш «Замовлення» буде перейменовано в архів, створяться всі нові аркуші)
 *   → Ввести в дію → Керувати введеннями → Нова версія → Ввести в дію.
 */

var SHEET_ORDERS = "Замовлення";
var SHEET_DROP = "Дропшипери";
var SHEET_PAYOUTS = "Виплати";
var SHEET_EXPENSES = "Витрати";
var SHEET_DASH = "Зведення";
var SHEET_INFO = "Інструкція";

var RAL7016 = "#383E42";   // заливка шапок
var HDR_TEXT = "#FFFFFF";  // текст шапок
var HDR_FONT = "Google Sans";

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(SHEET_ORDERS);
    if (!sheet) { sheet = ss.insertSheet(SHEET_ORDERS); setupOrders(sheet); }
    if (sheet.getLastRow() === 0) setupOrders(sheet);
    if (!ss.getSheetByName(SHEET_PAYOUTS)) setupPayouts(ss); // Дропшипери посилається на Виплати
    if (!ss.getSheetByName(SHEET_DROP)) setupDropshippers(ss);

    var data = JSON.parse(e.postData.contents);
    data.order_number = nextOrderNumber();

    var MARKUP = 1 / (1 - 0.2593);
    var itemsIn = (Array.isArray(data.items) && data.items.length) ? data.items : [{
      basket_type: data.basket_type, construction_type: data.construction_type,
      color: data.color, color_custom: data.color_custom, pattern: data.pattern, pattern_custom: data.pattern_custom,
      size_w: data.size_w, size_h: data.size_h, size_d: data.size_d, quantity: data.quantity,
      ac_brand: data.ac_brand, ac_model: data.ac_model,
      price_total: data.price_total, area_m2: data.area_m2, cost_total: data.cost_total
    }];
    var dateStr = Utilities.formatDate(new Date(), "Europe/Kiev", "dd.MM.yyyy HH:mm");
    var lastRow = sheet.getLastRow();

    itemsIn.forEach(function (it) {
      var w = Number(it.size_w) || 0, h = Number(it.size_h) || 0, d = Number(it.size_d) || 0;
      var qty = Number(it.quantity) || 1;
      var areaM2 = 0, total = 0, costTotal = 0, hasMoney = false;
      if (it.price_total != null) {
        total = Math.round(Number(it.price_total));
        areaM2 = it.area_m2 != null ? Number(it.area_m2) : 0;
        costTotal = it.cost_total != null ? Math.round(Number(it.cost_total)) : Math.round(total / MARKUP);
        hasMoney = total > 0;
      } else if (w && h) {
        areaM2 = (w * h + 2 * d * h) / 1000000;
        var ppm2 = (it.construction_type || "").toLowerCase().indexOf("розбірний") >= 0 ? 2170 : 2030;
        ppm2 = Math.round(ppm2 * MARKUP);
        if ((it.basket_type || "").toLowerCase().indexOf("антивандал") >= 0) ppm2 = Math.round(ppm2 * 1.35);
        if (it.pattern && ["K3","K4","K6","K8","K9"].indexOf(it.pattern) >= 0) ppm2 = Math.round(ppm2 * 1.15);
        total = Math.round(areaM2 * ppm2) * qty;
        costTotal = Math.round(total / MARKUP);
        hasMoney = total > 0;
      }
      var profit    = hasMoney ? total - costTotal : "";
      var costUnit  = hasMoney ? Math.round(costTotal / qty) : "";
      var priceUnit = hasMoney ? Math.round(total / qty) : "";
      var revenue   = hasMoney ? total : "";
      var margin    = hasMoney ? Math.round((total - costTotal) / total * 1000) / 10 : "";

      var row = [
        data.order_number || "", dateStr, "Нове", data.referral_source || "direct",   // A-D №,Дата,Статус,Джерело
        (data.first_name || "") + " " + (data.last_name || ""),                        // E Клієнт
        (data.phone ? "'" + data.phone : ""), data.city || "",                         // F-G Телефон,Місто
        it.basket_type || "", it.construction_type || "",                              // H-I
        it.color || (it.color_custom || ""), it.pattern || (it.pattern_custom || ""),  // J-K
        it.ac_brand || "", it.ac_model || "",                                          // L-M Бренд,Модель
        w || "", h || "", d || "", qty,                                                // N-Q
        areaM2 ? Number(areaM2.toFixed(2)) : "",                                        // R Площа
        costUnit, costTotal || "", priceUnit, revenue, profit, margin,                 // S-X
        "", "",                                                                        // Y-Z Комісія,Чистий (формули)
        data.transport || (data.transport_custom || ""), data.delivery_address || "",  // AA-AB
        data.delivery_date || "", data.payment_method || "",                           // AC-AD
        data.how_found || (data.how_found_custom || ""), data.notes || ""              // AE-AF
      ];
      sheet.appendRow(row);
      lastRow = sheet.getLastRow();
      var rr = sheet.getRange(lastRow, 1, 1, row.length);
      rr.setVerticalAlignment("middle").setWrap(true);
      sheet.getRange(lastRow, 1).setFontWeight("bold");
      sheet.getRange(lastRow, 3).setBackground("#FFF3CD").setFontColor("#856404").setFontWeight("bold").setHorizontalAlignment("center");
      // Комісія = Кількість × ставка партнера (з аркуша Дропшипери); Чистий = Валовий − Комісія
      sheet.getRange(lastRow, 25).setFormula("=IFERROR($Q" + lastRow + "*VLOOKUP($D" + lastRow + ";" + SHEET_DROP + "!$A:$E;5;0);0)");
      sheet.getRange(lastRow, 26).setFormula("=IF($W" + lastRow + "=\"\";\"\";$W" + lastRow + "-$Y" + lastRow + ")");
      sheet.getRange(lastRow, 19, 1, 5).setNumberFormat("#,##0 ₴"); // S-W
      sheet.getRange(lastRow, 24).setNumberFormat('0.0"%"');        // X Маржа
      sheet.getRange(lastRow, 25, 1, 2).setNumberFormat("#,##0 ₴"); // Y-Z
      sheet.getRange(lastRow, 21).setFontWeight("bold");            // Ціна продажу 1шт
      if (lastRow % 2 === 0) rr.setBackground("#F8F6F2");
    });

    addDeliveryEvent(data); // подія в Google Календарі + нагадування (за 2 дні і в день о 08:30)

    return jsonOut({ status: "ok", order_number: data.order_number, row: lastRow });
  } catch (error) {
    return jsonOut({ status: "error", message: error.toString() });
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

function nextOrderNumber() {
  var tz = "Europe/Kiev", now = new Date();
  var ddmmyy = Utilities.formatDate(now, tz, "ddMMyy");
  var mmyy = Utilities.formatDate(now, tz, "MMyy");
  var props = PropertiesService.getScriptProperties();
  var counter = parseInt(props.getProperty("ord_counter") || "0", 10);
  if (props.getProperty("ord_month") !== mmyy) counter = 0;
  counter += 1;
  props.setProperty("ord_month", mmyy);
  props.setProperty("ord_counter", String(counter));
  return "ORD-" + ddmmyy + "-" + String(counter).padStart(3, "0");
}

// ===================== GOOGLE КАЛЕНДАР =====================

/**
 * Створює подію доставки/відправлення в Google Календарі (08:30 у день дати).
 * Нагадування: за 2 дні (о 08:30) і в сам день (о 08:30) — popup + email.
 * Помилки календаря не валять замовлення.
 */
function addDeliveryEvent(order) {
  try {
    if (!order.delivery_date) return;
    var p = String(order.delivery_date).split("-"); // формат yyyy-MM-dd
    if (p.length !== 3) return;
    var y = parseInt(p[0], 10), mo = parseInt(p[1], 10) - 1, da = parseInt(p[2], 10);
    if (!y || isNaN(mo) || !da) return;
    var start = new Date(y, mo, da, 8, 30, 0);
    var end = new Date(y, mo, da, 9, 0, 0);

    var who = ((order.first_name || "") + " " + (order.last_name || "")).trim();
    var transport = order.transport === "Інше" ? (order.transport_custom || "") : (order.transport || "");
    var title = "📦 " + (order.order_number || "Замовлення") + " — " + who + (order.city ? " (" + order.city + ")" : "");
    var desc = "Доставка / відправлення замовлення " + (order.order_number || "") +
      "\nКлієнт: " + who +
      "\nТелефон: " + (order.phone || "") +
      "\nДоставка: " + transport +
      (order.delivery_address ? "\nАдреса: " + order.delivery_address : "") +
      "\nДжерело: " + (order.referral_source || "direct");

    var cal = CalendarApp.getDefaultCalendar();
    var ev = cal.createEvent(title, start, end, { description: desc });
    ev.removeAllReminders();
    ev.addPopupReminder(0);          // у день події, о 08:30
    ev.addPopupReminder(2 * 24 * 60); // за 2 дні, о 08:30
    ev.addEmailReminder(0);
    ev.addEmailReminder(2 * 24 * 60);
  } catch (err) {
    console.error("Calendar error: " + err);
  }
}

// ===================== АРКУШІ =====================

function headerStyle(sheet, n) {
  var hr = sheet.getRange(1, 1, 1, n);
  hr.setFontWeight("bold").setBackground(RAL7016).setFontColor(HDR_TEXT).setFontFamily(HDR_FONT)
    .setHorizontalAlignment("center").setVerticalAlignment("middle").setWrap(true).setFontSize(10);
  sheet.setRowHeight(1, 42);
  sheet.setFrozenRows(1);
}

function setupOrders(sheet) {
  var headers = [
    "№ Замовлення","Дата/час","Статус","Джерело","Клієнт","Телефон","Місто",
    "Тип кошика","Конструкція","Колір","Візерунок","Бренд кондиц.","Модель кондиц.",
    "W (мм)","H (мм)","D (мм)","Кількість","Площа (м²)",
    "Собівартість 1шт","Собівартість заг","Ціна продажу 1шт","Виручка","Валовий прибуток","Маржа %",
    "Комісія дропш.","Чистий прибуток",
    "Доставка","Адреса","Дата доставки","Оплата","Як дізнались","Примітки"
  ];
  if (sheet.getMaxColumns() < headers.length) sheet.insertColumnsAfter(sheet.getMaxColumns(), headers.length - sheet.getMaxColumns());
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  headerStyle(sheet, headers.length);
  var widths = [130,130,90,130,150,130,100,170,150,120,80,120,150,60,60,60,80,80,110,110,110,110,110,80,110,110,140,200,110,140,160,200];
  widths.forEach(function (w, i) { sheet.setColumnWidth(i + 1, w); });

  var rule = SpreadsheetApp.newDataValidation()
    .requireValueInList(["Нове","В роботі","Готове","Відправлено","Завершено","Скасовано"]).setAllowInvalid(false).build();
  sheet.getRange(2, 3, 1000, 1).setDataValidation(rule);
  var sr = sheet.getRange("C2:C1000");
  var cfRules = [
    {t:"Нове",bg:"#FFF3CD",fg:"#856404"}, {t:"В роботі",bg:"#CCE5FF",fg:"#004085"},
    {t:"Готове",bg:"#D4EDDA",fg:"#155724"}, {t:"Відправлено",bg:"#D1ECF1",fg:"#0C5460"},
    {t:"Завершено",bg:"#E2E3E5",fg:"#383D41"}, {t:"Скасовано",bg:"#F8D7DA",fg:"#721C24"}
  ].map(function (r) { return SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo(r.t).setBackground(r.bg).setFontColor(r.fg).setBold(true).setRanges([sr]).build(); });
  sheet.setConditionalFormatRules(cfRules);
}

function setupDropshippers(ss) {
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();
  if (ss.getSheetByName(SHEET_DROP)) return ss.getSheetByName(SHEET_DROP);
  var sh = ss.insertSheet(SHEET_DROP);
  var headers = ["КОД","Назва / ПІБ","Тип","Контакт","Ставка за кошик, ₴","Кошиків продано","Виручка, ₴","Нараховано, ₴","Виплачено, ₴","Залишок до виплати, ₴"];
  sh.getRange(1, 1, 1, headers.length).setValues([headers]);
  headerStyle(sh, headers.length);
  [150,170,110,150,130,120,120,130,120,150].forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });
  // Приклад-партнер (заповнюєш A–E вручну)
  sh.getRange("A2:E2").setValues([["OSBB-Lvivska12","[ПІБ голови]","ОСББ","[тел / чат]",150]]);
  // Авто-формули (спадають донизу для всіх рядків з КОДом)
  var O = SHEET_ORDERS, P = SHEET_PAYOUTS;
  sh.getRange("F2").setFormula('=ARRAYFORMULA(IF(A2:A="";"";SUMIF(' + O + '!D:D;A2:A;' + O + '!Q:Q)))');
  sh.getRange("G2").setFormula('=ARRAYFORMULA(IF(A2:A="";"";SUMIF(' + O + '!D:D;A2:A;' + O + '!V:V)))');
  sh.getRange("H2").setFormula('=ARRAYFORMULA(IF(A2:A="";"";SUMIF(' + O + '!D:D;A2:A;' + O + '!Y:Y)))');
  sh.getRange("I2").setFormula('=ARRAYFORMULA(IF(A2:A="";"";SUMIF(' + P + '!B:B;A2:A;' + P + '!D:D)))');
  sh.getRange("J2").setFormula('=ARRAYFORMULA(IF(A2:A="";"";H2:H-I2:I))');
  sh.getRange("E2:E").setNumberFormat("#,##0 ₴");
  sh.getRange("G2:J").setNumberFormat("#,##0 ₴");

  // Інструкція (праворуч від даних, колонка L)
  var info = [
    ["📖 ЯК ПРАЦЮЮТЬ РЕФЕРАЛЬНІ ПОСИЛАННЯ (?ref=КОД)"],
    ["Кожен партнер має унікальний КОД. Замовлення з його посилання автоматично привʼязується до нього і нараховує комісію."],
    [""],
    ["1) Додай рядок: КОД · Назва · Тип · Контакт · Ставка за кошик (стовпці A–E). Стовпці F–J рахуються самі."],
    ["2) Дай партнеру його посилання або QR:"],
    ["       https://avalon-order-form.vercel.app/?ref=КОД        (напр. …/?ref=OSBB-Lvivska12)"],
    ["3) Партнер поширює посилання/QR (під'їзд, чат ОСББ, соцмережі)."],
    ["4) Замовлення з його посилання → колонка «Джерело» = КОД → комісія нараховується в цьому рядку."],
    ["5) Коли виплатив — запиши в аркуш «Виплати» (КОД + сума). «Залишок до виплати» оновиться сам."],
    [""],
    ["Схема КОДів:  ОСББ → OSBB-Вулиця№ (напр. OSBB-Lvivska12) ·  партнер → PARTNER-Імʼя ·  по під'їздах → OSBB-Вулиця№-podN"],
    ["Без ?ref= замовлення має джерело «direct» — комісія 0."],
    ["QR-код: будь-який безкоштовний генератор (напр. qr-code-generator.com) → встав посилання → друк наклейок."]
  ];
  var c = 12; // L
  sh.getRange(1, c, info.length, 1).setValues(info).setWrap(true).setVerticalAlignment("top").setBackground("#FBF8EF");
  sh.setColumnWidth(c, 640);
  sh.getRange(1, c).setFontWeight("bold").setFontSize(11).setFontColor("#1B4332");
  return sh;
}

function setupPayouts(ss) {
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();
  if (ss.getSheetByName(SHEET_PAYOUTS)) return ss.getSheetByName(SHEET_PAYOUTS);
  var sh = ss.insertSheet(SHEET_PAYOUTS);
  var headers = ["Дата","КОД дропшипера","Назва","Сума, ₴","Спосіб","Примітка"];
  sh.getRange(1, 1, 1, headers.length).setValues([headers]);
  headerStyle(sh, headers.length);
  [110,160,170,110,140,220].forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });
  // Назва підтягується з Дропшипери за КОДом
  sh.getRange("C2").setFormula('=ARRAYFORMULA(IF(B2:B="";"";IFERROR(VLOOKUP(B2:B;' + SHEET_DROP + '!A:B;2;0);"")))');
  sh.getRange("A2:A").setNumberFormat("dd.MM.yyyy");
  sh.getRange("D2:D").setNumberFormat("#,##0 ₴");
  return sh;
}

function setupExpenses(ss) {
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();
  if (ss.getSheetByName(SHEET_EXPENSES)) return ss.getSheetByName(SHEET_EXPENSES);
  var sh = ss.insertSheet(SHEET_EXPENSES);
  var headers = ["Дата","Категорія","Опис","Сума, ₴","Примітка"];
  sh.getRange(1, 1, 1, headers.length).setValues([headers]);
  headerStyle(sh, headers.length);
  [110,180,260,110,220].forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });
  var rule = SpreadsheetApp.newDataValidation()
    .requireValueInList(["Реклама / маркетинг","Доставка","Пакування / матеріали","Підряд / зарплати","Інше"]).setAllowInvalid(true).build();
  sh.getRange(2, 2, 1000, 1).setDataValidation(rule);
  sh.getRange("A2:A").setNumberFormat("dd.MM.yyyy");
  sh.getRange("D2:D").setNumberFormat("#,##0 ₴");
  return sh;
}

function setupDashboard(ss) {
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();
  if (ss.getSheetByName(SHEET_DASH)) return ss.getSheetByName(SHEET_DASH);
  var sh = ss.insertSheet(SHEET_DASH);
  var O = SHEET_ORDERS, E = SHEET_EXPENSES, P = SHEET_PAYOUTS;
  [220,140,140,140,140,140,140,150].forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });

  // ---- ЗАГАЛОМ ----
  sh.getRange("A1").setValue("ЗВЕДЕННЯ — ЗАГАЛОМ").setFontWeight("bold").setFontSize(12);
  var rows = [
    ["Виручка",                 '=SUM(' + O + '!V:V)'],
    ["Собівартість",            '=SUM(' + O + '!T:T)'],
    ["Валовий прибуток",        '=SUM(' + O + '!W:W)'],
    ["Маржинальність %",        '=IFERROR(B4/B2;0)'],
    ["Комісії дропшиперам (нараховано)", '=SUM(' + O + '!Y:Y)'],
    ["Виплачено дропшиперам",   '=SUM(' + P + '!D:D)'],
    ["Залишок до виплати",      '=B6-B7'],
    ["Інші витрати",            '=SUM(' + E + '!D:D)'],
    ["ЧИСТИЙ ПРИБУТОК",         '=B4-B6-B9']
  ];
  for (var i = 0; i < rows.length; i++) {
    sh.getRange(i + 2, 1).setValue(rows[i][0]);
    sh.getRange(i + 2, 2).setFormula(rows[i][1]);
  }
  sh.getRange("A2:A10").setFontWeight("bold");
  sh.getRange("B2:B3").setNumberFormat("#,##0 ₴");
  sh.getRange("B4").setNumberFormat("#,##0 ₴");
  sh.getRange("B5").setNumberFormat('0.0"%"');
  sh.getRange("B6:B10").setNumberFormat("#,##0 ₴");
  sh.getRange("A10:B10").setBackground("#DCFCE7").setFontWeight("bold");

  // ---- ПОМІСЯЧНО ----
  sh.getRange("A13").setValue("ПОМІСЯЧНО").setFontWeight("bold").setFontSize(12);
  var mh = ["Місяць (ММ.РРРР)","Виручка","Собівартість","Валовий прибуток","Маржинальність %","Комісії","Витрати","Чистий прибуток"];
  sh.getRange(14, 1, 1, mh.length).setValues([mh]);
  headerStyleAt(sh, 14, mh.length);
  // Поточний місяць як приклад + формули на 12 рядків
  var curMonth = Utilities.formatDate(new Date(), "Europe/Kiev", "MM.yyyy");
  for (var r = 15; r < 27; r++) {
    if (r === 15) sh.getRange(r, 1).setValue(curMonth);
    var m = "$A" + r;
    sh.getRange(r, 2).setFormula('=IF(' + m + '="";"";SUMPRODUCT((MID(' + O + '!$B$2:$B$5000;4;7)=' + m + ')*' + O + '!$V$2:$V$5000))');
    sh.getRange(r, 3).setFormula('=IF(' + m + '="";"";SUMPRODUCT((MID(' + O + '!$B$2:$B$5000;4;7)=' + m + ')*' + O + '!$T$2:$T$5000))');
    sh.getRange(r, 4).setFormula('=IF(' + m + '="";"";SUMPRODUCT((MID(' + O + '!$B$2:$B$5000;4;7)=' + m + ')*' + O + '!$W$2:$W$5000))');
    sh.getRange(r, 5).setFormula('=IFERROR(D' + r + '/B' + r + ';"")');
    sh.getRange(r, 6).setFormula('=IF(' + m + '="";"";SUMPRODUCT((MID(' + O + '!$B$2:$B$5000;4;7)=' + m + ')*' + O + '!$Y$2:$Y$5000))');
    // Витрати помісячно — через TEXT дати (Витрати!A = реальна дата)
    sh.getRange(r, 7).setFormula('=IF(' + m + '="";"";SUMPRODUCT((TEXT(' + E + '!$A$2:$A$2000;"MM.yyyy")=' + m + ')*' + E + '!$D$2:$D$2000))');
    // Чистий прибуток = Валовий − Комісії − Витрати
    sh.getRange(r, 8).setFormula('=IF(' + m + '="";"";D' + r + '-F' + r + '-G' + r + ')');
  }
  sh.getRange("B15:D26").setNumberFormat("#,##0 ₴");
  sh.getRange("E15:E26").setNumberFormat('0.0%');
  sh.getRange("F15:H26").setNumberFormat("#,##0 ₴");
  return sh;
}

function headerStyleAt(sheet, rowIdx, n) {
  var hr = sheet.getRange(rowIdx, 1, 1, n);
  hr.setFontWeight("bold").setBackground(RAL7016).setFontColor(HDR_TEXT).setFontFamily(HDR_FONT)
    .setHorizontalAlignment("center").setVerticalAlignment("middle").setWrap(true).setFontSize(10);
}

function setupInstructions(ss) {
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();
  if (ss.getSheetByName(SHEET_INFO)) return ss.getSheetByName(SHEET_INFO);
  var sh = ss.insertSheet(SHEET_INFO, 0); // перший аркуш зліва
  sh.setHiddenGridlines(true);
  var lines = [
    "📘 ІНСТРУКЦІЯ — ОБЛІКОВА СИСТЕМА AVALON (кошики)",
    "",
    "Система з 5 аркушів. Замовлення приходять автоматично з онлайн-форми, фінанси рахуються самі.",
    "",
    "━━━ АРКУШІ ━━━",
    "• Замовлення — лог усіх замовлень (1 рядок = 1 кошик). Наповнюється сам. Ти лише міняєш Статус (випадайка).",
    "• Дропшипери — партнери за ?ref-кодом. Заповнюєш A–E: КОД · Назва · Тип · Контакт · Ставка за кошик. Решта (продано, виручка, нараховано, виплачено, залишок) — рахується.",
    "• Виплати — лог виплат партнерам: Дата · КОД дропшипера · Сума. Оновлює «Залишок до виплати».",
    "• Витрати — реклама та інші витрати: Дата · Категорія · Опис · Сума.",
    "• Зведення — підсумки: виручка, собівартість, маржинальність, комісії, чистий прибуток (загалом + помісячно).",
    "",
    "━━━ ЯК ПРАЦЮЮТЬ РЕФЕРАЛЬНІ ПОСИЛАННЯ (?ref=КОД) ━━━",
    "Кожен партнер має унікальний КОД. Замовлення з його посилання автоматично привʼязується до нього й нараховує комісію.",
    "1) Додай партнера в аркуш «Дропшипери» (КОД + ставка за кошик).",
    "2) Дай йому посилання:   https://avalon-order-form.vercel.app/?ref=КОД   (напр. …/?ref=OSBB-Lvivska12)",
    "3) Партнер поширює посилання або QR (під'їзд, чат ОСББ, соцмережі).",
    "4) Замовлення з посилання → колонка «Джерело» = КОД → комісія = Кількість × Ставка.",
    "5) Виплатив партнеру — запиши в аркуш «Виплати». «Залишок до виплати» оновиться сам.",
    "Схема КОДів:  ОСББ → OSBB-Вулиця№ (напр. OSBB-Lvivska12) ·  партнер → PARTNER-Імʼя ·  по під'їздах → OSBB-Вулиця№-podN",
    "Без ?ref= замовлення має джерело «direct» — комісія 0.",
    "QR-код: будь-який безкоштовний генератор (напр. qr-code-generator.com) → встав посилання → друк наклейок у під'їзди.",
    "",
    "━━━ ФІНАНСИ ━━━",
    "Комісія дропш. = Кількість × Ставка партнера.    Чистий прибуток (рядок) = Валовий прибуток − Комісія.",
    "Маржинальність % = Валовий прибуток ÷ Виручка.    Чистий прибуток (Зведення) = Валовий − Комісії − Витрати.",
    "",
    "Питання чи зміни — звертайся."
  ];
  sh.getRange(1, 1, lines.length, 1).setValues(lines.map(function (t) { return [t]; }));
  sh.setColumnWidth(1, 980);
  var all = sh.getRange(1, 1, lines.length, 1);
  all.setWrap(true).setVerticalAlignment("top").setFontFamily(HDR_FONT).setFontSize(11);
  // Заголовок
  sh.getRange("A1").setFontSize(15).setFontWeight("bold").setFontColor(HDR_TEXT).setBackground(RAL7016);
  sh.setRowHeight(1, 40);
  // Підзаголовки секцій (рядки, що починаються з ━━━)
  for (var i = 0; i < lines.length; i++) {
    if (lines[i].indexOf("━━━") === 0) {
      sh.getRange(i + 1, 1).setFontWeight("bold").setFontColor(RAL7016).setFontSize(12);
    }
  }
  sh.setFrozenRows(1);
  return sh;
}

/** Повне перестворення: архівує старий «Замовлення», створює всі аркуші заново. Запусти ОДИН раз. */
function rebuildAll() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var old = ss.getSheetByName(SHEET_ORDERS);
  if (old) old.setName("Замовлення (архів " + Utilities.formatDate(new Date(), "Europe/Kiev", "dd.MM HH:mm") + ")");
  setupOrders(ss.insertSheet(SHEET_ORDERS, 0));
  // Порядок важливий: Виплати раніше за Дропшипери (Дропшипери.I посилається на Виплати).
  setupExpenses(ss);
  setupPayouts(ss);
  setupDropshippers(ss);
  setupDashboard(ss);
  setupInstructions(ss);
  // Перевстановити крос-формулу (тепер усі аркуші існують) — щоб уникнути застряглого #REF.
  ss.getSheetByName(SHEET_PAYOUTS).getRange("C2")
    .setFormula('=ARRAYFORMULA(IF(B2:B="";"";IFERROR(VLOOKUP(B2:B;' + SHEET_DROP + '!A:B;2;0);"")))');
  SpreadsheetApp.flush();
}

/** Запусти один раз, щоб надати дозвіл на Google Календар (нова інтеграція). */
function authorize() {
  CalendarApp.getDefaultCalendar().getName();
  SpreadsheetApp.getActiveSpreadsheet().getName();
}

function jsonOut(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) { return jsonOut({ status: "ok", message: "Avalon v3.0" }); }
