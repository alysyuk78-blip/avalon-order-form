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

// Календар для подій доставки. Шукаємо за словом у назві (без регістру); якщо немає — дефолтний.
var CAL_KEY = "AVALON";

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
    // У групу підрядника замовлення НЕ йде автоматично — лише коли менеджер
    // поставить статус «В роботі» (див. onEditDelivery). Так підрядник не бачить
    // попередніх/неопрацьованих запитів.

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

/** Календар «Замовлення AVALON» (за назвою-підрядком); якщо немає — дефолтний. */
function getCal() {
  try {
    var key = CAL_KEY.toLowerCase();
    var all = CalendarApp.getAllCalendars();
    for (var i = 0; i < all.length; i++) {
      if (all[i].getName().toLowerCase().indexOf(key) >= 0) return all[i];
    }
  } catch (e) {}
  return CalendarApp.getDefaultCalendar();
}

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

    var cal = getCal();
    var ev = cal.createEvent(title, start, end, { description: desc });
    ev.removeAllReminders();
    ev.addPopupReminder(0);          // у день події, о 08:30
    ev.addPopupReminder(2 * 24 * 60); // за 2 дні, о 08:30
    ev.addEmailReminder(0);
    ev.addEmailReminder(2 * 24 * 60);
    // Запамʼятовуємо ID події за номером замовлення — щоб оновлювати при зміні дати в таблиці
    PropertiesService.getScriptProperties().setProperty("evt_" + (order.order_number || ""), ev.getId());
  } catch (err) {
    console.error("Calendar error: " + err);
  }
}

/**
 * Тригер onEdit (встановлюваний): при ручній зміні «Дати доставки» (колонка AC)
 * у аркуші «Замовлення» — оновлює дату події в Google Календарі та синхронізує
 * дату в усіх рядках цього ж замовлення. Встанови один раз через installTrigger().
 */
function onEditDelivery(e) {
  try {
    var range = e.range, sh = range.getSheet();
    if (sh.getName() !== SHEET_ORDERS) return;
    if (range.getRow() < 2) return;
    var col = range.getColumn();

    // Статус «В роботі» → передати замовлення підряднику (тема + специфікація), один раз.
    if (col === 3) {
      if (String(range.getValue() || "").trim() === "В роботі") {
        var onum = sh.getRange(range.getRow(), 1).getValue();
        if (onum && !PropertiesService.getScriptProperties().getProperty("thread_" + onum)) {
          var ord = buildOrderFromRows_(sh, onum);
          if (ord) { try { createOrderTopic_(ord); } catch (er) { console.error("Send to contractor: " + er); } }
        }
      }
      return;
    }

    if (col !== 29) return; // далі — лише «Дата доставки» (AC)
    var row = range.getRow();
    var orderNumber = sh.getRange(row, 1).getValue();
    if (!orderNumber) return;
    var iso = toISODate(range.getValue());

    var cal = getCal();
    var id = PropertiesService.getScriptProperties().getProperty("evt_" + orderNumber);
    var ev = id ? cal.getEventById(id) : null;

    if (!iso) { // дату очистили — видаляємо подію
      if (ev) { ev.deleteEvent(); PropertiesService.getScriptProperties().deleteProperty("evt_" + orderNumber); }
      return;
    }
    var p = iso.split("-");
    var start = new Date(+p[0], +p[1] - 1, +p[2], 8, 30, 0);
    var end = new Date(+p[0], +p[1] - 1, +p[2], 9, 0, 0);

    if (ev) {
      ev.setTime(start, end); // нагадування (за 2 дні / в день) зсунуться автоматично
    } else {
      addDeliveryEvent({
        order_number: orderNumber,
        first_name: sh.getRange(row, 5).getValue(), last_name: "",
        phone: sh.getRange(row, 6).getValue(), city: sh.getRange(row, 7).getValue(),
        transport: sh.getRange(row, 27).getValue(), delivery_address: sh.getRange(row, 28).getValue(),
        referral_source: sh.getRange(row, 4).getValue(), delivery_date: iso
      });
    }

    // Синхронізувати дату в усіх рядках того самого замовлення
    var col = sh.getRange(2, 1, Math.max(sh.getLastRow() - 1, 1), 1).getValues();
    for (var i = 0; i < col.length; i++) {
      var rr = i + 2;
      if (col[i][0] === orderNumber && rr !== row) sh.getRange(rr, 29).setValue(range.getValue());
    }
  } catch (err) { console.error("onEditDelivery: " + err); }
}

function toISODate(v) {
  if (v instanceof Date) {
    return v.getFullYear() + "-" + ("0" + (v.getMonth() + 1)).slice(-2) + "-" + ("0" + v.getDate()).slice(-2);
  }
  var s = String(v || "").trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  var m = s.match(/^(\d{2})\.(\d{2})\.(\d{4})/); // dd.MM.yyyy
  if (m) return m[3] + "-" + m[2] + "-" + m[1];
  return "";
}

/** Встанови один раз: створює тригер onEdit для синхронізації дат із календарем. */
function installTrigger() {
  var trg = ScriptApp.getProjectTriggers();
  for (var i = 0; i < trg.length; i++) {
    if (trg[i].getHandlerFunction() === "onEditDelivery") ScriptApp.deleteTrigger(trg[i]);
  }
  ScriptApp.newTrigger("onEditDelivery").forSpreadsheet(SpreadsheetApp.getActiveSpreadsheet()).onEdit().create();
}

// ===================== TELEGRAM-НАГАДУВАННЯ ПІДРЯДНИКУ =====================
//
// Бот сам пише в Telegram нагадування про дату відправки/доставки, щоб
// підрядник не забув виготовити й надіслати вчасно. Працює за щоденним
// тригером о 08:30 (див. installReminderTrigger).
//
// НАЛАШТУВАННЯ (один раз):
//   1) Встав токен і chat_id у setTelegram() нижче → запусти setTelegram() →
//      прибери значення назад на "" і збережи.
//   2) Запусти installReminderTrigger() один раз (створить щоденний тригер 08:30).
//   3) Перевір: Налаштування проєкту → Часовий пояс = (GMT+02:00) Київ.
//
// За скільки днів до дати слати (0 = у сам день). Хочеш лише 2 — постав [2, 0].
var REMIND_BEFORE = [2, 1, 0];
var REMIND_DONE = ["Відправлено", "Завершено", "Скасовано"]; // такі замовлення не нагадуємо

/** ОДИН раз: встав значення, запусти, потім прибери назад на "" (вони вже збережені). */
function setTelegram() {
  var TOKEN = "";              // ← токен бота (той самий, що у Vercel TELEGRAM_BOT_TOKEN)
  var CONTRACTOR_CHAT_ID = ""; // ← chat_id ГРУПИ з підрядником (з увімкненими Темами), напр. -1001234567890
  var OWNER_CHAT_ID = "";      // ← (необов'язково) запасний чат, якщо групи підрядника немає
  var p = PropertiesService.getScriptProperties();
  if (TOKEN) p.setProperty("TG_TOKEN", TOKEN);
  if (CONTRACTOR_CHAT_ID) p.setProperty("TG_CONTRACTOR_CHAT", CONTRACTOR_CHAT_ID);
  if (OWNER_CHAT_ID) p.setProperty("TG_CHAT", OWNER_CHAT_ID);
  Logger.log("Telegram: token=" + (p.getProperty("TG_TOKEN") ? "збережено" : "НЕМАЄ") +
             ", група підрядника=" + (p.getProperty("TG_CONTRACTOR_CHAT") || "НЕМАЄ") +
             ", запасний чат=" + (p.getProperty("TG_CHAT") || "НЕМАЄ"));
}

// Базовий виклик Telegram Bot API. Повертає розпарсену відповідь або null.
function tgApi_(method, payload) {
  var token = PropertiesService.getScriptProperties().getProperty("TG_TOKEN");
  if (!token) { console.error("Telegram не налаштовано — запусти setTelegram()"); return null; }
  var res = UrlFetchApp.fetch("https://api.telegram.org/bot" + token + "/" + method, {
    method: "post", contentType: "application/json", muteHttpExceptions: true,
    payload: JSON.stringify(payload)
  });
  try { return JSON.parse(res.getContentText()); } catch (e) { return null; }
}

// Надіслати повідомлення в чат і (опційно) в конкретну тему (гілку).
function tgSendTo_(chatId, text, threadId) {
  if (!chatId) { console.error("Немає chat_id для надсилання"); return null; }
  var payload = { chat_id: chatId, text: text, parse_mode: "HTML", disable_web_page_preview: true };
  if (threadId) payload.message_thread_id = Number(threadId);
  return tgApi_("sendMessage", payload);
}

function esc_(s) {
  return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function money_(v) { return String(Math.round(Number(v) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, " "); }
function fmtDate_(v) { var s = toISODate(v); if (!s) return ""; var p = s.split("-"); return p[2] + "." + p[1] + "." + p[0]; }
function nowKyiv_() {
  var tz = "Europe/Kiev", now = new Date();
  var wd = { 1: "Пн", 2: "Вт", 3: "Ср", 4: "Чт", 5: "Пт", 6: "Сб", 7: "Нд" }[Number(Utilities.formatDate(now, tz, "u"))] || "";
  return wd + " " + Utilities.formatDate(now, tz, "dd.MM.yyyy, HH:mm");
}

/**
 * Створює в групі підрядника тему (гілку) з назвою = номер замовлення,
 * постить туди специфікацію і запам'ятовує message_thread_id (для нагадувань).
 * Якщо групу не налаштовано — нічого не робить. Помилки не валять замовлення.
 */
function createOrderTopic_(data) {
  var p = PropertiesService.getScriptProperties();
  var chat = p.getProperty("TG_CONTRACTOR_CHAT");
  if (!p.getProperty("TG_TOKEN") || !chat) return; // підрядницький чат не налаштовано
  var num = String(data.order_number || "").trim();
  if (num && p.getProperty("thread_" + num)) return; // вже надсилали — не дублюємо
  var threadId = null;
  var r = tgApi_("createForumTopic", { chat_id: chat, name: num || "Замовлення" });
  if (r && r.ok && r.result && r.result.message_thread_id) threadId = r.result.message_thread_id;
  // якщо Теми вимкнені / бот не адмін — threadId лишиться null, повідомлення піде в загальний чат
  var sent = tgSendTo_(chat, buildProductionMsg_(data), threadId);
  // Маркер ставимо ЛИШЕ при успіху — інакше тимчасовий збій назавжди заблокував би повтор
  if (num && sent && sent.ok) p.setProperty("thread_" + num, threadId ? String(threadId) : "0"); // "0" = надіслано без теми
}

/** Збирає всі рядки одного замовлення в обʼєкт data (для надсилання підряднику з таблиці). */
function buildOrderFromRows_(sh, orderNumber) {
  var last = sh.getLastRow();
  if (last < 2) return null;
  var vals = sh.getRange(2, 1, last - 1, 32).getValues();
  var order = null;
  for (var i = 0; i < vals.length; i++) {
    var r = vals[i];
    if (String(r[0]).trim() !== String(orderNumber).trim()) continue;
    if (!order) {
      order = {
        order_number: r[0], first_name: r[4], last_name: "",
        phone: String(r[5] || "").replace(/^'/, ""), city: r[6], referral_source: r[3],
        transport: r[26], delivery_address: r[27],
        delivery_date: toISODate(r[28]), payment_method: r[29], notes: r[31], items: []
      };
    }
    order.items.push({
      basket_type: r[7], construction_type: r[8], color: r[9], pattern: r[10],
      ac_brand: r[11], ac_model: r[12], size_w: r[13], size_h: r[14], size_d: r[15],
      quantity: r[16], area_m2: r[17], cost_total: r[19]
    });
  }
  return order;
}

/** Повідомлення-специфікація для підрядника (4 секції) — дзеркало формату з api/order.js. */
function buildProductionMsg_(data) {
  var items = (Array.isArray(data.items) && data.items.length) ? data.items : [{
    basket_type: data.basket_type, construction_type: data.construction_type,
    color: data.color, color_custom: data.color_custom, pattern: data.pattern, pattern_custom: data.pattern_custom,
    size_w: data.size_w, size_h: data.size_h, size_d: data.size_d, quantity: data.quantity,
    ac_brand: data.ac_brand, ac_model: data.ac_model, area_m2: data.area_m2, cost_total: data.cost_total
  }];
  var multi = items.length > 1;
  function perM2(it) { var q = Number(it.quantity) || 1, a = Number(it.area_m2) || 0, c = Number(it.cost_total) || 0; return (a > 0 && q > 0 && c > 0) ? Math.round(c / (a * q)) : 0; }

  var m = "📌 <b>Замовлення №" + esc_(data.order_number) + "</b>\n";
  m += "🕐 " + nowKyiv_() + "\n";

  m += "\n👤 <b>ЗАМОВНИК</b>\n";
  m += esc_(((data.first_name || "") + " " + (data.last_name || "")).trim()) + "\n";
  if (data.phone) m += "📞 " + esc_(data.phone) + "\n";
  if (data.city) m += "🏙 " + esc_(data.city) + "\n";

  m += "\n🏭 <b>ВИРОБНИЦТВО</b>\n";
  items.forEach(function (it, i) {
    var color = it.color ? esc_(it.color) + (it.color_custom ? " (" + esc_(it.color_custom) + ")" : "") : "";
    var pattern = it.pattern ? esc_(it.pattern) + (it.pattern_custom ? " (" + esc_(it.pattern_custom) + ")" : "") : "";
    if (multi) m += "\n🧺 <b>Кошик " + (i + 1) + "</b>\n";
    m += "• Тип: <b>" + esc_(it.basket_type) + "</b>\n";
    m += "• Конструкція: <b>" + esc_(it.construction_type) + "</b>\n";
    if (color) m += "• Колір: <b>" + color + "</b>\n";
    if (pattern) m += "• Візерунок: <b>" + pattern + "</b>\n";
    if (it.ac_brand || it.ac_model) m += "• Кондиціонер: <b>" + esc_([it.ac_brand, it.ac_model].filter(function (x) { return x; }).join(" ")) + "</b>\n";
    if (Number(it.size_w) > 0) {
      m += "• Розміри (мм):\n   Висота — <b>" + it.size_h + "</b>\n   Ширина — <b>" + it.size_w + "</b>\n   Глибина — <b>" + it.size_d + "</b>\n";
    } else {
      m += "• Розміри: <i>розрахує менеджер</i>\n";
    }
    m += "• Кількість: <b>" + (Number(it.quantity) || 1) + " шт.</b>\n";
  });

  m += "\n💰 <b>ФІНАНСИ</b>\n";
  var grand = 0;
  if (multi) {
    items.forEach(function (it, i) {
      var a = Number(it.area_m2) || 0, c = Number(it.cost_total) || 0, pp = perM2(it); grand += c;
      if (c > 0) m += "• Кошик " + (i + 1) + ": " + (a ? a.toFixed(2) + " м² × " + money_(pp) + " ₴ = " : "") + "<b>" + money_(c) + " ₴</b>\n";
    });
    if (grand > 0) m += "• <b>Разом виробнича: " + money_(grand) + " ₴</b>\n";
  } else {
    var it = items[0], a = Number(it.area_m2) || 0, c = Number(it.cost_total) || 0, pp = perM2(it);
    if (a > 0) m += "• Площа виробу: <b>" + a.toFixed(2) + "</b> м²\n";
    if (pp > 0) m += "• Ціна за 1 м²: <b>" + money_(pp) + " ₴</b>\n";
    if (c > 0) m += "• Вартість виробнича: <b>" + money_(c) + " ₴</b>\n";
  }
  if (data.payment_method) m += "• Оплата: <b>" + esc_(data.payment_method) + "</b>\n";

  m += "\n🚚 <b>ДОСТАВКА</b>\n";
  var transport = data.transport === "Інше" ? (data.transport_custom || "") : (data.transport || "");
  if (transport) m += "• Спосіб: <b>" + esc_(transport) + "</b>\n";
  if (data.delivery_address) m += "• Адреса: " + esc_(data.delivery_address) + "\n";
  if (data.delivery_date) m += "• Дата: <b>" + fmtDate_(data.delivery_date) + "</b>\n";
  if (data.notes) m += "• Примітка: " + esc_(data.notes) + "\n";

  m += "\n🔖 Джерело заявки: " + esc_(data.referral_source || "direct") + "\n";
  return m;
}
function ymd_(d, tz) { return Utilities.formatDate(d, tz, "yyyy-MM-dd"); }
function dayDiff_(isoFrom, isoTo) { // isoTo − isoFrom, у днях (через UTC-північ — без DST-сюрпризів)
  var a = new Date(isoFrom + "T00:00:00Z").getTime();
  var b = new Date(isoTo + "T00:00:00Z").getTime();
  return Math.round((b - a) / 86400000);
}
function daysWord_(n) { return (n % 10 >= 2 && n % 10 <= 4 && (n < 10 || n > 20)) ? "дні" : "днів"; }

/** Щоденний прохід: знаходить замовлення з датою сьогодні / через N днів і шле нагадування. */
function sendDeliveryReminders() {
  var tz = "Europe/Kiev";
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SHEET_ORDERS);
  if (!sh || sh.getLastRow() < 2) return;
  var rows = sh.getRange(2, 1, sh.getLastRow() - 1, 29).getValues();
  var todayIso = ymd_(new Date(), tz);
  var props = PropertiesService.getScriptProperties();

  // Групуємо рядки за номером замовлення
  var orders = {}, order;
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i], num = String(r[0] || "").trim();
    if (!num) continue;
    var iso = toISODate(r[28]); // AC — Дата доставки
    if (!iso) continue;
    if (!orders[num]) {
      orders[num] = { num: num, iso: iso, done: false, client: r[4], city: r[6],
                      transport: r[26], address: r[27], items: [] };
    }
    order = orders[num];
    if (REMIND_DONE.indexOf(String(r[2] || "").trim()) >= 0) order.done = true; // C — Статус
    order.items.push({ type: r[7], constr: r[8], color: r[9], pattern: r[10],
                       w: r[13], h: r[14], d: r[15], qty: r[16] });
  }

  Object.keys(orders).forEach(function (num) {
    var o = orders[num];
    if (o.done) return;
    var diff = dayDiff_(todayIso, o.iso);
    if (REMIND_BEFORE.indexOf(diff) < 0) return;
    var thread = props.getProperty("thread_" + num); // створюється, коли замовлення передали підряднику
    if (!thread) return; // ще не підтверджене (статус не «В роботі») — не нагадуємо
    var guard = "rem_" + num + "_" + todayIso;
    if (props.getProperty(guard)) return; // вже слали сьогодні
    var chat = props.getProperty("TG_CONTRACTOR_CHAT") || props.getProperty("TG_CHAT");
    tgSendTo_(chat, buildReminder_(o, diff, tz), thread === "0" ? null : thread);
    props.setProperty(guard, "1");
  });
}

function buildReminder_(o, diff, tz) {
  var ddmm = Utilities.formatDate(new Date(o.iso + "T00:00:00Z"), "Etc/UTC", "dd.MM.yyyy");
  var head;
  if (diff === 0) head = "🔴 <b>СЬОГОДНІ відправка / доставка!</b>";
  else if (diff === 1) head = "🟠 <b>ЗАВТРА відправка</b> — " + ddmm;
  else head = "🟡 <b>Нагадування: відправка через " + diff + " " + daysWord_(diff) + "</b> — " + ddmm;

  var msg = head + "\n📌 <b>№" + esc_(o.num) + "</b>";
  if (o.client) msg += "\n👤 " + esc_(o.client) + (o.city ? " (" + esc_(o.city) + ")" : "");
  var multi = o.items.length > 1;
  o.items.forEach(function (it, idx) {
    msg += "\n";
    if (multi) msg += "\n🧺 <b>Кошик " + (idx + 1) + "</b>";
    var spec = [it.type, it.constr, it.color, it.pattern].filter(function (x) { return x; }).map(esc_).join(", ");
    if (spec) msg += "\n• " + spec;
    if (Number(it.w) > 0) msg += "\n• Розміри (мм): В " + it.h + " × Ш " + it.w + " × Г " + it.d;
    msg += "\n• Кількість: <b>" + (Number(it.qty) || 1) + " шт.</b>";
  });
  var transport = o.transport === "Інше" ? "" : (o.transport || "");
  if (transport) msg += "\n\n🚚 " + esc_(transport) + (o.address ? " — " + esc_(o.address) : "");
  msg += "\n📅 Дата: <b>" + ddmm + "</b>";
  msg += "\n\n⚠️ Підрядник, перевір готовність і відправ вчасно.";
  return msg;
}

/** Встанови ОДИН раз: щоденний тригер о 08:30 для sendDeliveryReminders. */
function installReminderTrigger() {
  var trg = ScriptApp.getProjectTriggers();
  for (var i = 0; i < trg.length; i++) {
    if (trg[i].getHandlerFunction() === "sendDeliveryReminders") ScriptApp.deleteTrigger(trg[i]);
  }
  ScriptApp.newTrigger("sendDeliveryReminders").timeBased().atHour(8).nearMinute(30).everyDays(1).create();
  Logger.log("Тригер нагадувань встановлено на ~08:30 щодня.");
}

/** Тест: надсилає нагадування по всіх майбутніх замовленнях зараз (ігнорує час). */
function testReminderNow() {
  sendDeliveryReminders();
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
