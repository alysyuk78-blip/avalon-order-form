# Claude Code

Перед будь-якою дією прочитай і виконуй `AGENTS.md`.

Також обов'язково прочитай:

- `CODEX-HANDOFF.md`;
- `CHANGE-CONTROL.md`;
- `DEPLOY-CHECKLIST.md`.

Не продовжуй стару `feature/calc-modes`. Завжди створи нову гілку від
актуального `origin/main`. Production deployment дозволений лише після прямого
підтвердження користувача в поточному чаті.

## Передача від Codex, оновлено 03.07.2026

1. Codex об'єднав твої зміни `Верхня кришка` зі свіжим `main` через PR №45.
2. Налаштовано `clasp` для production Apps Script через PR №46:
   - Script ID у `.clasp.json`;
   - allowlist у `.claspignore`;
   - production Apps Script оновлено до version `26`;
   - чинний `/exec` перевірено, він повертає `Avalon v3.0`.
3. Telegram уніфіковано на `@order_status_koshyk_bot`; звіт із поточної таблиці
   пройшов ручний тест.
4. Через PR №47 виправлено надсилання підряднику:
   - `repairAutomation()` тепер встановлює `onEditDelivery`;
   - додано перевірку Telegram-групи й прав бота;
   - додано повторне надсилання поточного замовлення;
   - Apps Script production оновлено до version `28`.
5. У поточній гілці Codex додає change control:
   - `AGENTS.md`;
   - `CHANGE-CONTROL.md`;
   - шаблон PR;
   - GitHub Actions `Validate`;
   - захист `main` після злиття.
6. Після отримання цих змін виконай `git fetch origin` і створи нову гілку від
   `origin/main`. Не використовуй стару локальну `feature/calc-modes`.
7. Не виконуй `clasp push`, Vercel/Telegram/Google production-зміни без прямого
   підтвердження користувача в поточному чаті.
