# SQL Academy

Open-source SQL-платформа для 2nd Support Engineer. Репозиторий намеренно не содержит имени владельца, работодателя, адресов, телефонов или других персональных данных. Все компании, сотрудники и обращения в учебном наборе вымышлены; основной банк в кейсах называется **T-Bonk**.

## Онлайн

- GitHub Pages: https://bonaqu.github.io/sql-learn-web-app/
- Cloudflare Worker: https://sql-learn-web-app.bonaqu.workers.dev

Оба адреса используют один Cloudflare API, D1, KV и Workers AI backend.

## Возможности

- React + TypeScript + Vite.
- Monaco Editor и SQLite WASM прямо в браузере.
- 20 учебных модулей и 120 автоматически проверяемых задач.
- Каталог, глобальный поиск, Practice, Interview и SQL Puzzle.
- Статистика, график активности, XP, streak, повторение и достижения.
- Светлая и тёмная темы.
- PWA с локальным SQLite WASM и офлайн-кэшем приложения.
- Экспорт и импорт прогресса в JSON.
- Анонимные sync-аккаунты без email, SMS, телефона и OAuth.
- Перенос аккаунта recovery-кодом между ПК и телефонами.
- Отдельный отзываемый токен для каждого устройства.
- Revision-based merge, защищающий прогресс от молчаливого перезаписывания.
- Cloudflare D1 для аккаунтов и прогресса.
- Cloudflare KV для настроек и лимитов AI Mentor.
- Workers AI Mentor с локальным fallback.
- Автоматический CI/CD в GitHub Pages и Cloudflare Workers Static Assets.

## Локальный запуск

```bash
npm install
npm run dev
```

Проверка production-сборки:

```bash
npm run check
npm run build
```

Полный integration gate в Pull Request дополнительно поднимает локальный Wrangler runtime, применяет D1 migrations и запускает Chromium на desktop и mobile viewport.

## Anonymous sync account

При создании аккаунта браузер генерирует длинный recovery-код с checksum. Из него локально выводятся account ID и master proof. Recovery-код и master secret не отправляются и не сохраняются сервером в открытом виде.

После подключения сервер выдаёт устройству отдельный случайный token. Его можно отозвать из account center, не меняя recovery-код и не отключая остальные устройства.

Важно:

- recovery-код — единственный способ подключить новое устройство;
- сервер не может восстановить потерянный recovery-код;
- в localStorage хранится device token, но не recovery-код;
- при одновременных изменениях клиент объединяет прогресс и повторяет запись по новой revision;
- облачный аккаунт можно полностью удалить, сохранив локальную копию прогресса.

Подробности: [`docs/anonymous-accounts.md`](docs/anonymous-accounts.md).

## Cloudflare Free-first

Workflow автоматически:

1. собирает React-приложение;
2. находит или создаёт D1 `sql-academy`;
3. находит или создаёт KV namespace `sql-academy-settings`;
4. применяет миграции из `migrations/`;
5. разворачивает Worker, API и статические assets;
6. smoke-тестирует frontend, D1, KV, Workers AI и Progress API.

Требуются GitHub Actions secrets:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

R2 и Hyperdrive намеренно не используются. Для учебного приложения они не нужны, а архитектура остаётся совместимой с бесплатным Workers plan.

## API

Legacy browser-profile API:

- `GET /api/health`
- `GET|PUT /api/progress`
- `GET|PUT /api/settings`
- `POST /api/mentor`

Anonymous account API:

- `POST /api/account/register`
- `POST /api/account/connect`
- `GET|DELETE /api/account`
- `GET|PUT /api/account/progress`
- `GET /api/account/devices`
- `DELETE /api/account/devices/:deviceId`

## Конфиденциальность

- Нет аналитических трекеров.
- Для sync-аккаунта не нужны имя, email, SMS, телефон или внешний профиль.
- Нет персональных данных в репозитории и seed-данных.
- Без аккаунта прогресс остаётся только в браузере.
- С аккаунтом изменения синхронизируются после локального сохранения и по кнопке пользователя.
- В AI Mentor отправляются только контекст задачи, текст вопроса, SQL и техническая статистика попыток.
