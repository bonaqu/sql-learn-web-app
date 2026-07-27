# SQL Academy

Open-source SQL-платформа для 2nd Support Engineer. Репозиторий намеренно не содержит имени владельца, работодателя, адресов, телефонов или других персональных данных. Все компании, сотрудники и обращения в учебном наборе вымышлены; основной банк в кейсах называется **T-Bonk**.

## Онлайн

- GitHub Pages: https://bonaqu.github.io/sql-learn-web-app/
- Cloudflare Worker: https://sql-learn-web-app.bonaqu.workers.dev

Оба адреса используют один Cloudflare API, D1, KV и Workers AI backend. Учебная платформа монтируется только после успешной проверки пользовательской сессии.

## Что входит в SQL Academy 3.0

- React + TypeScript + Vite.
- Monaco Editor и SQLite WASM прямо в браузере.
- **32 учебных модуля и 240 автоматически проверяемых задач.**
- **44 структурированных урока:** 20 core lessons и 24 advanced lessons.
- **132 theory sections**, glossary, runnable examples и knowledge checks.
- **8 curriculum checkpoints** от fundamentals до production operations.
- **5 learning tracks:** Fundamentals, Support SQL, Analytics SQL, Performance SQL и Interview Readiness.
- **3 graded exams:** Diagnostic SQL Check, Production SQL Exam и SQL Academy Final.
- **Dialect Lab:** 11 executable portability patterns для SQLite, PostgreSQL и Oracle MySQL 8.4; SQL Server представлен только reference-only syntax matrix и не считается engine evidence.
- Project Lab с тремя production-like T-Bonk capstone-проектами, deliverables, drafts и rubric.
- Cross-device curriculum sync через D1 с optimistic concurrency и deterministic conflict merge.
- Adaptive Learning Path с восемью последовательными фазами.
- Mastery каждого модуля по покрытию, точности и самостоятельности.
- Персональные сессии на 15, 25 или 40 минут.
- Readiness к рабочим задачам и SQL-интервью.
- Assessment Center: Quick Check, SQL Interview Simulation и Academy Exam.
- Resumable assessment timer, skill reports и история результатов между устройствами.
- AI Interviewer, AI Debrief, AI Coach и AI Mentor с deterministic local fallback.
- Каталог, глобальный поиск, Practice, Interview и SQL Puzzle.
- Статистика, график активности, XP, streak, повторение и достижения.
- PWA с локальным SQLite WASM и офлайн-кэшем статических ресурсов.
- Явное online/offline состояние и управляемое обновление без неожиданного auto-reload.
- Skip link, keyboard focus trap, возврат фокуса, `aria-live` и поддержка `prefers-reduced-motion`.
- Lazy loading Syllabus Center, Curriculum Studio, Learning Path, Assessment Center, SQLite, Monaco и графика активности.
- Автоматический raw/gzip bundle budget и axe-core audit на desktop и Pixel 7.
- Обязательная авторизация по логину и паролю без email, SMS и OAuth.
- Восемь одноразовых recovery-кодов после регистрации.
- Отдельная отзываемая сессия для каждого устройства.
- Cloudflare D1 для пользователей, сессий, recovery-кодов, task progress, curriculum drafts, dialect evidence и assessment reports.
- Cloudflare KV для настроек и лимитов AI/real-engine execution.
- Автоматический CI/CD в GitHub Pages и Cloudflare Workers Static Assets + Containers.

## Полная программа SQL

### Core

1. SQL-мышление и контракт результата.
2. SELECT, выражения, DISTINCT и aliases.
3. WHERE, NULL, LIKE, BETWEEN и IN.
4. ORDER BY, LIMIT и стабильный порядок.
5. COUNT, SUM, AVG, MIN и MAX.
6. GROUP BY и HAVING.
7. INNER, LEFT, self join и anti-join.
8. Скалярные и коррелированные подзапросы, EXISTS.
9. CTE и многоэтапные запросы.
10. Оконные функции.
11. Дата и время.
12. Строки, CASE и COALESCE.
13. UNION, INTERSECT и EXCEPT.
14. Качество данных.
15. Индексы и селективность.
16. EXPLAIN и планы выполнения.
17. Транзакции и ACID.
18. Проектирование схемы и ограничения.
19. IT Support Analytics.
20. Финальная аналитическая витрина T-Bonk.

### Advanced production SQL

21. DML: INSERT, UPDATE, DELETE и UPSERT.
22. Views, constraints и schema evolution.
23. Продвинутая трёхзначная NULL-логика.
24. Conditional aggregation и согласованные доли.
25. Semi/anti joins и relational division.
26. Recursive CTE и иерархии.
27. Window frames, moving aggregates и gaps-and-islands reasoning.
28. JSON и semi-structured data.
29. Bind parameters, SQL injection и least privilege.
30. Concurrency, savepoints, lost update и retry safety.
31. Keyset pagination и stable cursors.
32. SQL-расследование инцидента: baseline, hypothesis и evidence query.

## Syllabus Center

Syllabus Center — отдельный lazy-loaded экран, который отвечает на три вопроса:

1. **Что учить дальше?** Карта пяти tracks показывает модули, часы, outcomes и текущий mastery.
2. **Как переносить SQL между СУБД?** Dialect Lab исполняет один pattern в SQLite, PostgreSQL и MySQL, а SQL Server показывает как reference-only syntax без ложного engine evidence.
3. **Когда готов к проверке?** Экзаменационный раздел показывает duration, passing score, prerequisites, rules и readiness weight.

Syllabus Center не дублирует практику. Он объясняет структуру курса и ведёт в Curriculum Studio, Assessment Center и рабочий каталог.

## Curriculum Studio и Project Lab

Каждый lesson проходит полный цикл:

1. learning objectives и prerequisites;
2. theory sections: фундаментальная модель, рабочий workflow и диагностика ошибок;
3. glossary;
4. runnable SQLite example на общем training dataset;
5. knowledge check с объяснением;
6. переход к связанным Practice/Interview/Puzzle задачам.

Advanced-модули имеют отдельные foundation и production-pattern lessons. Все task/module/lesson/checkpoint ссылки валидируются автоматически, а runnable examples исполняются на SQLite в CI.

Project Lab содержит три case-based проекта:

- Incident Command Dashboard;
- Customer Data Trust Audit;
- T-Bonk SLA Executive Mart.

SQL drafts, заметки, deliverables, завершённые lessons/projects и bookmark хранятся отдельно от Progress v4. Локальная копия привязана к текущему аккаунту. D1 sync использует conditional PUT по server timestamp; при конфликте клиент объединяет обе копии и повторяет запись, поэтому изменения с другого устройства не перезаписываются молча.

Подробная архитектура: [`docs/curriculum-studio.md`](docs/curriculum-studio.md).

## Adaptive Learning Path

Mastery модуля учитывает:

- **65% — покрытие:** сколько задач темы действительно решено;
- **23% — точность:** отношение успешных попыток ко всем попыткам;
- **12% — самостоятельность:** использование подсказок после начала работы с модулем.

Непросмотренный модуль имеет 0% mastery. Полный путь разделён на восемь фаз:

1. Надёжная база.
2. Конструирование запросов.
3. Production core.
4. Support Analytics.
5. Изменения и целостность.
6. Advanced querying.
7. Modern SQL.
8. Production operations.

Каждая дневная сессия собирается из уникальных задач нескольких типов: повторение, слабая тема, следующий новый шаг и доступная контрольная точка. Целевую длительность можно менять между 15, 25 и 40 минутами.

## Assessment Center

Assessment Center — отдельный проверочный контур. Он использует собственную SQLite-базу и не начисляет XP за экзаменационные попытки.

- **Quick Check:** 3 задачи, 12 минут, доступен сразу;
- **SQL Interview Simulation:** 5 задач, 35 минут, до двух уточнений AI Interviewer на задачу;
- **Academy Exam:** 8 задач, 55 минут, открывается после прохождения prerequisites.

Curriculum 2.0 дополнительно определяет graded pools для Diagnostic, Production и Final exam. Они используют тот же защищённый assessment runtime: без обычного AI Mentor, подсказок и эталонного решения. Сессия сохраняется в браузере под ID текущего пользователя, автоматически восстанавливается после reload и завершается при истечении deadline.

Skill report учитывает правильность, попытки, время, самостоятельность, покрытие модулей и readiness delta. Завершённые отчёты сохраняются в D1 и доступны после входа на другом устройстве.

## Password authentication

Без проверенной сессии пользователь видит только экран входа, регистрации или сброса пароля. Компоненты курса, локальный SQLite workspace, Learning Path и Assessment Center до входа не монтируются.

### Пароль

- длина от 15 до 128 символов;
- разрешены пробелы, Unicode и любые печатные символы;
- сервер использует PBKDF2-HMAC-SHA-256 с индивидуальной случайной солью;
- KDF состоит из шести domain-separated стадий по 100 000 итераций;
- результат хранится в versioned формате `pbkdf2-sha256-chain-v1`;
- исходный пароль не записывается в D1;
- после пяти последовательных неверных попыток вход блокируется на 15 минут.

### Recovery-коды

После регистрации выдаются ровно восемь случайных одноразовых кодов. Платформа остаётся заблокированной, пока пользователь явно не подтвердит, что сохранил комплект.

- коды можно скопировать или скачать в `.txt`;
- приложение не сохраняет подтверждённый комплект в persistent storage;
- в D1 хранится только SHA-256 verifier каждого кода;
- один код расходуется при сбросе или смене пароля;
- после смены или сброса пароля все активные сессии удаляются;
- новый комплект аннулирует предыдущий;
- перевыпуск разрешён не чаще одного раза за 24 часа.

Подробная модель: [`docs/password-auth.md`](docs/password-auth.md).

## Accessibility, PWA и offline boundary

- первый `Tab` открывает skip link;
- активный раздел навигации отмечается через `aria-current`;
- Profile, Syllabus Center, Curriculum Studio, Learning Path и Assessment Center удерживают фокус внутри dialog;
- `Escape` закрывает безопасно закрываемые dialogs и возвращает фокус launcher-кнопке;
- active assessment не закрывается случайным `Escape`;
- результаты SQL имеют accessible caption и заголовки столбцов;
- ошибки, синхронизация, SQL-result и update state объявляются через `alert`/`status`/`aria-live`;
- `prefers-reduced-motion: reduce` отключает необязательные анимации;
- serious/critical axe violations блокируют merge.

Service worker кэширует production HTML, CSS, JavaScript chunks, SVG и WASM. После первого успешного открытия доступны статические материалы, локальный прогресс и SQLite workspace. Сеть обязательна для входа, cloud sync, профиля, real PostgreSQL/MySQL execution и AI-функций.

Новая версия не активируется автоматически. Пользователь выбирает «Обновить сейчас» или «Позже». При изменённом SQL либо активной assessment-сессии приложение требует дополнительное подтверждение.

## Локальный запуск и quality gates

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

`npm run check` проверяет:

- TypeScript и Worker types;
- 240 executable task contracts;
- 32-module Learning Path graph;
- Assessment Center invariants;
- 44 lessons и runnable examples;
- prerequisite DAG;
- 8 checkpoints;
- 5 tracks, 3 exams и competency map;
- 11 Dialect Lab patterns × 3 executable dialects и SQL Server reference-only matrix;
- 22 isolated PostgreSQL/MySQL Docker contracts, включая две реальные concurrent sessions;
- project rubric/deliverable uniqueness;
- D1 cascade foreign keys и deployment-smoke contract.

Bundle gate ограничивает initial entry, общий CSS и каждый крупный chunk в raw и gzip. Он требует отдельные lazy boundaries для Syllabus Center, Curriculum Studio, Assessment Center, Learning Path, SQLite, ActivityChart и SqlEditor.

Browser gate проверяет auth/recovery, multi-device task и curriculum sync, Learning Path, Curriculum Studio, Project Lab, Syllabus Center, Dialect Lab, Assessment Center, offline/update UX, keyboard focus, desktop, Pixel 7 и axe-core.

## Cloudflare production stack

Workflow автоматически собирает приложение, применяет D1 migrations, разворачивает Worker + Static Assets + Sandbox Container и проверяет health/auth/progress/curriculum APIs, все 22 PostgreSQL/MySQL production contracts, optimistic conflict, privacy, destroy cleanup и cascade временного smoke-аккаунта.

Cloudflare Containers не доступны на Workers Free. Для real PostgreSQL/MySQL execution нужен Workers Paid; актуальные условия опубликованы в [официальной документации Containers pricing](https://developers.cloudflare.com/containers/pricing/). Без Container binding приложение сохраняет SQLite и preview-only portability workflow, но не выдаёт его за server-engine evidence.

Требуются GitHub Actions secrets:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

R2 и Hyperdrive намеренно не используются: для текущей архитектуры достаточно Workers Static Assets, Containers, D1 и KV.

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
- `GET|PUT /api/dialect-labs/progress`
- `POST /api/dialect-labs/execute`
- `POST /api/mentor`
- `GET|POST /api/assessment/reports`
- `POST /api/assessment/interviewer`
- `POST /api/assessment/debrief`

Для authenticated endpoints Worker игнорирует клиентский `x-profile-id` и сам подставляет ID проверенного пользователя.

## Конфиденциальность

- Нет аналитических трекеров.
- Для аккаунта не нужны email, SMS, телефон или внешний профиль.
- Отображаемое имя необязательно и используется только внутри приложения.
- Нет персональных данных в репозитории и seed-данных.
- В браузере хранится отзываемый session token, локальная копия task progress и curriculum drafts текущего аккаунта.
- Service worker не получает и не кэширует password, recovery-коды или bearer token.
- Recovery-коды после подтверждения не сохраняются приложением.
- Assessment session/report не содержит password, recovery-коды или bearer token.
- Dialect evidence хранит только lab/dialect/version, pass state, duration и digest; learner SQL в D1 не сохраняется.
- В AI Mentor/Interviewer отправляются только контекст задачи, вопрос, SQL и техническая статистика попыток.
- В AI Coach/Debrief отправляется только агрегированный mastery/assessment-профиль без login, password, recovery-кодов и session token.
