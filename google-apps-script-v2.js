/**
 * Google Apps Script — Webhook v2.0 для Avalon Order Form
 * З номером замовлення, стильним оформленням, статусами
 * 
 * ОНОВЛЕННЯ: заміни весь код у Apps Script на цей,
 * потім: Ввести в дію → Керувати введеннями → Оновити
 */

function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000); // атомарна нумерація при одночасних замовленнях
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName("Замовлення");
    if (!sheet) {
      sheet = ss.insertSheet("Замовлення");
      setupSheet(sheet);
    }
    if (sheet.getLastRow() === 0) setupSheet(sheet);
    if (!ss.getSheetByName("Джерела")) setupSourcesSheet(ss);

    const data = JSON.parse(e.postData.contents);
    data.order_number = nextOrderNumber(); // послідовний № ORD-ДДММРР-NNN (авторитетно, перекриває клієнтський)

    // Позиції: кілька кошиків (data.items) або один кошик (старий формат). Один рядок на кошик.
    const MARKUP = 1 / (1 - 0.2593); // ~1.3503 — та сама націнка, що у формі
    const itemsIn = (Array.isArray(data.items) && data.items.length) ? data.items : [{
      basket_type: data.basket_type, construction_type: data.construction_type,
      color: data.color, color_custom: data.color_custom, pattern: data.pattern, pattern_custom: data.pattern_custom,
      size_w: data.size_w, size_h: data.size_h, size_d: data.size_d, quantity: data.quantity,
      ac_brand: data.ac_brand, ac_model: data.ac_model,
      price_total: data.price_total, area_m2: data.area_m2, cost_total: data.cost_total, profit: data.profit, prepayment: data.prepayment
    }];
    const dateStr = Utilities.formatDate(new Date(), "Europe/Kiev", "dd.MM.yyyy HH:mm");
    let lastRow = sheet.getLastRow();

    itemsIn.forEach(function (it) {
      const w = Number(it.size_w) || 0, h = Number(it.size_h) || 0, d = Number(it.size_d) || 0;
      const qty = Number(it.quantity) || 1;
      let areaM2 = 0, total = 0, costTotal = "", profit = "", prepay = "";
      if (it.price_total != null) {
        total = Math.round(Number(it.price_total));
        areaM2 = it.area_m2 != null ? Number(it.area_m2) : 0;
        costTotal = it.cost_total != null ? Math.round(Number(it.cost_total)) : "";
        profit = it.profit != null ? Math.round(Number(it.profit)) : "";
        prepay = it.prepayment != null ? Math.round(Number(it.prepayment)) : (total ? Math.round(total * 0.5) : "");
      } else if (w && h) {
        areaM2 = (w * h + 2 * d * h) / 1000000;
        let ppm2 = (it.construction_type || "").toLowerCase().indexOf("розбірний") >= 0 ? 2170 : 2030;
        ppm2 = Math.round(ppm2 * MARKUP);
        if ((it.basket_type || "").toLowerCase().indexOf("антивандал") >= 0) ppm2 = Math.round(ppm2 * 1.35);
        if (it.pattern && ["K3","K4","K6","K8","K9"].indexOf(it.pattern) >= 0) ppm2 = Math.round(ppm2 * 1.15);
        total = Math.round(areaM2 * ppm2) * qty;
        costTotal = Math.round(total / MARKUP);
        profit = total - costTotal;
        prepay = total ? Math.round(total * 0.5) : "";
      }
      const row = [
        data.order_number || "", dateStr, "Нове",
        (data.first_name || "") + " " + (data.last_name || ""),
        data.phone || "", data.city || "",
        it.basket_type || "", it.construction_type || "",
        it.color || (it.color_custom || ""), it.pattern || (it.pattern_custom || ""),
        w || "", h || "", d || "", qty,
        areaM2 ? areaM2.toFixed(2) : "", total || "", prepay, costTotal, profit,
        data.transport || (data.transport_custom || ""),
        data.delivery_address || "", data.delivery_date || "",
        data.payment_method || "", data.how_found || (data.how_found_custom || ""),
        data.notes || "",
        it.ac_brand || "", it.ac_model || "",
        data.referral_source || "direct"
      ];
      sheet.appendRow(row);
      lastRow = sheet.getLastRow();
      const rr = sheet.getRange(lastRow, 1, 1, row.length);
      rr.setVerticalAlignment("middle").setWrap(true);
      sheet.getRange(lastRow, 1).setFontWeight("bold");
      sheet.getRange(lastRow, 3).setBackground("#FFF3CD").setFontColor("#856404").setFontWeight("bold").setHorizontalAlignment("center");
      sheet.getRange(lastRow, 16).setFontWeight("bold").setNumberFormat("#,##0 ₴");
      sheet.getRange(lastRow, 17).setNumberFormat("#,##0 ₴");
      sheet.getRange(lastRow, 18, 1, 2).setNumberFormat("#,##0 ₴");
      if (lastRow % 2 === 0) rr.setBackground("#F8F6F2");
    });
    if (lastRow <= 6) sheet.autoResizeColumns(1, 25);

    return ContentService.createTextOutput(JSON.stringify({ status: "ok", order_number: data.order_number, row: lastRow })).setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({ status: "error", message: error.toString() })).setMimeType(ContentService.MimeType.JSON);
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

/**
 * Послідовний номер замовлення ORD-ДДММРР-NNN (v2.4).
 * NNN — порядковий у межах поточного місяця (Europe/Kiev), обнуляється 1-го числа.
 * Лічильник у PropertiesService; атомарність забезпечує LockService у doPost.
 */
function nextOrderNumber() {
  const tz = "Europe/Kiev";
  const now = new Date();
  const ddmmyy = Utilities.formatDate(now, tz, "ddMMyy");
  const mmyy = Utilities.formatDate(now, tz, "MMyy");
  const props = PropertiesService.getScriptProperties();
  const storedMonth = props.getProperty("ord_month");
  let counter = parseInt(props.getProperty("ord_counter") || "0", 10);
  if (storedMonth !== mmyy) counter = 0; // новий місяць — обнулення
  counter += 1;
  props.setProperty("ord_month", mmyy);
  props.setProperty("ord_counter", String(counter));
  return "ORD-" + ddmmyy + "-" + String(counter).padStart(3, "0");
}

function setupSheet(sheet) {
  const headers = [
    "№ Замовлення","Дата/час","Статус","Клієнт","Телефон","Місто",
    "Тип кошика","Конструкція","Колір","Візерунок",
    "W (мм)","H (мм)","D (мм)","Кількість","Площа (м²)",
    "Вартість","Передоплата 50%","Собівартість","Прибуток",
    "Доставка","Адреса","Дата доставки","Оплата","Як дізнались","Примітки",
    "Бренд кондиц.","Модель кондиц.","Джерело"
  ];
  sheet.appendRow(headers);

  const hr = sheet.getRange(1, 1, 1, headers.length);
  hr.setFontWeight("bold").setBackground("#1B4332").setFontColor("#C9A84C");
  hr.setHorizontalAlignment("center").setVerticalAlignment("middle").setWrap(true).setFontSize(10);
  sheet.setRowHeight(1, 40);
  sheet.setFrozenRows(1);

  // Ширина колонок
  [160,140,100,180,140,120,160,120,120,100,70,70,70,70,80,120,120,120,180,100,120,130,200].forEach((w,i) => sheet.setColumnWidth(i+1, w));

  // Випадаючий список статусів
  const rule = SpreadsheetApp.newDataValidation()
    .requireValueInList(["Нове","В роботі","Готове","Відправлено","Завершено","Скасовано"])
    .setAllowInvalid(false).build();
  sheet.getRange(2, 3, 500, 1).setDataValidation(rule);

  // Умовне форматування статусів
  const sr = sheet.getRange("C2:C500");
  const cfRules = [
    {t:"Нове",bg:"#FFF3CD",fg:"#856404"}, {t:"В роботі",bg:"#CCE5FF",fg:"#004085"},
    {t:"Готове",bg:"#D4EDDA",fg:"#155724"}, {t:"Відправлено",bg:"#D1ECF1",fg:"#0C5460"},
    {t:"Завершено",bg:"#E2E3E5",fg:"#383D41"}, {t:"Скасовано",bg:"#F8D7DA",fg:"#721C24"}
  ].map(r => SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo(r.t).setBackground(r.bg).setFontColor(r.fg).setBold(true).setRanges([sr]).build());
  sheet.setConditionalFormatRules(cfRules);
}

/**
 * Задача 3 — реєстр джерел і облік комісій.
 * Аркуш «Джерела»: КОД → ставка, к-сть замовлень (COUNTIF по колонці «Джерело»
 * аркуша «Замовлення», col AB) і нараховано (Замовлень × Ставка).
 * Комісія рахується за фактом замовлення, не за перехід.
 * Запустити вручну один раз АБО створиться автоматично при першому замовленні.
 */
function setupSourcesSheet(ss) {
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName("Джерела");
  if (sheet) return sheet; // наявний не перезаписуємо
  sheet = ss.insertSheet("Джерела");

  const headers = ["КОД","Тип","Адреса/назва","Відповідальний","Контакт","Ставка, грн","Замовлень","Нараховано"];
  sheet.appendRow(headers);
  const hr = sheet.getRange(1, 1, 1, headers.length);
  hr.setFontWeight("bold").setBackground("#1B4332").setFontColor("#C9A84C")
    .setHorizontalAlignment("center").setVerticalAlignment("middle").setWrap(true).setFontSize(10);
  sheet.setRowHeight(1, 40);
  sheet.setFrozenRows(1);
  [160, 90, 220, 160, 140, 110, 100, 120].forEach(function (w, i) { sheet.setColumnWidth(i + 1, w); });

  // Приклад-рядок + формули (Джерело в «Замовлення» — колонка AB).
  sheet.appendRow(["OSBB-Lvivska12", "ОСББ", "вул. Львівська 12", "[ПІБ]", "[тел]", 200, "", ""]);
  sheet.getRange("G2").setFormula("=COUNTIF('Замовлення'!$AB:$AB, $A2)");
  sheet.getRange("H2").setFormula("=G2*F2");
  sheet.getRange("F2:F").setNumberFormat("#,##0 \"грн\"");
  sheet.getRange("H2:H").setNumberFormat("#,##0 ₴");
  return sheet;
}

function doGet(e) {
  return ContentService.createTextOutput(JSON.stringify({status:"ok",message:"Avalon v2.0"})).setMimeType(ContentService.MimeType.JSON);
}
