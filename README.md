# SQL Academy

Коммерчески лицензируемая SQL-платформа для быстрого профессионального обучения 2nd Support Engineer. Публичный бренд, homepage, repository и support URL задаются единым buyer-owned контрактом; учебные компании, сотрудники и обращения вымышлены, а основной банк в кейсах называется **T-Bonk**.

## Онлайн

- Канонический frontend URL: поле `homepageUrl` в [`config/product-identity.json`](config/product-identity.json).
- Репозиторий и поддержка: поля `repositoryUrl` и `supportUrl` в том же identity-контракте.
- Cloudflare API hostname относится к deployment security configuration и не используется как публичный бренд.

Оба frontend-адреса используют один Cloudflare Worker API с D1 и KV. Учебная платформа монтируется только после успешной проверки пользовательской сессии.

## Что входит

- React, TypeScript и Vite.
- Monaco Editor и локальный SQLite WASM.
- **32 модуля и 240 автоматически проверяемых задач.**
- **44 урока**, 132 theory sections, glossary, runnable examples и knowledge checks.
- **8 checkpoints**, **5 learning tracks** и **3 graded exams**.
- Adaptive Learning Path, module mastery, readiness и spaced review.
- Assessment Center с resumable timer и cross-device reports.
- Privacy-first learning analytics с объяснимыми intervention rules, actionable course-health, default-off sharing и layered k=5 suppression.
- Три production-like capstone-проекта T-Bonk.
- AI Mentor, Interviewer, Debrief и Coach с deterministic fallback.
- PWA, offline cache, keyboard focus management, reduced motion и axe-core gate.
- Авторизация без email/SMS/OAuth: пароль, восемь recovery-кодов и отдельные отзываемые device sessions.
- D1 sync для progress, curriculum, checkpoints, capstones, assessment, coarse analytics snapshots и dialect evidence.
- KV для настроек и bounded rate limits.

## Полная программа SQL

### Core

1. SQL-мышление и контракт результата.
2. SELECT, expressions, aliases и DISTINCT.
3. WHERE, NULL, LIKE, BETWEEN и IN.
4. ORDER BY, LIMIT и стабильный порядок.
5. COUNT, SUM, AVG, MIN и MAX.
6. GROUP BY и HAVING.
7. INNER/LEFT/self/anti joins.
8. Подзапросы и EXISTS.
9. CTE.
10. Оконные функции.
11. Дата и время.
12. CASE, COALESCE и строки.
13. UNION, INTERSECT и EXCEPT.
14. Качество данных.
15. Индексы и селективность.
16. EXPLAIN.
17. Транзакции и ACID.
18. Проектирование схемы.
19. IT Support Analytics.
20. Финальная витрина T-Bonk.

### Advanced production SQL

21. INSERT, UPDATE, DELETE и UPSERT.
22. Views, constraints и schema evolution.
23. Трёхзначная NULL-логика.
24. Conditional aggregation.
25. Semi/anti joins и relational division.
26. Recursive CTE.
27. Window frames и gaps-and-islands.
28. JSON и semi-structured data.
29. Bind parameters, injection и least privilege.
30. Concurrency, savepoints, lost update и retry safety.
31. Keyset pagination.
32. SQL-расследование инцидента.

## Dialect Lab: три разных уровня доказательства

Dialect Lab публикует 11 portability patterns и 33 cases для SQLite, PostgreSQL и Oracle MySQL 8.4. SQL Server остаётся reference-only syntax matrix.

### 1. SQLite в браузере

SQLite выполняется локально через WASM. Результат и plan реально вычисляются в браузере и могут создать independent evidence.

### 2. PostgreSQL/MySQL в GitHub Actions

Каждый pull request собирает isolated Docker image и выполняет **22 реальных server-engine contracts**:

- 11 PostgreSQL cases;
- 11 Oracle MySQL 8.4 cases;
- ephemeral database per attempt;
- bounded timeout/output;
- две независимые sessions для lost update и `FOR UPDATE SKIP LOCKED`;
- проверка NULL transport, JSON, generated columns, recursive CTE, window frames, keyset pagination и EXPLAIN.

Эта матрица блокирует merge при любом расхождении reference SQL с настоящим движком.

### 3. Cloudflare Free production

Production работает без billing-зависимых сервисов. PostgreSQL/MySQL на сайте предоставляют **CI-verified reference preview**:

- SQL проходит тот же policy и semantic contract;
- можно увидеть опубликованный expected output, normalized plan или concurrent timeline;
- ответ всегда содержит `passed=false`, `evidenceEligible=false`, `offlinePreview=true`;
- preview никогда не повышает mastery и не выдаётся за реальное server execution;
- learner SQL не сохраняется в D1 progress.

Cloudflare Containers доступны только на Workers Paid, поэтому они намеренно исключены из production workflow. Историческое настоящее engine evidence остаётся валидным и не может быть понижено stale sync.

Файл `wrangler.real-engines.jsonc` сохраняет необязательный paid-profile для воспроизводимости архитектуры. Он не используется GitHub Actions production deployment.

## Syllabus Center

Syllabus Center отвечает на три вопроса:

1. **Что учить дальше?** Карта tracks показывает модули, часы, outcomes и mastery.
2. **Как переносить SQL?** Dialect Lab разделяет local execution, real CI verification и production reference preview.
3. **Когда готов к проверке?** Exams показывают duration, passing score, prerequisites и readiness weight.

## Curriculum Studio и Project Lab

Каждый lesson включает objectives, prerequisites, theory, glossary, runnable SQLite example, knowledge check и переход к Practice/Interview/Puzzle.

Project Lab содержит:

- Incident Command Dashboard;
- Customer Data Trust Audit;
- T-Bonk SLA Executive Mart.

Локальная копия привязана к аккаунту. D1 sync использует optimistic concurrency и deterministic merge, поэтому изменения с другого устройства не перезаписываются молча.

Подробности: [`docs/curriculum-studio.md`](docs/curriculum-studio.md).

## Assessment Center

- **Quick Check:** 3 задачи, 12 минут.
- **SQL Interview Simulation:** 5 задач, 35 минут.
- **Academy Exam:** 8 задач, 55 минут, после prerequisites.

Assessment runtime не начисляет обычный XP, не показывает reference solution и сохраняет resumable session. Skill report учитывает точность, время, самостоятельность, покрытие и readiness delta.

## Privacy-first learning analytics

Полный учебный event log хранится только в браузере и ограничен 5 000 событиями / 180 днями. Он может содержать session boundaries, опубликованные task/module IDs, attempt outcome, diagnostic family, independent/retained evidence, remediation type и coarse duration bucket.

Он **не содержит** learner SQL, result rows, текст задач, free-form notes, username, display name, email, телефон, работодателя, recovery-коды или bearer token.

Server sharing по умолчанию `off`. При явном `coarse-opt-in` отправляется одна replaceable weekly snapshot:

- module-level funnel `opened → attempted → understood → independent → retained`;
- lapses, remediation outcomes и coarse study-time bucket;
- bounded overload/stalled/review-debt flags;
- allowlisted diagnostic family;
- пять coarse time-to-mastery buckets;
- deterministic variant только для allowlisted content experiment.

Task IDs, точные timestamps, user ID и локальный event log в snapshot не входят. Сервер связывает строку с authenticated account только для честного export/delete lifecycle.

Course-health API применяет k=5 отдельно к трём типам slices:

1. week + module;
2. week для time-to-mastery;
3. week + experiment + variant.

Experiment slice намеренно не пересекается с module ID. Report не возвращает user rows, ranks или leaderboards и не объявляет variant победителем автоматически. Интерфейс требует нескольких недель, одинакового направления independent/retained и отсутствия ухудшения remediation.

Course actions формируются детерминированно из уже разрешённых cohort rows:

- проверить prerequisites при низком independent rate;
- добавить retrieval practice при слабом retained rate;
- переписать remediation при низком recovery rate;
- разделить lesson при частых overload/stalled signals.

Learner interventions тоже детерминированы и объясняют причину:

- overload — ≥6 попыток и ≤30% успешных в текущей сессии;
- repeated misconception — одна diagnostic family ≥3 раз в ≥2 задачах за 7 дней;
- stalled module — ≥5 попыток без independent evidence;
- review debt — ≥5 due reviews или oldest due ≥7 дней.

Opt-out удаляет server snapshots; отдельные export/delete доступны пользователю; account deletion очищает обе D1 analytics tables через cascade.

Подробный threat model: [`docs/learning-analytics-privacy.md`](docs/learning-analytics-privacy.md).

## Authentication

Пароль:

- 15–128 символов;
- PBKDF2-HMAC-SHA-256 с индивидуальной солью;
- versioned verifier;
- исходный пароль не хранится;
- после пяти неверных попыток вход временно блокируется.

После регистрации выдаются восемь одноразовых recovery-кодов. В D1 хранится только verifier; комплект не сохраняется приложением после подтверждения.

Подробности: [`docs/password-auth.md`](docs/password-auth.md).

## PWA и offline boundary

После первого успешного открытия service worker кэширует production HTML, CSS, JavaScript chunks, SVG и WASM. Офлайн доступны статические материалы, локальный progress, локальная learning analytics и SQLite workspace.

Если сеть пропала перед перезагрузкой вкладки, уже открытая браузерная сессия сохраняет локальное учебное пространство: сверху появляется постоянный статус «Локальная сессия — без подтверждения сервера», профиль и облачные действия скрываются, а новые решения помечаются как пока не синхронизированные. После восстановления сети приложение повторно проверяет токен и только затем возвращает профиль и отправляет локальный progress. Ответ `401` очищает кэш сессии и требует нового входа. Это гарантия для reload той же вкладки, а не для перезапуска браузера: эфемерный bearer-токен хранится в `sessionStorage` и не восстанавливается из постоянного хранилища.

Сеть нужна для auth, cloud sync, coarse analytics snapshots, профиля, AI и server-dialect reference API. Потеря сети переводит PostgreSQL/MySQL в локальный preview-only fallback с тем же запретом mastery.

Новая версия не активируется неожиданно: пользователь выбирает «Обновить сейчас» или «Позже».

## Локальный запуск

```bash
npm install
npm run dev
```

Полная проверка:

```bash
npm run check
npm run build
npm run validate:bundle
npm audit --omit=dev
npm run deploy:cloudflare:dry
npm run test:e2e
```

На Windows `npm run test:e2e` и файловые запуски через `npm run test:ui -- <аргументы Playwright>` автоматически выбирают свободный Worker-порт из диапазона `8792–8891`. Production preview проксирует `/api` в тот же runtime-порт, поэтому свежий `dist`, direct Playwright и PR Quality используют один маршрут без compile-time hardcode. Порт `8787`, занятый постоянным локальным сервисом Codex, не переиспользуется и его процесс не завершается. Явный изолированный запуск:

```powershell
$env:PLAYWRIGHT_WORKER_PORT = '8792'
npm run test:ui -- --project=desktop-foundation tests/e2e/academy.spec.ts
Remove-Item Env:PLAYWRIGHT_WORKER_PORT
```

Bundle gate сначала измеряет production `dist`, затем копирует его во временную папку с пробелами, искусственно превышает raw entry budget и требует точную ошибку. Поэтому зелёный результат доказывает и Windows path handling, и реальное применение лимита. Сгенерированные Worker types, TypeScript build-info и локальные Wrangler-логи игнорируются как воспроизводимые артефакты.

`monaco-editor@0.56.0` фиксирует `dompurify@3.4.8`, поэтому корневой npm override удерживает исправленный `dompurify@3.4.13`. PR Quality запускает `npm audit --omit=dev`; высокий/критический advisory блокирует merge, а редактор и PWA проверяются Playwright после каждого изменения lockfile.

`npm run check` валидирует TypeScript/Worker types, 240 task contracts, curriculum DAG, lessons, checkpoints, tracks, exams, 11×3 dialect cases, learning analytics privacy/effectiveness contracts, deployment smoke и D1 cascade invariants.

PR Quality дополнительно:

- собирает production bundle и проверяет raw/gzip budgets;
- выполняет все 22 PostgreSQL/MySQL Docker contracts;
- поднимает локальную D1;
- запускает desktop и Pixel 7 Playwright;
- перехватывает analytics snapshot request и проверяет allowlist `rows + mastery + experiments` без SQL/task IDs/user ID;
- проверяет actionable course-health, experiment guardrails и layered suppression UI;
- блокирует serious/critical axe violations.

## Cloudflare Free production stack

Production workflow использует только:

- Workers Static Assets;
- Worker API;
- D1;
- KV;
- Workers AI binding.

Не используются Containers, R2 или Hyperdrive. Workflow применяет migrations, разворачивает Worker/assets и запускает production smoke для auth, curriculum, concepts, checkpoints, capstones, assessment, privacy-first analytics, mastery, onboarding и всех 22 server-dialect reference previews.

Analytics production smoke проверяет default-off, opt-in, strict snapshot/mastery schemas, module/mastery/experiment k=5 suppression, export round-trip, opt-out deletion, account cascade и revoked session.

GitHub Actions secrets:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

## API

Публичные endpoints:

- `GET /api/health`
- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/password/reset`

Основные authenticated endpoints:

- auth sessions, password и recovery lifecycle;
- `GET|PUT|DELETE /api/profile`;
- progress/settings/curriculum sync;
- checkpoints, capstones и assessment reports;
- `GET|PUT /api/learning-analytics/preferences`;
- `PUT /api/learning-analytics/snapshot`;
- `GET /api/learning-analytics/report`;
- `GET /api/learning-analytics/export`;
- `DELETE /api/learning-analytics`;
- `GET|PUT /api/dialect-labs/progress`;
- `POST /api/dialect-labs/execute`;
- AI mentor/interviewer/debrief.

Worker не доверяет клиентскому `x-profile-id`: user ID определяется только из проверенной bearer session.

## Конфиденциальность

- Нет сторонних аналитических трекеров.
- Learning analytics default-off; server snapshot не содержит SQL, task IDs или user ID.
- Module, mastery и experiment cohorts меньше пяти contributors подавляются независимо.
- Аккаунту не нужны email, телефон или внешний профиль.
- Seed data полностью вымышлены.
- Password и recovery-коды не попадают в client diagnostics.
- Service worker не кэширует secrets или bearer token.
- Assessment evidence не содержит password/recovery/session token.
- Dialect progress хранит только lab/dialect/version, pass state, duration и digest — learner SQL в D1 не сохраняется.
- Production smokes создают временные аккаунты, проверяют cascade и удаляют их.


## Product identity и передача покупателю

Публичное имя, track, описание, homepage, repository/support URL, лицензионная подпись и privacy label находятся в одном файле [`config/product-identity.json`](config/product-identity.json). После изменения выполняются `npm run identity:generate`, `npm run identity:check` и production build.

Полная процедура ребрендинга, URL/security boundary и правило сохранения внутренних storage/API identifiers: [`docs/product-identity-handoff.md`](docs/product-identity-handoff.md).

## Лицензия

Исходный код распространяется по условиям файла [`LICENSE`](LICENSE) и не заявляется как open source. Сторонние зависимости сохраняют собственные лицензии и перечислены в [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).
