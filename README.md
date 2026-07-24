# SQL Academy

Open-source SQL-платформа для 2nd Support Engineer. Репозиторий намеренно не содержит имени владельца, работодателя, адресов, телефонов или других персональных данных. Все компании, сотрудники и обращения в учебном наборе вымышлены; основной банк в кейсах называется **T-Bonk**.

## Онлайн

- GitHub Pages: https://bonaqu.github.io/sql-learn-web-app/
- Cloudflare Worker: https://sql-learn-web-app.bonaqu.workers.dev

Оба адреса используют один Cloudflare API, D1, KV и Workers AI backend. Учебная платформа монтируется только после успешной проверки пользовательской сессии.

## Возможности

- React + TypeScript + Vite.
- Monaco Editor и SQLite WASM прямо в браузере.
- 20 учебных модулей и 120 автоматически проверяемых задач.
- Adaptive Learning Path с четырьмя этапами и контрольными точками.
- Mastery каждого модуля по покрытию, точности и самостоятельности.
- Персональные сессии на 15, 25 или 40 минут.
- Readiness к рабочим задачам и SQL-интервью.
- Assessment Center: Quick Check, SQL Interview Simulation и Academy Exam.
- Resumable assessment timer, skill reports и история результатов между устройствами.
- AI Interviewer и AI Debrief с deterministic local fallback.
- AI Coach для следующего учебного шага с deterministic local fallback.
- Каталог, глобальный поиск, Practice, Interview и SQL Puzzle.
- Статистика, график активности, XP, streak, повторение и достижения.
- PWA с локальным SQLite WASM и офлайн-кэшем статических ресурсов.
- Обязательная авторизация по логину и паролю без email, SMS и OAuth.
- Восемь одноразовых recovery-кодов после регистрации.
- Отдельная отзываемая сессия для каждого устройства.
- Revision-based merge, защищающий прогресс от молчаливого перезаписывания.
- Базовые настройки профиля и управление активными сессиями.
- Cloudflare D1 для пользователей, сессий, recovery-кодов, прогресса и assessment reports.
- Cloudflare KV для настроек core API и лимитов AI Mentor/Interviewer/Debrief.
- Автоматический CI/CD в GitHub Pages и Cloudflare Workers Static Assets.

## Password authentication

Без проверенной сессии пользователь видит только экран входа, регистрации или сброса пароля. Компоненты курса, локальный SQLite workspace, Learning Path и Assessment Center до входа не монтируются.

### Пароль

- длина от 15 до 128 символов;
- разрешены пробелы, Unicode и любые печатные символы;
- сервер использует PBKDF2-HMAC-SHA-256 с индивидуальной случайной солью и 600 000 итераций;
- исходный пароль не записывается в D1;
- после пяти последовательных неверных попыток вход блокируется на 15 минут.

### Recovery-коды

После регистрации выдаются ровно восемь случайных одноразовых кодов. Платформа остаётся заблокированной, пока пользователь явно не подтвердит, что сохранил комплект.

- коды можно скопировать или скачать в `.txt`;
- приложение не сохраняет подтверждённый комплект в persistent storage;
- в D1 хранится только SHA-256 verifier каждого кода;
- один код расходуется при сбросе пароля;
- смена пароля из профиля требует текущий пароль и один recovery-код;
- после смены или сброса пароля все активные сессии удаляются;
- новый комплект аннулирует предыдущий;
- перевыпуск разрешён не чаще одного раза за 24 часа.

Подробная модель: [`docs/password-auth.md`](docs/password-auth.md).

## Assessment Center

Assessment Center — отдельный проверочный контур. Он использует собственную SQLite-базу и не начисляет XP за экзаменационные попытки.

- **Quick Check:** 3 задачи, 12 минут, доступен сразу;
- **SQL Interview Simulation:** 5 задач, 35 минут, до двух уточнений AI Interviewer на задачу;
- **Academy Exam:** 8 задач, 55 минут, открывается после прохождения prerequisites.

Во время активной проверки физически отсутствуют обычный AI Mentor, подсказки и эталонное решение. Сессия сохраняется в браузере под ID текущего пользователя, автоматически восстанавливается после reload и завершается при истечении deadline.

Skill report учитывает:

- правильность результата;
- число попыток и долю решений с первой попытки;
- время на каждую задачу;
- использование Interviewer как показатель самостоятельности;
- покрытие модулей;
- readiness delta;
- deterministic local debrief и опциональный AI Debrief.

Завершённые отчёты сохраняются в D1 и доступны после входа на другом устройстве. Пароль, recovery-коды и bearer token в assessment session/report не записываются.

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

Полный integration gate в Pull Request дополнительно поднимает локальный Wrangler runtime, применяет все D1 migrations и запускает Chromium на desktop и Pixel-sized mobile viewport.

`npm run check` проверяет TypeScript, 120 SQL-решений, инварианты Adaptive Learning Path и Assessment Center: deterministic selection, diversity, prerequisites, scoring, report ranges и внешний ключ D1 к реальному `users.user_id`.

Browser gate проверяет обязательный auth screen, регистрацию, восемь recovery-кодов, password reset, одноразовость кода, отзыв сессий, multi-device progress sync, профиль, существующие Academy/Learning Path flows, assessment resume/expiry, запрет подсказок, AI Interviewer, skill report sync и Pixel 7 layout.

## Cloudflare Free-first

Workflow автоматически:

1. собирает React-приложение;
2. находит или создаёт D1 `sql-academy`;
3. находит или создаёт KV namespace `sql-academy-settings`;
4. применяет миграции из `migrations/`;
5. разворачивает Worker, API и статические assets;
6. проверяет health endpoint;
7. подтверждает `401` без сессии;
8. регистрирует временного smoke-пользователя, проверяет bearer-session и progress API;
9. удаляет временный аккаунт паролем и recovery-кодом.

Требуются GitHub Actions secrets:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

R2 и Hyperdrive намеренно не используются. Для учебного приложения они не нужны, а архитектура остаётся совместимой с бесплатным Workers plan.

## API

Публичные endpoints:

- `GET /api/health`
- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/password/reset`

Endpoints с `Authorization: Bearer <session-token>`:

- `GET /api/auth/session`
- `POST /api/auth/logout`
- `GET /api/auth/sessions`
- `DELETE /api/auth/sessions/:sessionId`
- `POST /api/auth/password/change`
- `POST /api/auth/recovery/regenerate`
- `GET|PUT|DELETE /api/profile`
- `GET|PUT /api/user/progress`
- `GET|PUT /api/progress`
- `GET|PUT /api/settings`
- `POST /api/mentor`
- `GET|POST /api/assessment/reports`
- `POST /api/assessment/interviewer`
- `POST /api/assessment/debrief`

Для core endpoints Worker игнорирует клиентский `x-profile-id` и сам подставляет ID аутентифицированного пользователя.

## Конфиденциальность

- Нет аналитических трекеров.
- Для аккаунта не нужны email, SMS, телефон или внешний профиль.
- Отображаемое имя необязательно и используется только внутри приложения.
- Нет персональных данных в репозитории и seed-данных.
- В браузере хранится отзываемый session token и локальная копия учебного прогресса.
- Recovery-коды после подтверждения не сохраняются приложением.
- Assessment session/report не содержит пароль, recovery-коды или bearer token.
- В AI Mentor/Interviewer отправляются только контекст задачи, текст вопроса, SQL и техническая статистика попыток.
- В AI Coach/Debrief отправляется только агрегированный mastery/assessment-профиль без логина, пароля, recovery-кодов и session token.
