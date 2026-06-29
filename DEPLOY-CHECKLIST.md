# Чек-лист деплою — avalon-order-form

## Google Apps Script через clasp

`clasp` підключений до production Apps Script. Авторизація Google зберігається
локально у `~/.clasprc.json` і ніколи не комітиться в GitHub. Першу
синхронізацію перевірено 29.06.2026: Apps Script version `26`, чинний `/exec`
відповідає `{"status":"ok","message":"Avalon v3.0"}`.

Перед роботою:

```bash
git fetch origin
git switch main
git pull --ff-only origin main
pnpm dlx @google/clasp pull
```

Після перевірених змін у `google-apps-script-v2.js`:

```bash
pnpm dlx @google/clasp show-file-status
pnpm dlx @google/clasp push
pnpm dlx @google/clasp create-version "короткий опис"
pnpm dlx @google/clasp update-deployment AKfycbyGmlQKyUwYWami3bLnbUzPLhLivzODdwCdq_buYqsBpAMvqBgWYjosifhN3Ei7e--eIw --versionNumber НОМЕР_ВЕРСІЇ --description "короткий опис"
```

Важливо: `clasp push` повністю замінює вміст Apps Script. `.claspignore`
обмежує push двома файлами: `google-apps-script-v2.js` та `appsscript.json`.
Перед push завжди перевіряти `show-file-status`.

Покрокове введення в дію змін з гілки від актуального `main`.
Познач кожен пункт, коли виконано.

---

## 1. Оновити Google Apps Script через clasp (КРИТИЧНО)

Без цього не працюють: послідовна нумерація (v2.4), колонка «Джерело» і аркуш «Джерела».

- [ ] Виконати `clasp pull` і перевірити, що немає неочікуваних змін.
- [ ] Після редагування виконати `clasp show-file-status`: мають бути лише
  `google-apps-script-v2.js` та `appsscript.json`.
- [ ] Виконати `clasp push`, створити версію та оновити чинний deployment за
  командами вище. URL веб-застосунку (`/exec`) лишається тим самим.
- [ ] (Опційно) Запустити функцію `setupSourcesSheet` один раз вручну — або аркуш «Джерела» створиться сам при першому замовленні.

## 2. Перевірити env-змінні Vercel

Vercel → Проєкт `avalon-order-form` → **Settings → Environment Variables**. Мають бути задані:

- [ ] `NP_API_KEY` — ключ API Нової пошти (для проксі `/api/np`)
- [ ] `TELEGRAM_BOT_TOKEN`
- [ ] `TELEGRAM_CHAT_ID`
- [ ] `GOOGLE_SHEET_URL` — URL веб-застосунку Apps Script (`.../exec`)
- [ ] Після змін env — **Redeploy** проєкту.

## 3. Викотити код у прод

- [ ] Створити нову гілку від `origin/main`, відкрити PR і злити її в `main`.
- [ ] Переконатися, що Vercel production deployment завершився успішно.

---

## 4. Перевірка після деплою

- [ ] **НП-фільтр:** на 2–3 містах у списку відділень немає поштоматів і відділень < 30 кг; вантажні відділення лишаються.
- [ ] **НП-помилка:** (тимчасово прибравши/зіпсувавши `NP_API_KEY`) — форма показує попередження, а не порожній список. Повернути ключ.
- [ ] **`?ref=`:** відкрити `…vercel.app/?ref=OSBB-TEST`, оформити тест-замовлення → джерело `OSBB-TEST` у Telegram і Google Sheets (колонка «Джерело»).
- [ ] **Без `?ref=`** → джерело `direct`.
- [ ] **Дата в Telegram** збігається з київським часом (формат ДД.ММ.РРРР ГГ:ХХ).
- [ ] **Номер замовлення** `ORD-ДДММРР-NNN` — послідовний, обнуляється з 1-го числа місяця.
- [ ] **Сума** у формі = Telegram = Sheets.
- [ ] **Мобільний:** після відправки можна оформити друге замовлення («Нове замовлення»).
- [ ] **Крутилка:** під час відправки в кнопці крутиться логотип AVALON.
- [ ] **Дабл-клік** не створює два замовлення.

## 5. Реферали ОСББ (аркуш «Джерела»)

- [ ] Заповнити рядки: КОД, Тип, Адреса/назва, Відповідальний, Контакт, Ставка.
- [ ] Колонки «Замовлень» і «Нараховано» рахуються формулами автоматично.
- [ ] Згенерувати QR на `…vercel.app/?ref=КОД` і роздрукувати наклейки.
