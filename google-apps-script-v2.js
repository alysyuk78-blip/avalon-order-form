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
 *     (виручка, собівартість, валовий прибуток, маржа отримана/до отримання,
 *      комісії, витрати, чистий прибуток).
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
var SHEET_SETTLE = "Розрахунки з підрядником";

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
    var patternFileInfo = getPatternFileInfo_(data);

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

      var notes = data.notes || "";
      if (patternFileInfo && patternFileInfo.name) {
        notes = [notes, "Файл візерунку: " + patternFileInfo.name + " (надіслано власнику в Telegram; підряднику переслати вручну)"].filter(function (x) { return x; }).join("\n");
      }

      var row = [
        data.order_number || "", dateStr, "Нове", data.referral_source || "direct",   // A-D №,Дата,Статус,Джерело
        (data.first_name || "") + " " + (data.last_name || ""),                        // E Клієнт
        (data.phone ? "'" + data.phone : ""), data.city || "",                         // F-G Телефон,Місто
        it.basket_type || "", (it.construction_type || "") + (it.has_cover ? " + кришка" : ""),  // H-I (мітка кришки)
        it.color || (it.color_custom || ""), it.pattern || (it.pattern_custom || ""),  // J-K
        it.ac_brand || "", it.ac_model || "",                                          // L-M Бренд,Модель
        w || "", h || "", d || "", qty,                                                // N-Q
        areaM2 ? Number(areaM2.toFixed(2)) : "",                                        // R Площа
        costUnit, costTotal || "", priceUnit, revenue, profit, margin,                 // S-X
        "", "",                                                                        // Y-Z Комісія,Чистий (формули)
        data.transport || (data.transport_custom || ""), data.delivery_address || "",  // AA-AB
        data.delivery_date || "", data.payment_method || "",                           // AC-AD
        data.how_found || (data.how_found_custom || ""), notes                         // AE-AF
      ];
      lastRow = appendOrderRow_(sheet, row);
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

function findLastRealOrderRow_(sheet) {
  var last = Math.max(sheet.getLastRow(), 2);
  if (last < 2) return 1;
  var values = sheet.getRange(2, 1, last - 1, 1).getValues();
  for (var i = values.length - 1; i >= 0; i--) {
    if (/^ORD-\d{6}-\d{3}$/.test(String(values[i][0] || "").trim())) {
      return i + 2;
    }
  }
  return 1;
}

function applyOrderRowControls_(sheet, rowNumber) {
  var statusRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(["Нове","В роботі","Готове","Відправлено","Завершено","Скасовано"]).setAllowInvalid(false).build();
  sheet.getRange(rowNumber, 3).setDataValidation(statusRule);
  var checkboxRule = SpreadsheetApp.newDataValidation().requireCheckbox().build();
  sheet.getRange(rowNumber, 33, 1, 2).setDataValidation(checkboxRule);
}

function appendOrderRow_(sheet, row) {
  var lastRealRow = findLastRealOrderRow_(sheet);
  var targetRow = lastRealRow + 1;
  sheet.insertRowsAfter(lastRealRow, 1);
  sheet.getRange(targetRow, 1, 1, row.length).setValues([row]);
  applyOrderRowControls_(sheet, targetRow);
  return targetRow;
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

// ===================== ФАЙЛ ВІЗЕРУНКУ =====================

function safeFileName_(s) {
  return String(s || "pattern-file").replace(/[^\w.\- а-яА-ЯіїєґІЇЄҐ]/g, "_").slice(0, 120);
}

function getPatternFileInfo_(data) {
  if (data.pattern_file_meta && data.pattern_file_meta.name) {
    return { name: safeFileName_(data.pattern_file_meta.name) };
  }
  if (data.pattern_file && data.pattern_file.name) {
    return { name: safeFileName_(data.pattern_file.name) };
  }
  return null;
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
    if (sh.getName().toLowerCase() !== SHEET_ORDERS.toLowerCase()) return; // без різниці у регістрі назви
    if (range.getRow() < 2) return;
    var col = range.getColumn();

    // Перерахунок фінансів при зміні розмірів/кількості/типу/конструкції/візерунка.
    // H=8, I=9, K=11, N=14, O=15, P=16, Q=17.
    if ([8, 9, 11, 14, 15, 16, 17].indexOf(col) >= 0) {
      for (var ri = 0; ri < range.getNumRows(); ri++) recalcRow_(sh, range.getRow() + ri);
      return;
    }

    // Статус «В роботі» → передати замовлення підряднику (тема + специфікація), один раз.
    if (col === 3) {
      var newStatus = String(range.getValue() || "").trim();
      if (newStatus === "В роботі") {
        var onum = sh.getRange(range.getRow(), 1).getValue();
        if (onum && !PropertiesService.getScriptProperties().getProperty("thread_" + onum)) {
          var ord = buildOrderFromRows_(sh, onum);
          if (ord) {
            try {
              var contractorResult = createOrderTopic_(ord);
              if (!contractorResult || !contractorResult.ok) {
                console.error("Send to contractor: " + telegramError_(contractorResult));
              }
            } catch (er) {
              console.error("Send to contractor: " + er);
              alertOwner_("Замовлення " + onum + " НЕ надіслано підряднику.", String(er));
            }
          }
        }
      }
      notifyOwnerStatusChange_(sh, range.getRow(), newStatus);
      return;
    }

    // AG/AH: оплата клієнта / отримання маржі → коротко сповістити власника.
    if (col === 33 || col === 34) {
      notifyOwnerPaymentChange_(sh, range.getRow(), col, range.getValue() === true);
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

    // Синхронізувати дату в усіх рядках того самого замовлення.
    // Міняємо ЛИШЕ якщо значення відрізняється — інакше setValue знову викликав би
    // цей тригер і рядки зациклилися б (для замовлень із кількох кошиків).
    var allNums = sh.getRange(2, 1, Math.max(sh.getLastRow() - 1, 1), 1).getValues();
    var newVal = range.getValue();
    for (var i = 0; i < allNums.length; i++) {
      var rr = i + 2;
      if (allNums[i][0] === orderNumber && rr !== row) {
        var cell = sh.getRange(rr, 29);
        if (String(cell.getValue()) !== String(newVal)) cell.setValue(newVal);
      }
    }
  } catch (err) { console.error("onEditDelivery: " + err); }
}

/**
 * Перераховує площу/собівартість/ціну/прибуток/маржу для одного рядка
 * за тією ж формулою, що й при створенні замовлення (doPost). Викликається
 * автоматично при зміні розмірів/кількості/типу/конструкції/візерунка.
 * Колонки: R(18) Площа, S(19) Собів.1шт, T(20) Собів.заг, U(21) Ціна1шт,
 *          V(22) Виручка, W(23) Валовий, X(24) Маржа. Y/Z — формули, оновляться самі.
 */
function recalcRow_(sh, row) {
  if (row < 2) return;
  var v = sh.getRange(row, 1, 1, 17).getValues()[0]; // A..Q
  var basket_type = v[7], construction = v[8], pattern = v[10];
  var w = Number(v[13]) || 0, h = Number(v[14]) || 0, d = Number(v[15]) || 0;
  var qty = Number(v[16]) || 1;
  if (!(w && h)) return; // без розмірів не перераховуємо (напр. «розрахує менеджер»)
  var MARKUP = 1 / (1 - 0.2593);
  var areaM2 = (w * h + 2 * d * h) / 1000000;
  var ppm2 = String(construction || "").toLowerCase().indexOf("розбірний") >= 0 ? 2170 : 2030;
  ppm2 = Math.round(ppm2 * MARKUP);
  if (String(basket_type || "").toLowerCase().indexOf("антивандал") >= 0) ppm2 = Math.round(ppm2 * 1.35);
  if (pattern && ["K3", "K4", "K6", "K8", "K9"].indexOf(pattern) >= 0) ppm2 = Math.round(ppm2 * 1.15);
  var total = Math.round(areaM2 * ppm2) * qty;
  var costTotal = Math.round(total / MARKUP);
  var costUnit = Math.round(costTotal / qty);
  var priceUnit = Math.round(total / qty);
  var margin = total ? Math.round((total - costTotal) / total * 1000) / 10 : "";
  // Один setValues на діапазон R..X — щоб не плодити зайвих спрацювань тригера.
  sh.getRange(row, 18, 1, 7).setValues([[Number(areaM2.toFixed(2)), costUnit, costTotal, priceUnit, total, total - costTotal, margin]]);
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
  if (OWNER_CHAT_ID) {
    p.setProperty("TG_OWNER_CHAT", OWNER_CHAT_ID);
    p.setProperty("TG_CHAT", OWNER_CHAT_ID); // legacy fallback
  }
  Logger.log("Telegram: token=" + (p.getProperty("TG_TOKEN") ? "збережено" : "НЕМАЄ") +
             ", група підрядника=" + (p.getProperty("TG_CONTRACTOR_CHAT") || "НЕМАЄ") +
             ", чат власника=" + (p.getProperty("TG_OWNER_CHAT") || p.getProperty("TG_CHAT") || "НЕМАЄ"));
}

// «Сторож»: сповіщає власника, якщо щось пішло не так (через наявний канал /api/alert у Vercel).
var ALERT_URL = "https://avalon-order-form.vercel.app/api/alert";
function alertOwner_(message, details) {
  try {
    UrlFetchApp.fetch(ALERT_URL, {
      method: "post", contentType: "application/json", muteHttpExceptions: true,
      payload: JSON.stringify({ type: "contractor_failed", message: message, details: details || "" })
    });
  } catch (e) { console.error("alertOwner_: " + e); }
}

// Базовий виклик Telegram Bot API. Повертає розпарсену відповідь або null.
function tgApi_(method, payload) {
  var token = PropertiesService.getScriptProperties().getProperty("TG_TOKEN");
  if (!token) return { ok: false, description: "У властивостях скрипта немає TG_TOKEN." };
  var res = UrlFetchApp.fetch("https://api.telegram.org/bot" + token + "/" + method, {
    method: "post", contentType: "application/json", muteHttpExceptions: true,
    payload: JSON.stringify(payload)
  });
  try {
    var parsed = JSON.parse(res.getContentText());
    if (!parsed.description && res.getResponseCode() >= 400) {
      parsed.description = "Telegram HTTP " + res.getResponseCode();
    }
    return parsed;
  } catch (e) {
    return { ok: false, description: "Telegram повернув неочікувану відповідь (HTTP " + res.getResponseCode() + ")." };
  }
}

// Надіслати повідомлення в чат і (опційно) в конкретну тему (гілку).
function tgSendTo_(chatId, text, threadId) {
  if (!chatId) { console.error("Немає chat_id для надсилання"); return null; }
  var payload = { chat_id: chatId, text: text, parse_mode: "HTML", disable_web_page_preview: true };
  if (threadId) payload.message_thread_id = Number(threadId);
  return tgApi_("sendMessage", payload);
}

function getOwnerChat_() {
  var p = PropertiesService.getScriptProperties();
  return p.getProperty("TG_OWNER_CHAT") || p.getProperty("TG_CHAT") || "";
}

function notifyOwner_(text) {
  var chat = getOwnerChat_();
  if (!chat) return { ok: false, description: "У властивостях скрипта немає TG_OWNER_CHAT (або TG_CHAT)." };
  return tgSendTo_(chat, text);
}

function telegramError_(response) {
  if (response && response.ok) return "";
  return response && response.description ? String(response.description) : "Telegram не повернув підтвердження.";
}

/** Ручна перевірка налаштувань Telegram без показу токена. */
function checkOwnerTelegram() {
  var ui = SpreadsheetApp.getUi();
  var p = PropertiesService.getScriptProperties();
  var token = p.getProperty("TG_TOKEN");
  var chat = getOwnerChat_();
  if (!token || !chat) {
    var missing = [];
    if (!token) missing.push("TG_TOKEN");
    if (!chat) missing.push("TG_OWNER_CHAT");
    ui.alert("Telegram не налаштовано", "Відсутні властивості: " + missing.join(", ") + ".", ui.ButtonSet.OK);
    return;
  }
  var me = tgApi_("getMe", {});
  if (!me || !me.ok) {
    ui.alert("Помилка Telegram", telegramError_(me), ui.ButtonSet.OK);
    return;
  }
  var test = notifyOwner_("✅ <b>AVALON: Telegram працює</b>\nЧат власника підключено правильно.");
  if (!test || !test.ok) {
    ui.alert("Бот працює, але чат недоступний", telegramError_(test) + "\n\nПеревір TG_OWNER_CHAT: " + chat, ui.ButtonSet.OK);
    return;
  }
  var username = me.result && me.result.username ? "@" + me.result.username : "бот";
  ui.alert("Успішно", "Telegram підключено: " + username + ".\nТестове повідомлення надіслано.", ui.ButtonSet.OK);
}

function rowSummary_(sh, row) {
  var v = sh.getRange(row, 1, 1, 34).getValues()[0];
  return {
    num: v[0], status: v[2], client: v[4], phone: String(v[5] || "").replace(/^'/, ""),
    city: v[6], deliveryDate: toISODate(v[28]), gross: Number(v[22]) || 0,
    clientPaid: v[32] === true, marginPaid: v[33] === true
  };
}

function notifyOwnerStatusChange_(sh, row, status) {
  if (!status) return;
  var o = rowSummary_(sh, row);
  var msg = "🔔 <b>Статус змінено</b>\n";
  msg += "📌 <b>№" + esc_(o.num) + "</b> → <b>" + esc_(status) + "</b>\n";
  if (o.client) msg += "👤 " + esc_(o.client) + "\n";
  if (o.phone) msg += "📞 " + esc_(o.phone) + "\n";
  if (o.deliveryDate) msg += "📅 " + fmtDate_(o.deliveryDate) + "\n";
  notifyOwner_(msg);
}

function notifyOwnerPaymentChange_(sh, row, col, checked) {
  var o = rowSummary_(sh, row);
  var label = col === 33 ? "Оплата клієнта підряднику" : "Маржу отримано";
  var icon = checked ? "✅" : "↩️";
  var msg = icon + " <b>" + esc_(label) + "</b>: " + (checked ? "так" : "знято") + "\n";
  msg += "📌 <b>№" + esc_(o.num) + "</b>\n";
  if (o.client) msg += "👤 " + esc_(o.client) + "\n";
  if (o.gross) msg += "💰 Валовий: <b>" + money_(o.gross) + " ₴</b>\n";
  notifyOwner_(msg);
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
  if (!p.getProperty("TG_TOKEN") || !chat) {
    var missing = !p.getProperty("TG_TOKEN") ? "TG_TOKEN" : "TG_CONTRACTOR_CHAT";
    var configError = { ok: false, description: "У властивостях скрипта немає " + missing + "." };
    alertOwner_("Замовлення " + (data.order_number || "?") + " НЕ надіслано підряднику.", configError.description);
    return configError;
  }
  var num = String(data.order_number || "").trim();
  if (num && p.getProperty("thread_" + num)) return { ok: true, skipped: true }; // вже надсилали — не дублюємо
  var threadId = null;
  var r = tgApi_("createForumTopic", { chat_id: chat, name: num || "Замовлення" });
  if (r && r.ok && r.result && r.result.message_thread_id) threadId = r.result.message_thread_id;
  // якщо Теми вимкнені / бот не адмін — threadId лишиться null, повідомлення піде в загальний чат
  var sent = tgSendTo_(chat, buildProductionMsg_(data), threadId);
  if (num && sent && sent.ok) {
    p.setProperty("thread_" + num, threadId ? String(threadId) : "0"); // "0" = надіслано без теми
  } else {
    // СТОРОЖ: підтверджене замовлення не дійшло підряднику — одразу сигнал власнику
    alertOwner_("Замовлення " + (num || "?") + " НЕ надіслано підряднику в групу.",
                "Відповідь Telegram: " + JSON.stringify(sent));
  }
  return sent || { ok: false, description: "Telegram не повернув підтвердження надсилання." };
}

/** Перевірити токен, групу підрядника, права бота та onEdit-тригер. */
function checkContractorTelegram() {
  var ui = SpreadsheetApp.getUi();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var p = PropertiesService.getScriptProperties();
  var token = p.getProperty("TG_TOKEN");
  var chat = p.getProperty("TG_CONTRACTOR_CHAT");
  var triggerOk = ScriptApp.getProjectTriggers().some(function (t) {
    return t.getHandlerFunction() === "onEditDelivery" &&
      (!t.getTriggerSourceId() || t.getTriggerSourceId() === ss.getId());
  });
  var missing = [];
  if (!token) missing.push("TG_TOKEN");
  if (!chat) missing.push("TG_CONTRACTOR_CHAT");
  if (missing.length) {
    ui.alert("Telegram підрядника не налаштовано", "Відсутні властивості: " + missing.join(", ") + ".", ui.ButtonSet.OK);
    return;
  }
  var me = tgApi_("getMe", {});
  if (!me || !me.ok) {
    ui.alert("Помилка токена Telegram", telegramError_(me), ui.ButtonSet.OK);
    return;
  }
  var chatInfo = tgApi_("getChat", { chat_id: chat });
  if (!chatInfo || !chatInfo.ok) {
    ui.alert("Бот не бачить групу підрядника", telegramError_(chatInfo) + "\n\nПеревір TG_CONTRACTOR_CHAT: " + chat, ui.ButtonSet.OK);
    return;
  }
  var member = tgApi_("getChatMember", { chat_id: chat, user_id: me.result.id });
  var status = member && member.ok && member.result ? member.result.status : "невідомо";
  var adminOk = status === "administrator" || status === "creator";
  var canTopics = !member || !member.ok || !member.result || member.result.can_manage_topics !== false;
  var username = me.result.username ? "@" + me.result.username : "бот";
  var title = chatInfo.result && chatInfo.result.title ? chatInfo.result.title : String(chat);
  var lines = [
    "Бот: " + username,
    "Група: " + title,
    "Статус у групі: " + status,
    "Керування гілками: " + (canTopics ? "дозволено або не потрібне" : "НЕ дозволено"),
    "Тригер зміни статусу: " + (triggerOk ? "встановлено" : "НЕ встановлено")
  ];
  if (adminOk && canTopics && triggerOk) {
    ui.alert("Перевірка успішна", lines.join("\n"), ui.ButtonSet.OK);
  } else {
    ui.alert("Потрібне виправлення", lines.join("\n") + "\n\nЗапусти «Виправити автоматичні звіти й тригери» та перевір права бота в групі.", ui.ButtonSet.OK);
  }
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
    if (it.has_cover) m += "• Верхня кришка: <b>Так</b>\n";
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

/**
 * Для часових тригерів відкриваємо саме ту таблицю, до якої автоматика була
 * прив'язана вручну. Це захищає від запуску звіту по старій копії таблиці.
 */
function getAutomationSpreadsheet_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty("AVALON_SPREADSHEET_ID");
  if (id) {
    try { return SpreadsheetApp.openById(id); }
    catch (e) { console.error("Не вдалося відкрити AVALON_SPREADSHEET_ID: " + e); }
  }
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (ss) props.setProperty("AVALON_SPREADSHEET_ID", ss.getId());
  return ss;
}

/** Щоденний прохід: знаходить замовлення з датою сьогодні / через N днів і шле нагадування. */
function sendDeliveryReminders() {
  var tz = "Europe/Kiev";
  var ss = getAutomationSpreadsheet_();
  if (!ss) return;
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

function buildOwnerDailyReport_() {
  var tz = "Europe/Kiev";
  var ss = getAutomationSpreadsheet_();
  if (!ss) return "📊 <b>AVALON: зведення</b>\nТаблицю для автоматичного звіту не знайдено.";
  var sh = ss.getSheetByName(SHEET_ORDERS);
  if (!sh || sh.getLastRow() < 2) return "📊 <b>AVALON: зведення</b>\nЗамовлень поки немає.";
  var rows = sh.getRange(2, 1, sh.getLastRow() - 1, 34).getValues();
  var todayIso = ymd_(new Date(), tz);
  var orders = {};
  var marginAccrued = 0;
  var marginReady = 0;
  var marginReceived = 0;
  var marginDebt = 0;

  rows.forEach(function (r) {
    var num = String(r[0] || "").trim();
    if (!num) return;
    var status = String(r[2] || "").trim();
    var profit = Number(r[22]) || 0; // W — поточна маржа з таблиці
    if (!orders[num]) {
      orders[num] = {
        num: num, status: status, client: r[4],
        date: toISODate(r[28]), revenue: 0, profit: 0, rows: 0
      };
    }
    orders[num].rows++;
    orders[num].revenue += Number(r[21]) || 0; // V
    orders[num].profit += profit;
    if (status !== "Скасовано") {
      marginAccrued += profit;
      if (r[32] === true) marginReady += profit;       // AG — клієнт оплатив
      if (r[33] === true) marginReceived += profit;    // AH — маржу отримано
      if (r[32] === true && r[33] !== true) marginDebt += profit;
    }
  });

  var counts = { "Нове": 0, "В роботі": 0, "Готове": 0, "Відправлено": 0, "Завершено": 0, "Скасовано": 0 };
  var late = [], today = [];
  Object.keys(orders).forEach(function (num) {
    var o = orders[num];
    if (counts[o.status] != null) counts[o.status]++;
    if (o.date && REMIND_DONE.indexOf(o.status) < 0) {
      if (dayDiff_(todayIso, o.date) < 0) late.push(o);
      if (dayDiff_(todayIso, o.date) === 0) today.push(o);
    }
  });

  function listOrders(arr) {
    return arr.slice(0, 5).map(function (o) {
      return "• " + esc_(o.num) + (o.client ? " — " + esc_(o.client) : "") + (o.date ? " (" + fmtDate_(o.date) + ")" : "");
    }).join("\n");
  }

  var msg = "📊 <b>AVALON: щоденне зведення</b>\n";
  msg += "🕐 " + nowKyiv_() + "\n\n";
  msg += "• Нові: <b>" + counts["Нове"] + "</b>\n";
  msg += "• В роботі: <b>" + counts["В роботі"] + "</b>\n";
  msg += "• Готові: <b>" + counts["Готове"] + "</b>\n";
  msg += "• Прострочені: <b>" + late.length + "</b>\n";
  msg += "\n💰 <b>МАРЖА З АКТУАЛЬНОЇ ТАБЛИЦІ</b>\n";
  msg += "• Нараховано: <b>" + money_(marginAccrued) + " ₴</b>\n";
  msg += "• До отримання (клієнт оплатив): <b>" + money_(marginReady) + " ₴</b>\n";
  msg += "• Отримано: <b>" + money_(marginReceived) + " ₴</b>\n";
  msg += "• Залишок до отримання: <b>" + money_(marginDebt) + " ₴</b>\n";
  if (today.length) msg += "\n📅 <b>Сьогодні відправка/доставка</b>\n" + listOrders(today) + "\n";
  if (late.length) msg += "\n⚠️ <b>Прострочені</b>\n" + listOrders(late) + (late.length > 5 ? "\n• ще " + (late.length - 5) : "") + "\n";
  return msg;
}

function sendOwnerDailyReport() {
  var msg = buildOwnerDailyReport_();
  var sent = notifyOwner_(msg);
  if (!sent || !sent.ok) throw new Error("Звіт не надіслано: " + telegramError_(sent));
  return sent;
}

/** Ручний запуск із меню з простим повідомленням про результат. */
function sendOwnerDailyReportFromMenu() {
  var ui = SpreadsheetApp.getUi();
  try {
    sendOwnerDailyReport();
    ui.alert("Готово", "Щоденний звіт надіслано в Telegram.", ui.ButtonSet.OK);
  } catch (e) {
    ui.alert("Звіт не надіслано", String(e && e.message ? e.message : e), ui.ButtonSet.OK);
  }
}

function installOwnerReportTrigger() {
  var trg = ScriptApp.getProjectTriggers();
  for (var i = 0; i < trg.length; i++) {
    if (trg[i].getHandlerFunction() === "sendOwnerDailyReport") ScriptApp.deleteTrigger(trg[i]);
  }
  ScriptApp.newTrigger("sendOwnerDailyReport").timeBased().atHour(8).nearMinute(35).everyDays(1).create();
  Logger.log("Тригер звіту власнику встановлено на ~08:35 щодня.");
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

/**
 * Запусти один раз у ПРАВИЛЬНІЙ таблиці.
 * Прив'язує автоматику до неї, видаляє дублікати тригерів у цьому проєкті
 * та встановлює по одному актуальному тригеру нагадувань і звіту.
 */
function repairAutomation() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error("Відкрий Apps Script саме з потрібної Google-таблиці.");
  PropertiesService.getScriptProperties().setProperty("AVALON_SPREADSHEET_ID", ss.getId());
  var trg = ScriptApp.getProjectTriggers();
  for (var i = 0; i < trg.length; i++) {
    var fn = trg[i].getHandlerFunction();
    if (fn === "sendOwnerDailyReport" || fn === "sendDeliveryReminders" || fn === "onEditDelivery") {
      ScriptApp.deleteTrigger(trg[i]);
    }
  }
  ScriptApp.newTrigger("onEditDelivery").forSpreadsheet(ss).onEdit().create();
  ScriptApp.newTrigger("sendDeliveryReminders").timeBased().atHour(8).nearMinute(30).everyDays(1).create();
  ScriptApp.newTrigger("sendOwnerDailyReport").timeBased().atHour(8).nearMinute(35).everyDays(1).create();
  Logger.log("Автоматику прив'язано до таблиці «" + ss.getName() + "». onEdit, нагадування та звіт встановлено заново.");
  SpreadsheetApp.getUi().alert("Готово", "Встановлено тригер зміни статусу, щоденні нагадування та звіт.", SpreadsheetApp.getUi().ButtonSet.OK);
}

/** Тест: надсилає нагадування по всіх майбутніх замовленнях зараз (ігнорує час). */
function testReminderNow() {
  sendDeliveryReminders();
}

/** Меню в таблиці (зʼявляється при відкритті). */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("AVALON")
    .addItem("🔄 Надіслати оновлення підряднику (поточний рядок)", "sendUpdateToContractor")
    .addItem("📊 Надіслати щоденний звіт власнику", "sendOwnerDailyReportFromMenu")
    .addItem("🔎 Перевірити Telegram власника", "checkOwnerTelegram")
    .addItem("🔎 Перевірити Telegram підрядника", "checkContractorTelegram")
    .addItem("📤 Повторно надіслати поточне замовлення", "resendCurrentOrderToContractor")
    .addItem("🛠 Виправити автоматичні звіти й тригери", "repairAutomation")
    .addItem("♻️ Оновити вкладку «Зведення»", "updateDashboard")
    .addToUi();
}

/**
 * Надсилає ОНОВЛЕНУ специфікацію в ту саму гілку замовлення (після правок замовника).
 * Стань на будь-яку комірку рядка замовлення → меню AVALON → Надіслати оновлення.
 */
function sendUpdateToContractor() {
  var ui = SpreadsheetApp.getUi();
  var sh = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  if (sh.getName().toLowerCase() !== SHEET_ORDERS.toLowerCase()) {
    ui.alert("Спочатку стань на рядок замовлення в аркуші «Замовлення»."); return;
  }
  var row = sh.getActiveCell().getRow();
  if (row < 2) { ui.alert("Обери рядок із замовленням (не заголовок)."); return; }
  var num = String(sh.getRange(row, 1).getValue() || "").trim();
  if (!num) { ui.alert("У цьому рядку немає номера замовлення."); return; }
  var p = PropertiesService.getScriptProperties();
  var thread = p.getProperty("thread_" + num);
  if (!thread) {
    ui.alert("Замовлення " + num + " ще не надсилалось підряднику.\nСпершу постав статус «В роботі».");
    return;
  }
  var ord = buildOrderFromRows_(sh, num);
  if (!ord) { ui.alert("Не вдалося зібрати дані замовлення " + num + "."); return; }
  var chat = p.getProperty("TG_CONTRACTOR_CHAT");
  var text = "🔄 <b>ОНОВЛЕНО ЗАМОВЛЕННЯ</b> (зміни від замовника):\n\n" + buildProductionMsg_(ord);
  var sent = tgSendTo_(chat, text, thread === "0" ? null : thread);
  if (sent && sent.ok) ui.alert("✅ Оновлення надіслано підряднику в гілку " + num + ".");
  else ui.alert("⚠️ Не вдалося надіслати. Перевір права бота «Керувати гілками» в групі.");
}

/** Примусово повторно створити гілку й надіслати поточне замовлення підряднику. */
function resendCurrentOrderToContractor() {
  var ui = SpreadsheetApp.getUi();
  var sh = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  if (sh.getName().toLowerCase() !== SHEET_ORDERS.toLowerCase()) {
    ui.alert("Спочатку стань на рядок замовлення в аркуші «Замовлення»."); return;
  }
  var row = sh.getActiveCell().getRow();
  if (row < 2) { ui.alert("Обери рядок із замовленням."); return; }
  var num = String(sh.getRange(row, 1).getValue() || "").trim();
  if (!num) { ui.alert("У цьому рядку немає номера замовлення."); return; }
  var answer = ui.alert("Повторно надіслати " + num + "?", "Бот створить нову гілку в групі підрядника та надішле специфікацію.", ui.ButtonSet.YES_NO);
  if (answer !== ui.Button.YES) return;
  var ord = buildOrderFromRows_(sh, num);
  if (!ord) { ui.alert("Не вдалося зібрати дані замовлення " + num + "."); return; }
  var p = PropertiesService.getScriptProperties();
  p.deleteProperty("thread_" + num);
  var sent = createOrderTopic_(ord);
  if (sent && sent.ok) ui.alert("Готово", "Замовлення " + num + " надіслано підряднику.", ui.ButtonSet.OK);
  else ui.alert("Не надіслано", telegramError_(sent), ui.ButtonSet.OK);
}

/** Дозволити повторне надсилання підряднику: знімає «позначку надіслано» для вказаних
 *  замовлень. Запусти вручну, потім постав цим замовленням статус «В роботі» знову. */
function resendToContractor() {
  var nums = ["ORD-190626-009"]; // ← впиши номери через кому, які треба надіслати ще раз
  var p = PropertiesService.getScriptProperties();
  nums.forEach(function (n) { p.deleteProperty("thread_" + String(n).trim()); });
  Logger.log("Знято позначки: " + nums.join(", ") + ". Тепер постав їм статус «В роботі» знову.");
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
    "Доставка","Адреса","Дата доставки","Оплата","Як дізнались","Примітки",
    "Оплата клієнта ✓", // AG (33): клієнт оплатив підряднику (є квитанція) → маржа до отримання
    "Маржу отримано ✓"  // AH (34): підрядник перерахував мені маржу за це замовлення
  ];
  if (sheet.getMaxColumns() < headers.length) sheet.insertColumnsAfter(sheet.getMaxColumns(), headers.length - sheet.getMaxColumns());
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  headerStyle(sheet, headers.length);
  var widths = [130,130,90,130,150,130,100,170,150,120,80,120,150,60,60,60,80,80,110,110,110,110,110,80,110,110,140,200,110,140,160,200,120,130];
  widths.forEach(function (w, i) { sheet.setColumnWidth(i + 1, w); });

  var rule = SpreadsheetApp.newDataValidation()
    .requireValueInList(["Нове","В роботі","Готове","Відправлено","Завершено","Скасовано"]).setAllowInvalid(false).build();
  sheet.getRange(2, 3, 1000, 1).setDataValidation(rule);
  var cb = SpreadsheetApp.newDataValidation().requireCheckbox().build();
  sheet.getRange(2, 33, 1000, 2).setDataValidation(cb); // AG, AH — галочки
  applyOrderConditionalFormats_(sheet);
  applyOrderFilter_(sheet);
}

/** Фільтр на заголовку «Замовлення» — кнопки-лійки для фільтрації за статусом, містом тощо. */
function applyOrderFilter_(sh) {
  var f = sh.getFilter();
  if (f) f.remove();
  var lastRow = Math.max(sh.getLastRow(), 2);
  sh.getRange(1, 1, lastRow, sh.getLastColumn()).createFilter();
}

/** Додати/оновити фільтр на наявному аркуші «Замовлення». */
function addOrderFilter() {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_ORDERS);
  if (sh) { applyOrderFilter_(sh); Logger.log("Фільтр додано на «Замовлення»."); }
}

/** Умовне форматування аркуша «Замовлення»: колір статус-комірки + колір тексту всього рядка. */
function applyOrderConditionalFormats_(sheet) {
  var sr = sheet.getRange("C2:C1000");    // статус-комірка
  var rowR = sheet.getRange("A2:AH1000"); // увесь рядок (текст)
  // Кольори статус-комірки (як було).
  var cellRules = [
    {t:"Нове",bg:"#FFF3CD",fg:"#856404"}, {t:"В роботі",bg:"#CCE5FF",fg:"#004085"},
    {t:"Готове",bg:"#D4EDDA",fg:"#155724"}, {t:"Відправлено",bg:"#D1ECF1",fg:"#0C5460"},
    {t:"Завершено",bg:"#E2E3E5",fg:"#383D41"}, {t:"Скасовано",bg:"#F8D7DA",fg:"#721C24"}
  ].map(function (r) { return SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo(r.t).setBackground(r.bg).setFontColor(r.fg).setBold(true).setRanges([sr]).build(); });
  // Колір ТЕКСТУ всього рядка за статусом: Скасовано — червоний, Завершено — зелений.
  var rowRules = [
    SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=$C2="Скасовано"').setFontColor("#C0392B").setRanges([rowR]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=$C2="Завершено"').setFontColor("#1E7E34").setRanges([rowR]).build()
  ];
  // Статус-комірка вище за пріоритетом → зберігає власні кольори; решта рядка фарбується.
  sheet.setConditionalFormatRules(cellRules.concat(rowRules));
}

/** Оновити лише кольори в існуючому аркуші «Замовлення» (дані не чіпає). */
function updateOrderColors() {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_ORDERS);
  if (sh) applyOrderConditionalFormats_(sh);
}

/** Додати галочки AG «Оплата клієнта ✓» і AH «Маржу отримано ✓» у НАЯВНИЙ аркуш. Дані не чіпає. */
function addPaymentColumn() {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_ORDERS);
  if (!sh) return;
  if (sh.getMaxColumns() < 34) sh.insertColumnsAfter(sh.getMaxColumns(), 34 - sh.getMaxColumns());
  sh.getRange(1, 33, 1, 2).setValues([["Оплата клієнта ✓", "Маржу отримано ✓"]]);
  sh.getRange(1, 33, 1, 2).setFontWeight("bold").setBackground(RAL7016).setFontColor(HDR_TEXT)
    .setFontFamily(HDR_FONT).setHorizontalAlignment("center").setVerticalAlignment("middle").setWrap(true).setFontSize(10);
  sh.setColumnWidth(33, 120); sh.setColumnWidth(34, 130);
  sh.getRange(2, 33, 1000, 2).setDataValidation(SpreadsheetApp.newDataValidation().requireCheckbox().build());
  Logger.log("Галочки «Оплата клієнта ✓» (AG) і «Маржу отримано ✓» (AH) додано.");
}

/**
 * Аркуш «Розрахунки з підрядником» — облік ТВОЄЇ маржі. Рахується САМ за двома
 * галочками в «Замовлення»: AG «Оплата клієнта ✓» (маржа стає до отримання) і
 * AH «Маржу отримано ✓» (підрядник віддав тобі маржу за це замовлення).
 */
function setupContractorSettlement(ss) {
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();
  if (ss.getSheetByName(SHEET_SETTLE)) return ss.getSheetByName(SHEET_SETTLE);
  var sh = ss.insertSheet(SHEET_SETTLE);
  var O = SHEET_ORDERS;
  [330, 160].forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });
  var W = O + '!$W$2:$W$5000', AG = O + '!$AG$2:$AG$5000', AH = O + '!$AH$2:$AH$5000', NC = '(' + O + '!$C$2:$C$5000<>"Скасовано")';

  sh.getRange("A1").setValue("РОЗРАХУНКИ З ПІДРЯДНИКОМ — МОЯ МАРЖА").setFontWeight("bold").setFontSize(12);
  sh.getRange("A2").setValue("Усього маржі (клієнт оплатив підряднику)");
  sh.getRange("B2").setFormula('=SUMPRODUCT((' + AG + '=TRUE)*' + NC + '*' + W + ')');
  sh.getRange("A3").setValue("Отримано від підрядника (маржа сплачена)");
  sh.getRange("B3").setFormula('=SUMPRODUCT((' + AH + '=TRUE)*' + NC + '*' + W + ')');
  sh.getRange("A4").setValue("ЗАЛИШОК — БОРГ ПІДРЯДНИКА МЕНІ");
  sh.getRange("B4").setFormula('=SUMPRODUCT((' + AG + '=TRUE)*(' + AH + '<>TRUE)*' + NC + '*' + W + ')');
  sh.getRange("A2:A4").setFontWeight("bold");
  sh.getRange("B2:B4").setNumberFormat("#,##0 ₴");
  sh.getRange("A4:B4").setBackground("#DCFCE7").setFontWeight("bold").setFontSize(11);

  sh.getRange("A6").setValue("Як це працює:").setFontWeight("bold").setFontColor(RAL7016);
  sh.getRange(7, 1, 4, 1).setValues([
    ["1) Клієнт оплатив підряднику (є квитанція) → у «Замовлення» постав галочку «Оплата клієнта ✓» (AG)."],
    ["2) Підрядник перерахував тобі маржу за це замовлення → постав галочку «Маржу отримано ✓» (AH)."],
    ["3) «Залишок» = маржа по оплачених клієнтом замовленнях, за які підрядник тобі ще НЕ віддав."],
    ["Маржа = «Валовий прибуток» (ціна продажу − собівартість). Скасовані не рахуються."]
  ]).setWrap(true).setFontColor("#444");
  sh.setColumnWidth(1, 330);
  sh.setFrozenRows(1);
  return sh;
}

/** Перебудувати аркуш «Розрахунки з підрядником» (видаляє старий і ставить новий без журналу). */
function updateContractorSettlement() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var old = ss.getSheetByName(SHEET_SETTLE);
  if (old) ss.deleteSheet(old);
  setupContractorSettlement(ss);
}

/** ОДИН КЛІК: галочки оплати + аркуш «Розрахунки з підрядником» + фільтр + кольори рядків. Дані не чіпає. */
function applyAllUpdates() {
  addPaymentColumn();
  updateContractorSettlement(); // перебудовує (прибирає старий ручний журнал)
  addOrderFilter();
  updateOrderColors();
  Logger.log("Готово: галочки оплати, аркуш розрахунків, фільтр і кольори застосовано.");
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
  var O = SHEET_ORDERS, E = SHEET_EXPENSES;
  [260,140,140,140,140,140,140,150,140,150].forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });
  var NC = '(' + O + '!$C$2:$C$5000<>"Скасовано")';
  var AG = O + '!$AG$2:$AG$5000';
  var AH = O + '!$AH$2:$AH$5000';

  // ---- ЗАГАЛОМ ----
  sh.getRange("A1").setValue("ЗВЕДЕННЯ — ЗАГАЛОМ").setFontWeight("bold").setFontSize(12);
  // Суми по замовленнях — БЕЗ статусу «Скасовано» (щоб скасовані не завищували фінанси).
  var rows = [
    ["Виручка",                 '=SUMIF(' + O + '!C:C;"<>Скасовано";' + O + '!V:V)'],
    ["Собівартість",            '=SUMIF(' + O + '!C:C;"<>Скасовано";' + O + '!T:T)'],
    ["Валовий прибуток (нараховано)", '=SUMIF(' + O + '!C:C;"<>Скасовано";' + O + '!W:W)'],
    ["Маржинальність %",        '=IFERROR(B4/B2;0)'],
    ["Маржа до отримання (клієнт оплатив)", '=SUMPRODUCT((' + AG + '=TRUE)*' + NC + '*' + O + '!$W$2:$W$5000)'],
    ["Маржу отримано",          '=SUMPRODUCT((' + AH + '=TRUE)*' + NC + '*' + O + '!$W$2:$W$5000)'],
    ["Залишок маржі до отримання", '=SUMPRODUCT((' + AG + '=TRUE)*(' + AH + '<>TRUE)*' + NC + '*' + O + '!$W$2:$W$5000)'],
    ["Комісії дропшиперам (нараховано)", '=SUMIF(' + O + '!C:C;"<>Скасовано";' + O + '!Y:Y)'],
    ["Інші витрати",            '=SUM(' + E + '!D:D)'],
    ["ЧИСТИЙ ПРИБУТОК ФАКТИЧНИЙ", '=B7-B9-B10']
  ];
  for (var i = 0; i < rows.length; i++) {
    sh.getRange(i + 2, 1).setValue(rows[i][0]);
    sh.getRange(i + 2, 2).setFormula(rows[i][1]);
  }
  sh.getRange("A2:A11").setFontWeight("bold");
  sh.getRange("B2:B3").setNumberFormat("#,##0 ₴");
  sh.getRange("B4").setNumberFormat("#,##0 ₴");
  sh.getRange("B5").setNumberFormat('0.0%'); // частка → відсотки (×100), напр. 0,259 → 25,9%
  sh.getRange("B6:B11").setNumberFormat("#,##0 ₴");
  sh.getRange("A8:B8").setBackground("#FEF3C7").setFontWeight("bold");
  sh.getRange("A11:B11").setBackground("#DCFCE7").setFontWeight("bold");

  // ---- ПОМІСЯЧНО ----
  sh.getRange("A14").setValue("ПОМІСЯЧНО").setFontWeight("bold").setFontSize(12);
  var mh = ["Місяць (ММ.РРРР)","Виручка","Собівартість","Валовий прибуток","Маржинальність %","Маржу отримано","Борг маржі","Комісії","Витрати","Чистий факт"];
  sh.getRange(15, 1, 1, mh.length).setValues([mh]);
  headerStyleAt(sh, 15, mh.length);
  // Місяць (ММ.РРРР) — як ТЕКСТ (щоб не перетворювалось у число й звірка спрацьовувала).
  sh.getRange(16, 1, 12, 1).setNumberFormat("@");
  var curMonth = Utilities.formatDate(new Date(), "Europe/Kiev", "MM.yyyy");
  // Місяць замовлення беремо з НОМЕРА (ORD-ДДММРР-NNN): MID(7,2)=MM, "20"&MID(9,2)=РРРР.
  // Надійніше за дату-текст у колонці B (її Google може перетворити на справжню дату).
  var monKey = 'MID(' + O + '!$A$2:$A$5000;7;2)&".20"&MID(' + O + '!$A$2:$A$5000;9;2)';
  for (var r = 16; r < 28; r++) {
    if (r === 16) sh.getRange(r, 1).setValue(curMonth);
    var m = "$A" + r;
    var notCancel = '(' + O + '!$C$2:$C$5000<>"Скасовано")'; // фактор: рядок не скасований
    sh.getRange(r, 2).setFormula('=IF(' + m + '="";"";SUMPRODUCT((' + monKey + '=' + m + ')*' + notCancel + '*' + O + '!$V$2:$V$5000))');
    sh.getRange(r, 3).setFormula('=IF(' + m + '="";"";SUMPRODUCT((' + monKey + '=' + m + ')*' + notCancel + '*' + O + '!$T$2:$T$5000))');
    sh.getRange(r, 4).setFormula('=IF(' + m + '="";"";SUMPRODUCT((' + monKey + '=' + m + ')*' + notCancel + '*' + O + '!$W$2:$W$5000))');
    sh.getRange(r, 5).setFormula('=IFERROR(D' + r + '/B' + r + ';"")');
    sh.getRange(r, 6).setFormula('=IF(' + m + '="";"";SUMPRODUCT((' + monKey + '=' + m + ')*(' + AH + '=TRUE)*' + notCancel + '*' + O + '!$W$2:$W$5000))');
    sh.getRange(r, 7).setFormula('=IF(' + m + '="";"";SUMPRODUCT((' + monKey + '=' + m + ')*(' + AG + '=TRUE)*(' + AH + '<>TRUE)*' + notCancel + '*' + O + '!$W$2:$W$5000))');
    sh.getRange(r, 8).setFormula('=IF(' + m + '="";"";SUMPRODUCT((' + monKey + '=' + m + ')*' + notCancel + '*' + O + '!$Y$2:$Y$5000))');
    // Витрати помісячно — через TEXT дати (Витрати!A = реальна дата)
    sh.getRange(r, 9).setFormula('=IF(' + m + '="";"";SUMPRODUCT((TEXT(' + E + '!$A$2:$A$2000;"MM.yyyy")=' + m + ')*' + E + '!$D$2:$D$2000))');
    // Чистий факт = отримана маржа − комісії − витрати
    sh.getRange(r, 10).setFormula('=IF(' + m + '="";"";F' + r + '-H' + r + '-I' + r + ')');
  }
  sh.getRange("B16:D27").setNumberFormat("#,##0 ₴");
  sh.getRange("E16:E27").setNumberFormat('0.0%');
  sh.getRange("F16:J27").setNumberFormat("#,##0 ₴");
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
    "• Зведення — підсумки: виручка, собівартість, маржа отримана/до отримання, борг підрядника, комісії, чистий прибуток (загалом + помісячно).",
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
    "Комісія дропш. = Кількість × Ставка партнера.    Валовий прибуток = ціна продажу − собівартість.",
    "AG «Оплата клієнта ✓» додає маржу в борг підрядника. AH «Маржу отримано ✓» переносить її в отриману маржу.",
    "Чистий прибуток факт (Зведення) = отримана маржа − комісії − витрати.",
    "",
    "━━━ ЯК ПРАВИЛЬНО РЕДАГУВАТИ ТА СКАСОВУВАТИ ━━━",
    "ГОЛОВНЕ ПРАВИЛО: усі правки (розміри, колір, адреса, оплата тощо) роби ДО того, як поставиш статус «В роботі».",
    "Щойно статус став «В роботі» — замовлення вже надіслано підряднику в групу (гілка ORD-…). Подальші правки в таблиці туди автоматично НЕ підтягуються.",
    "ПРАВКИ ПІСЛЯ «В РОБОТІ»: зміни рядок у таблиці → стань на будь-яку комірку цього рядка → меню зверху «AVALON» → «🔄 Надіслати оновлення підряднику». У ту саму гілку впаде оновлена специфікація з позначкою «ОНОВЛЕНО».",
    "ДАТУ ДОСТАВКИ можна міняти будь-коли: вона сама оновлюється в Google Календарі, а нагадування підлаштовуються автоматично.",
    "СКАСУВАННЯ: не видаляй рядок — постав статус «Скасовано». Рядок залишиться для історії, але у «Зведенні» НЕ рахуватиметься (не завищує виручку/прибуток), і нагадування припиняться. (Статуси «Відправлено» і «Завершено» теж зупиняють нагадування, але у фінанси входять.)",
    "ВИДАЛЕННЯ РЯДКА: нагадування не надходитимуть, АЛЕ подія в Google Календарі залишиться — видали її вручну. Тому краще «Скасовано», ніж видалення.",
    "ПОВТОРНЕ НАДСИЛАННЯ: кожне замовлення йде підряднику лише ОДИН раз (щоб не дублювати). Якщо після великих змін потрібно надіслати знову — звернись до розробника.",
    "СТОРОЖ: якщо замовлення зі статусом «В роботі» чомусь не дійшло підряднику — тобі прийде ⚠️ у чат замовлень (одразу і під час щоденної перевірки о 08:30).",
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

/** Оновити лише аркуш «Інструкція» (видаляє старий і створює новий текст). Дані не чіпає. */
function updateInstructions() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var old = ss.getSheetByName(SHEET_INFO);
  if (old) ss.deleteSheet(old);
  setupInstructions(ss);
}

/** Оновити лише аркуш «Зведення» (нові формули з AG/AH). Дані замовлень не чіпає. */
function updateDashboard() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var old = ss.getSheetByName(SHEET_DASH);
  if (old) ss.deleteSheet(old);
  setupDashboard(ss);
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
  setupContractorSettlement(ss);
  setupInstructions(ss);
  // Перевстановити крос-формулу (тепер усі аркуші існують) — щоб уникнути застряглого #REF.
  ss.getSheetByName(SHEET_PAYOUTS).getRange("C2")
    .setFormula('=ARRAYFORMULA(IF(B2:B="";"";IFERROR(VLOOKUP(B2:B;' + SHEET_DROP + '!A:B;2;0);"")))');
  SpreadsheetApp.flush();
}

/** Запусти один раз, щоб надати дозволи на Google Календар і таблицю. */
function authorize() {
  CalendarApp.getDefaultCalendar().getName();
  SpreadsheetApp.getActiveSpreadsheet().getName();
}

function jsonOut(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) { return jsonOut({ status: "ok", message: "Avalon v3.0" }); }
