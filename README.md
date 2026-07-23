# SQL Academy

Персональный интерактивный fast-track курс SQL для 2nd Support Engineer. Приложение работает прямо в браузере на SQLite WASM и не требует backend.

## Онлайн-версия

GitHub Pages: https://bonaqu.github.io/sql-learn-web-app/

## Что внутри

- 12 практических уроков: SELECT, WHERE, NULL, GROUP BY, HAVING, CASE, JOIN, LEFT JOIN, подзапросы, CTE, оконные функции, индексы и EXPLAIN.
- Автоматическая проверка результата, а не простое сравнение текста запроса.
- Подсказки по типовым ошибкам SQLite.
- XP, локальное сохранение прогресса и повторение слабых тем.
- Итоговый экзамен.
- Финальный проект IT Support Analytics.
- Свободный SQL Sandbox.
- PWA-кэш основных файлов.

## Локальный запуск

```bash
python -m http.server 8765
```

Открой `http://localhost:8765`.

## GitHub Pages

Workflow `.github/workflows/pages.yml` публикует содержимое ветки `bonaqu_projects` через GitHub Actions.

## Cloudflare

Workflow `.github/workflows/cloudflare.yml` использует Workers Static Assets. Для автоматического деплоя добавь в GitHub Actions secrets:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

Локально можно выполнить:

```bash
npx wrangler deploy
```

## Архитектура

Проект намеренно не использует сборщик: это снижает количество точек отказа и позволяет одинаково публиковать приложение на GitHub Pages и Cloudflare.
