/**
 * Google Apps Script — Webhook v2.1 для Avalon Order Form
 * Узгоджено зі структурою аркуша «Замовлення» (30 колонок A–AD):
 *   A №Замовлення B Дата/час C Статус D Клієнт E Телефон F Місто
 *   G Тип H Конструкція I Колір J Візерунок K W L H M D N Кількість O Площа
 *   P Собів.1шт Q Собів.заг R Ціна продажу 1шт S Виручка T Валовий прибуток U Маржа %
 *   V Доставка W Адреса X Дата доставки Y Оплата Z Як дізнались AA Примітки
 *   AB Бренд AC Модель AD Джерело
 *
 * ОНОВЛЕННЯ: заміни весь код на цей → Зберегти → запусти один раз setupAll()
 * → Ввести в дію → Керувати введеннями → Нова версія → Ввести в дію.
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
    data.order_number = nextOrderNumber(); // послідовний № ORD-ДДММРР-NNN (авторитетно)

    // Позиції: кілька кошиків (data.items) або один кошик (старий формат). Один рядок на кошик.
    const MARKUP = 1 / (1 - 0.2593); // ~1.3503 — та сама націнка, що у формі
    const itemsIn = (Array.isArray(data.items) && data.items.length) ? data.items : [{
      basket_type: data.basket_type, construction_type: data.construction_type,
      color: data.color, color_custom: data.color_custom, pattern: data.pattern, pattern_custom: data.pattern_custom,
      size_w: data.size_w, size_h: data.size_h, size_d: data.size_d, quantity: data.quantity,
      ac_brand: data.ac_brand, ac_model: data.ac_model,
      price_total: data.price_total, area_m2: data.area_m2, cost_total: data.cost_total, profit: data.profit
    }];
    const dateStr = Utilities.formatDate(new Date(), "Europe/Kiev", "dd.MM.yyyy HH:mm");
    let lastRow = sheet.getLastRow();

    itemsIn.forEach(function (it) {
      const w = Number(it.size_w) || 0, h = Number(it.size_h) || 0, d = Number(it.size_d) || 0;
      const qty = Number(it.quantity) || 1;
      let areaM2 = 0, total = 0, costTotal = 0, hasMoney = false;
      if (it.price_total != null) {
        total = Math.round(Number(it.price_total));
        areaM2 = it.area_m2 != null ? Number(it.area_m2) : 0;
        costTotal = it.cost_total != null ? Math.round(Number(it.cost_total)) : Math.round(total / MARKUP);
        hasMoney = total > 0;
      } else if (w && h) {
        areaM2 = (w * h + 2 * d * h) / 1000000;
        let ppm2 = (it.construction_type || "").toLowerCase().indexOf("розбірний") >= 0 ? 2170 : 2030;
        ppm2 = Math.round(ppm2 * MARKUP);
        if ((it.basket_type || "").toLowerCase().indexOf("антивандал") >= 0) ppm2 = Math.round(ppm2 * 1.35);
        if (it.pattern && ["K3","K4","K6","K8","K9"].indexOf(it.pattern) >= 0) ppm2 = Math.round(ppm2 * 1.15);
        total = Math.round(areaM2 * ppm2) * qty;
        costTotal = Math.round(total / MARKUP);
        hasMoney = total > 0;
      }
      // Похідні фінансові показники (порожньо, якщо ціни ще нема — режим «розрахує менеджер»)
      const profit    = hasMoney ? total - costTotal : "";
      const costUnit  = hasMoney ? Math.round(costTotal / qty) : "";
      const priceUnit = hasMoney ? Math.round(total / qty) : "";
      const revenue   = hasMoney ? total : "";
      const margin    = hasMoney ? Math.round((total - costTotal) / total * 1000) / 10 : ""; // %

      const row = [
        data.order_number || "", dateStr, "Нове",                                      // A-C
        (data.first_name || "") + " " + (data.last_name || ""),                        // D Клієнт
        (data.phone ? "'" + data.phone : ""), data.city || "",                         // E-F Телефон(текст), Місто
        it.basket_type || "", it.construction_type || "",                              // G-H
        it.color || (it.color_custom || ""), it.pattern || (it.pattern_custom || ""),  // I-J
        w || "", h || "", d || "", qty,                                                // K-N
        areaM2 ? Number(areaM2.toFixed(2)) : "",                                        // O Площа
        costUnit, costTotal || "", priceUnit, revenue, profit, margin,                 // P-U
        data.transport || (data.transport_custom || ""),                              // V Доставка
        data.delivery_address || "",                                                   // W Адреса
        data.delivery_date || "",                                                      // X Дата доставки
        data.payment_method || "",                                                     // Y Оплата
        data.how_found || (data.how_found_custom || ""),                              // Z Як дізнались
        data.notes || "",                                                              // AA Примітки
        it.ac_brand || "", it.ac_model || "",                                          // AB-AC Бренд, Модель
        data.referral_source || "direct"                                               // AD Джерело
      ];
      sheet.appendRow(row);
      lastRow = sheet.getLastRow();
      const rr = sheet.getRange(lastRow, 1, 1, row.length);
      rr.setVerticalAlignment("middle").setWrap(true);
      sheet.getRange(lastRow, 1).setFontWeight("bold");
      sheet.getRange(lastRow, 3).setBackground("#FFF3CD").setFontColor("#856404").setFontWeight("bold").setHorizontalAlignment("center");
      // Грошові колонки P–T (16–20) = ₴; U Маржа (21) = %
      sheet.getRange(lastRow, 16, 1, 5).setNumberFormat("#,##0 ₴");
      sheet.getRange(lastRow, 21).setNumberFormat('0.0"%"');
      sheet.getRange(lastRow, 18).setFontWeight("bold"); // Ціна продажу 1шт — акцент
      if (lastRow % 2 === 0) rr.setBackground("#F8F6F2");
    });

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

// Заголовки аркуша «Замовлення» (30 колонок A–AD).
function setupSheet(sheet) {
  const headers = [
    "№ Замовлення","Дата/час","Статус","Клієнт","Телефон","Місто",
    "Тип кошика","Конструкція","Колір","Візерунок",
    "W (мм)","H (мм)","D (мм)","Кількість","Площа (м²)",
    "Собівартість 1шт","Собівартість заг,","Ціна продажу 1шт","Виручка","Валовий прибуток","Маржа %",
    "Доставка","Адреса","Дата доставки","Оплата","Як дізнались","Примітки",
    "Бренд кондиц.","Модель кондиц.","Джерело"
  ];
  // Достатньо колонок у аркуші
  if (sheet.getMaxColumns() < headers.length) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), headers.length - sheet.getMaxColumns());
  }
  // Ідемпотентно: перезаписуємо рядок 1 (працює і для нового, і для наявного аркуша; рядки даних не чіпає).
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);

  const hr = sheet.getRange(1, 1, 1, headers.length);
  hr.setFontWeight("bold").setBackground("#1B4332").setFontColor("#C9A84C");
  hr.setHorizontalAlignment("center").setVerticalAlignment("middle").setWrap(true).setFontSize(10);
  sheet.setRowHeight(1, 42);
  sheet.setFrozenRows(1);

  // Ширина колонок під обсяг даних
  const widths = [130,130,90,150,130,110,180,160,130,90,60,60,60,80,80,110,110,110,110,110,80,150,210,110,150,170,210,130,160,120];
  widths.forEach(function (w, i) { sheet.setColumnWidth(i + 1, w); });

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
  ].map(function (r) { return SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo(r.t).setBackground(r.bg).setFontColor(r.fg).setBold(true).setRanges([sr]).build(); });
  sheet.setConditionalFormatRules(cfRules);
}

/**
 * Задача 3 — реєстр джерел і облік комісій.
 * Аркуш «Джерела»: КОД → ставка, к-сть замовлень (COUNTIF по «Джерело» аркуша
 * «Замовлення» — col AD) і нараховано (Замовлень × Ставка). Комісія за фактом замовлення.
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

  // Приклад-рядок + формули (Джерело в «Замовлення» — колонка AD; роздільник ';' для локалі uk_UA).
  sheet.appendRow(["OSBB-Lvivska12", "ОСББ", "вул. Львівська 12", "[ПІБ]", "[тел]", 200, "", ""]);
  sheet.getRange("G2").setFormula("=COUNTIF('Замовлення'!$AD:$AD; $A2)");
  sheet.getRange("H2").setFormula("=G2*F2");
  sheet.getRange("F2:F").setNumberFormat("#,##0 \"грн\"");
  sheet.getRange("H2:H").setNumberFormat("#,##0 ₴");
  return sheet;
}

/**
 * Разове налаштування: вирівнює заголовки/ширини наявного аркуша «Замовлення»
 * (додає Бренд/Модель/Джерело, не чіпаючи дані) і перестворює аркуш «Джерела».
 * Запусти ОДИН раз із редактора після вставлення коду.
 */
function setupAll() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const orders = ss.getSheetByName("Замовлення");
  if (orders) setupSheet(orders);
  const src = ss.getSheetByName("Джерела");
  if (src) ss.deleteSheet(src);
  setupSourcesSheet(ss);
}

function doGet(e) {
  return ContentService.createTextOutput(JSON.stringify({status:"ok",message:"Avalon v2.1"})).setMimeType(ContentService.MimeType.JSON);
}
