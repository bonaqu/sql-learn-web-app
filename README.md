# SQL Academy

Open-source SQL-платформа для 2nd Support Engineer. Репозиторий намеренно не содержит имени владельца, работодателя, адресов, телефонов или других персональных данных. Все компании, сотрудники и обращения в учебном наборе вымышлены; основной банк в кейсах называется **T-Bonk**.

## Онлайн

- GitHub Pages: https://bonaqu.github.io/sql-learn-web-app/
- Cloudflare Worker: создаётся workflow `Deploy Cloudflare Full Stack`

## Возможности v2

- React + TypeScript + Vite.
- Monaco Editor и SQLite WASM прямо в браузере.
- 20 учебных модулей и 120 задач.
- Каталог, глобальный поиск, Practice, Interview и SQL Puzzle.
- Статистика, график активности, XP, streak и достижения.
- Светлая и тёмная темы.
- PWA с офлайн-кэшем приложения.
- Экспорт и импорт прогресса в JSON.
- Cloudflare D1 для синхронизации прогресса.
- Cloudflare KV для настроек.
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

## Cloudflare Free-first

Workflow автоматически:

1. собирает React-приложение;
2. находит или создаёт D1 `sql-academy`;
3. находит или создаёт KV namespace `sql-academy-settings`;
4. применяет миграции из `migrations/`;
5. разворачивает Worker, API и статические assets.

Требуются GitHub Actions secrets:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

R2 и Hyperdrive намеренно не используются. Для личного учебного приложения они не нужны, а архитектура остаётся совместимой с бесплатным Workers plan.

## API

- `GET /api/health`
- `GET|PUT /api/progress`
- `GET|PUT /api/settings`
- `POST /api/mentor`

## Конфиденциальность

- Нет аналитических трекеров.
- Нет формы регистрации.
- Нет персональных данных в репозитории и seed-данных.
- Прогресс хранится локально; облачная синхронизация запускается пользователем вручную.
- В AI Mentor отправляются только текст вопроса и SQL из редактора.
