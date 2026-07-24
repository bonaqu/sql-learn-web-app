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
- Adaptive Learning Path с четырьмя этапами и контрольными точками.
- Mastery каждого модуля по покрытию, точности и самостоятельности.
- Персональные сессии на 15, 25 или 40 минут.
- Readiness к рабочим задачам и SQL-интервью.
- AI Coach для следующего учебного шага с deterministic local fallback.
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

## Adaptive Learning Path

Учебный путь не хранит отдельный «нарисованный процент». Он пересчитывается из существующего Progress v4 и поэтому одинаково работает локально и после облачной синхронизации.

Mastery модуля учитывает:

- **65% — покрытие:** сколько задач темы действительно решено;
- **23% — точность:** отношение успешных попыток ко всем попыткам;
- **12% — самостоятельность:** использование подсказок после начала работы с модулем.

Непросмотренный модуль имеет 0% mastery. Курс разделён на четыре этапа:

1. Надёжная база;
2. Сложные запросы;
3. Production SQL;
4. Support Analytics и финальный проект T-Bonk.

Каждая дневная сессия собирается из уникальных задач нескольких типов: повторение, слабая тема, следующий новый шаг и доступная контрольная точка. Целевую длительность можно менять между 15, 25 и 40 минутами.

Readiness использует mastery модулей, пройденные checkpoints и результаты Interview Mode. AI Coach получает только агрегированный учебный профиль и список рекомендованных тем; готовые SQL-решения в этом режиме запрещены.

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

`npm run check` проверяет не только TypeScript и 120 SQL-решений, но и инварианты Adaptive Learning Path: 20 модулей, четыре этапа, существование checkpoints, диапазоны mastery/readiness и отсутствие дублей в дневной сессии.

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
- В AI Coach учебного пути отправляется только агрегированный mastery-профиль без персональных данных.
