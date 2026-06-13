/**
 * Google Apps Script — Webhook v2.0 для Avalon Order Form
 * З номером замовлення, стильним оформленням, статусами
 * 
 * ОНОВЛЕННЯ: заміни весь код у Apps Script на цей,
 * потім: Ввести в дію → Керувати введеннями → Оновити
 */

function doPost(e) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName("Замовлення");
    if (!sheet) {
      sheet = ss.insertSheet("Замовлення");
      setupSheet(sheet);
    }
    if (sheet.getLastRow() === 0) setupSheet(sheet);

    const data = JSON.parse(e.postData.contents);

    // Розрахунок ціни. Єдине джерело правди — числа, пораховані формою (форма = Telegram = Sheets).
    const w = Number(data.size_w) || 0, h = Number(data.size_h) || 0, d = Number(data.size_d) || 0;
    const qty = Number(data.quantity) || 1;
    const MARKUP = 1 / (1 - 0.2593); // ~1.3503 — та сама націнка, що у формі
    let areaM2 = 0, total = 0, costTotal = "", profit = "", prepay = "";
    if (data.price_total != null) {
      total = Math.round(Number(data.price_total));                                   // клієнтська ціна
      areaM2 = data.area_m2 != null ? Number(data.area_m2) : 0;
      costTotal = data.cost_total != null ? Math.round(Number(data.cost_total)) : "";
      profit = data.profit != null ? Math.round(Number(data.profit)) : "";
      prepay = data.prepayment != null ? Math.round(Number(data.prepayment)) : (total ? Math.round(total * 0.5) : "");
    } else if (w && h) {
      // Фолбек для старих замовлень: рахуємо клієнтську ціну тією ж формулою.
      areaM2 = (w * h + 2 * d * h) / 1000000;
      let ppm2 = (data.construction_type||"").toLowerCase().indexOf("розбірний") >= 0 ? 2170 : 2030;
      ppm2 = Math.round(ppm2 * MARKUP);
      if ((data.basket_type||"").toLowerCase().indexOf("антивандал") >= 0) ppm2 = Math.round(ppm2 * 1.35);
      if (data.pattern && ["K3","K4","K6","K8","K9"].indexOf(data.pattern) >= 0) ppm2 = Math.round(ppm2 * 1.15);
      total = Math.round(areaM2 * ppm2) * qty;
      costTotal = Math.round(total / MARKUP);
      profit = total - costTotal;
      prepay = total ? Math.round(total * 0.5) : "";
    }

    const dateStr = Utilities.formatDate(new Date(), "Europe/Kiev", "dd.MM.yyyy HH:mm");

    const row = [
      data.order_number || "",
      dateStr,
      "Нове",
      (data.first_name || "") + " " + (data.last_name || ""),
      data.phone || "",
      data.city || "",
      data.basket_type || "",
      data.construction_type || "",
      data.color || (data.color_custom || ""),
      data.pattern || (data.pattern_custom || ""),
      w || "", h || "", d || "",
      qty,
      areaM2 ? areaM2.toFixed(2) : "",
      total || "",
      prepay,
      costTotal,
      profit,
      data.transport || (data.transport_custom || ""),
      data.delivery_address || "",
      data.delivery_date || "",
      data.payment_method || "",
      data.how_found || (data.how_found_custom || ""),
      data.notes || ""
    ];

    sheet.appendRow(row);
    const lastRow = sheet.getLastRow();

    // Стилі нового рядка
    const rr = sheet.getRange(lastRow, 1, 1, row.length);
    rr.setVerticalAlignment("middle").setWrap(true);
    sheet.getRange(lastRow, 1).setFontWeight("bold");
    sheet.getRange(lastRow, 3).setBackground("#FFF3CD").setFontColor("#856404").setFontWeight("bold").setHorizontalAlignment("center");
    sheet.getRange(lastRow, 16).setFontWeight("bold").setNumberFormat("#,##0 ₴");
    sheet.getRange(lastRow, 17).setNumberFormat("#,##0 ₴");
    sheet.getRange(lastRow, 18, 1, 2).setNumberFormat("#,##0 ₴"); // Собівартість, Прибуток
    if (lastRow % 2 === 0) rr.setBackground("#F8F6F2");
    if (lastRow <= 5) sheet.autoResizeColumns(1, row.length);

    return ContentService.createTextOutput(JSON.stringify({ status: "ok", row: lastRow })).setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({ status: "error", message: error.toString() })).setMimeType(ContentService.MimeType.JSON);
  }
}

function setupSheet(sheet) {
  const headers = [
    "№ Замовлення","Дата/час","Статус","Клієнт","Телефон","Місто",
    "Тип кошика","Конструкція","Колір","Візерунок",
    "W (мм)","H (мм)","D (мм)","Кількість","Площа (м²)",
    "Вартість","Передоплата 50%","Собівартість","Прибуток",
    "Доставка","Адреса","Дата доставки","Оплата","Як дізнались","Примітки"
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

function doGet(e) {
  return ContentService.createTextOutput(JSON.stringify({status:"ok",message:"Avalon v2.0"})).setMimeType(ContentService.MimeType.JSON);
}
