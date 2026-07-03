# Правила роботи агентів з avalon-order-form

Ці правила обов'язкові для Codex, Claude Code та будь-якого іншого AI-агента.

## Перед початком

1. Прочитати `AGENTS.md`, `CODEX-HANDOFF.md`, `CHANGE-CONTROL.md` і
   `DEPLOY-CHECKLIST.md`.
2. Виконати `git fetch origin`.
3. Створити нову гілку від актуального `origin/main` з префіксом `codex/`,
   `claude/` або `feature/`. Старі робочі гілки не продовжувати.
4. Не змінювати `main` напряму.

## Єдине джерело правди

- Офіційний код знаходиться в GitHub, гілка `main`.
- `google-apps-script-v2.js` є офіційним джерелом Apps Script.
- Живий Google Apps Script синхронізується тільки через `clasp`.
- Ручні зміни коду в Apps Script, Vercel Functions або production заборонені.
- Дані замовлень у Google Sheets можна редагувати як робочі дані, але не можна
  вручну змінювати структуру, формули, тригери чи скрипти без окремого завдання.

## Заборонено без прямого підтвердження користувача

- `clasp push`, створення версії або оновлення production deployment;
- зміна Vercel environment variables або production domains;
- зміна Telegram BotFather, токенів, груп, адміністраторів чи webhook;
- видалення рядків, аркушів, тригерів, deployment або файлів користувача;
- ротація чи показ секретів;
- прямий push у `main`, force-push або видалення `main`.

Пряме підтвердження має бути в поточному чаті після короткого опису змін,
ризиків і перевірок. Старе загальне «роби все сам» не є дозволом на production.

## Робочий процес

1. Внести мінімальні зміни у новій гілці.
2. Запустити швидкі перевірки:
   - `node --check api/order.js`;
   - `node --check api/alert.js`;
   - `node --check api/np.js`;
   - `node --check google-apps-script-v2.js`;
   - `git diff --check`.
3. Для змін Apps Script перед push виконати `clasp pull`, перевірити diff і
   `clasp show-file-status`. Дозволені лише `google-apps-script-v2.js` та
   `appsscript.json`.
4. Оновити `CODEX-HANDOFF.md`, якщо змінюється поведінка системи.
5. Відкрити Pull Request. Дочекатися обов'язкових GitHub/Vercel перевірок.
6. Після злиття deployment виконувати лише за окремим підтвердженням.
7. У фінальному звіті дати посилання на PR, перелік тестів і точний статус
   Vercel/Apps Script deployment.
8. Після завершення Apps Script deployment виконати `clasp logout`. Наступний
   Google-вхід користувач підтверджує окремо для нового deployment.

## Секрети

- Не читати й не показувати значення токенів без технічної необхідності.
- Не додавати в GitHub `.clasprc.json`, `.env*`, токени Telegram, Google OAuth,
  Vercel tokens або `NP_API_KEY`.
- Якщо секрет з'явився в чаті чи git diff, зупинитися та повідомити користувача.

## Новий або сторонній чат

Якщо агент не має локального репозиторію та цих інструкцій, він може лише
аналізувати або готувати текстове завдання. Зміни дозволені тільки після
відкриття цього репозиторію та прочитання перелічених документів.
