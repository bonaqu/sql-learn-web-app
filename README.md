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
- Curriculum Studio: 20 структурированных уроков, 60 theory sections, glossary, runnable examples и knowledge checks.
- Project Lab с тремя production-like T-Bonk capstone-проектами, deliverables, drafts и rubric.
- Cross-device curriculum sync через D1 с optimistic concurrency и deterministic conflict merge.
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
- Явное online/offline состояние и управляемое обновление без неожиданного auto-reload.
- Skip link, keyboard focus trap, возврат фокуса, `aria-live` и поддержка `prefers-reduced-motion`.
- Lazy loading Curriculum Studio, Learning Path, Assessment Center, SQLite, Monaco и графика активности.
- Автоматический raw/gzip bundle budget и axe-core audit на desktop и Pixel 7.
- Обязательная авторизация по логину и паролю без email, SMS и OAuth.
- Восемь одноразовых recovery-кодов после регистрации.
- Отдельная отзываемая сессия для каждого устройства.
- Revision-based merge, защищающий прогресс от молчаливого перезаписывания.
- Базовые настройки профиля и управление активными сессиями.
- Cloudflare D1 для пользователей, сессий, recovery-кодов, task progress, curriculum drafts и assessment reports.
- Cloudflare KV для настроек core API и лимитов AI Mentor/Interviewer/Debrief.
- Автоматический CI/CD в GitHub Pages и Cloudflare Workers Static Assets.

## Password authentication

Без проверенной сессии пользователь видит только экран входа, регистрации или сброса пароля. Компоненты курса, локальный SQLite workspace, Learning Path и Assessment Center до входа не монтируются.

### Пароль

- длина от 15 до 128 символов;
- разрешены пробелы, Unicode и любые печатные символы;
- сервер использует PBKDF2-HMAC-SHA-256 с индивидуальной случайной солью;
- KDF состоит из шести последовательных domain-separated стадий по 100 000 итераций, то есть совокупная стоимость составляет 600 000 итераций;
- результат хранится в versioned формате `pbkdf2-sha256-chain-v1`;
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

## Curriculum Studio и Project Lab

Curriculum Studio добавляет к существующим 120 задачам полноценный цикл обучения:

1. learning objectives и prerequisites;
2. три theory sections: модель, рабочий алгоритм и диагностика;
3. glossary;
4. runnable SQLite example на общем training dataset;
5. knowledge check с объяснением;
6. переход к связанным Practice/Interview/Puzzle задачам.

Все 20 modules имеют стабильные lesson/section/check IDs. Четыре curriculum checkpoints покрывают фундамент, query design, production SQL и Support Analytics.

Project Lab содержит три case-based проекта:

- Incident Command Dashboard;
- Customer Data Trust Audit;
- T-Bonk SLA Executive Mart.

SQL drafts, заметки, deliverables, завершённые lessons/projects и bookmark хранятся отдельно от Progress v4. Локальная копия привязана к текущему аккаунту. D1 sync использует conditional PUT по server timestamp; при конфликте клиент объединяет обе копии и повторяет запись, поэтому изменения с другого устройства не перезаписываются молча.

Подробная архитектура: [`docs/curriculum-studio.md`](docs/curriculum-studio.md).

## Accessibility и клавиатура

- первый `Tab` открывает skip link к основному содержимому;
- активный раздел навигации отмечается через `aria-current`;
- Profile, Curriculum Studio, Learning Path и Assessment Center удерживают фокус внутри открытого dialog;
- `Escape` закрывает безопасно закрываемые dialogs и возвращает фокус кнопке запуска;
- active assessment не закрывается случайным `Escape`;
- результаты SQL имеют доступный caption и заголовки столбцов;
- ошибки, синхронизация, SQL-result и update state объявляются через `alert`/`status`/`aria-live`;
- `prefers-reduced-motion: reduce` отключает необязательные анимации;
- вторичный текст проходит минимальный WCAG AA contrast threshold.

Pull Request gate запускает axe-core на публичном auth screen, рабочем desktop UI и Pixel 7 Assessment Center. Serious и critical violations блокируют merge.

## PWA, offline и обновления

Service worker кэширует production HTML, CSS, JavaScript chunks, SVG и WASM. После первого успешного открытия доступны статические материалы, локальный прогресс и SQLite workspace. Сеть всё ещё обязательна для:

- входа и проверки cloud session;
- синхронизации task progress, curriculum drafts и assessment reports;
- профиля и управления сессиями;
- AI Mentor, Coach, Interviewer и Debrief.

Новая версия не активируется автоматически. Пользователь видит уведомление и выбирает «Обновить сейчас» или «Позже». При изменённом SQL либо активной assessment-сессии требуется дополнительное подтверждение; локальная assessment-сессия остаётся resumable. Если после deployment браузер запросил chunk предыдущей сборки, recovery screen предлагает безопасную перезагрузку вместо продолжения в неконсистентном UI.

Curriculum Studio, Learning Path, Assessment Center, SQLite, Monaco и ActivityChart не входят в обязательную стартовую загрузку. Они загружаются при первом focus/hover/open соответствующего режима и затем остаются в browser cache.

## Локальный запуск

```bash
npm install
npm run dev
```

Проверка production-сборки:

```bash
npm run check
npm run build
npm run validate:bundle
```

Полный integration gate в Pull Request дополнительно поднимает локальный Wrangler runtime, применяет все D1 migrations и запускает Chromium на desktop и Pixel-sized mobile viewport.

`npm run check` проверяет TypeScript, 120 SQL-решений, инварианты Adaptive Learning Path и Assessment Center, а также curriculum graph: 20 lessons, prerequisite DAG, 20 runnable SQLite examples, task/checkpoint/project references, rubric weights и D1 cascade foreign key.

Bundle gate ограничивает initial entry, общий CSS и каждый крупный chunk одновременно в raw и gzip представлении. Он также требует отдельные lazy boundaries для Curriculum Studio, Assessment Center, Learning Path, SQLite, ActivityChart и SqlEditor и запрещает ссылаться на них из `dist/index.html`.

Browser gate проверяет обязательный auth screen, регистрацию, восемь recovery-кодов, password reset, одноразовость кода, отзыв сессий, multi-device task/curriculum sync, профиль, Academy/Learning Path/Curriculum flows, runnable lesson examples, project completion, assessment resume/expiry, запрет подсказок, AI Interviewer, skill report sync, keyboard-only focus flows, offline/update UX, reduced motion, axe-core и Pixel 7 layout.

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
- `GET|PUT /api/curriculum/progress`
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
- В браузере хранится отзываемый session token, локальная копия task progress и curriculum drafts текущего аккаунта.
- Service worker не получает и не кэширует password, recovery-коды или bearer token.
- Recovery-коды после подтверждения не сохраняются приложением.
- Assessment session/report не содержит пароль, recovery-коды или bearer token.
- В AI Mentor/Interviewer отправляются только контекст задачи, текст вопроса, SQL и техническая статистика попыток.
- В AI Coach/Debrief отправляется только агрегированный mastery/assessment-профиль без логина, пароля, recovery-кодов и session token.
