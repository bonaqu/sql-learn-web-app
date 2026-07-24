# Curriculum Studio

Curriculum Studio — отдельный lazy-контур SQL Academy, который связывает теорию, runnable examples, knowledge checks, существующие практические задачи и capstone-проекты.

## Curriculum graph

Источник контента находится в `src/data/curriculum.ts`. Модель строится поверх существующих `modules`, `moduleGuides` и `tasks`, поэтому теория и практика не расходятся в отдельных каталогах.

Для каждого из 20 модулей определены:

- стабильный lesson ID `lesson-<module>`;
- prerequisites;
- минимум три измеримых learning objectives;
- разделы «Модель и смысл», «Рабочий алгоритм» и «Ошибки и диагностика»;
- glossary;
- runnable SQLite example;
- knowledge check с объяснением;
- ссылки минимум на две задачи того же модуля.

Четыре checkpoints покрывают ключевые этапы курса. Три capstone-проекта моделируют production-like работу с вымышленным набором T-Bonk:

1. Incident Command Dashboard;
2. Customer Data Trust Audit;
3. T-Bonk SLA Executive Mart.

Каждый проект содержит deliverables, acceptance criteria, starter SQL и rubric с суммарным весом 100%.

## Lesson Reader

Reader поддерживает:

- поиск по заголовкам, objectives, theory, pitfalls, glossary и knowledge checks;
- deep links через hash-параметры `lesson`, `section` и `project`;
- previous/next navigation;
- bookmark последнего раздела;
- отметку изученных sections;
- runnable examples на локальном `sql.js` и общем training dataset;
- доступные result tables;
- knowledge checks с сохранением ответа;
- переход в связанную Practice/Interview/Puzzle задачу.

Урок считается завершённым только когда отмечены все его theory sections и knowledge check решён правильно.

## Project Lab

Project Lab сохраняет отдельно для каждого аккаунта:

- SQL draft до 40 000 символов;
- инженерные заметки до 12 000 символов;
- завершённые deliverables;
- статус завершения проекта.

Проект нельзя завершить, пока не отмечены все deliverables и draft не содержит содержательный SQL.

## Progress storage

Curriculum не расширяет `Progress v4`. Он использует отдельный versioned формат `CurriculumProgressV1`:

```ts
{
  version: 1,
  completedSections: string[],
  completedLessons: string[],
  completedProjects: string[],
  answers: Record<string, CurriculumCheckAnswer>,
  projectDrafts: Record<string, ProjectDraft>,
  bookmark: CurriculumBookmark | null,
  updatedAt: string
}
```

Локальный ключ включает ID текущего пользователя. Повреждённые или неизвестные IDs удаляются sanitizer-слоем при загрузке.

Merge contract:

- completion arrays объединяются как множества;
- правильный knowledge-check ответ не теряется;
- ответы и drafts сравниваются по собственному timestamp;
- bookmark выбирается по последнему `updatedAt`;
- неизвестный content ID не попадает в сохранённое состояние.

## Cloud sync

Authenticated endpoint:

- `GET /api/curriculum/progress`;
- `PUT /api/curriculum/progress`.

D1 хранит payload в таблице `curriculum_progress`, связанной внешним ключом с `users(user_id)` и `ON DELETE CASCADE`.

PUT принимает:

```json
{
  "progress": { "version": 1 },
  "baseUpdatedAt": "2026-07-24T20:00:00.000Z"
}
```

Обновление выполняется условно по `user_id + baseUpdatedAt`. При конкурентном изменении Worker возвращает `409` с актуальной облачной копией. Клиент повторно объединяет local/remote и делает до двух повторных попыток. Это предотвращает молчаливую потерю draft при работе с нескольких устройств.

`CurriculumSyncAgent`:

- синхронизирует состояние после входа;
- debounce-синхронизирует локальные изменения;
- повторяет sync после события `online`;
- не блокирует локальную работу без сети;
- очищает auth session при `401`.

## Offline boundary

После первого production visit service worker кэширует lazy Curriculum Portal, CSS, JavaScript и `sql.js` assets в рамках общего PWA precache. Без сети доступны:

- просмотр уже закэшированных уроков;
- поиск и navigation;
- локальные отметки и bookmarks;
- runnable SQLite examples, если WASM уже сохранён браузером;
- Project Lab drafts.

До восстановления сети недоступна только облачная синхронизация. Локальные изменения не удаляются.

## Lazy loading

В initial application entry входят только кнопки запуска и event contract. `CurriculumPortal`, curriculum dataset и его CSS загружаются при первом hover, focus или open.

Bundle gate требует отдельный `CurriculumPortal-*` chunk и блокирует его появление в `dist/index.html`.

## Quality gates

`npm run validate:curriculum` проверяет:

- соответствие 20 lessons существующим modules;
- уникальность lesson/section/check/checkpoint/project IDs;
- обязательные objectives, sections, pitfalls, glossary и practice links;
- известные task/module references;
- ацикличность prerequisites;
- выполнение всех 20 examples на SQLite seed;
- checkpoint criteria;
- deliverables и acceptance criteria;
- rubric weights = 100%;
- D1 migration и cascade foreign key.

Playwright дополнительно проверяет:

- открытие desktop/mobile Curriculum Studio;
- runnable example и result table;
- завершение урока;
- Project Lab draft и completion;
- explicit D1 sync;
- получение draft после входа на втором устройстве;
- focus return;
- Pixel 7 without horizontal overflow;
- отсутствие axe serious/critical violations.
