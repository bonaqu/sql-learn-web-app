import { readFileSync, writeFileSync } from 'node:fs';

const path = 'README.md';
let source = readFileSync(path, 'utf8');
function patch(before, after, label) {
  const count = source.split(before).length - 1;
  if (count !== 1) throw new Error(`${label}: expected 1 match, found ${count}`);
  source = source.replace(before, after);
}

patch(
  '- 20 учебных модулей и 120 автоматически проверяемых задач.\n- Adaptive Learning Path с четырьмя этапами и контрольными точками.',
  '- 20 учебных модулей и 120 автоматически проверяемых задач.\n- Curriculum Studio: 20 структурированных уроков, 60 theory sections, glossary, runnable examples и knowledge checks.\n- Project Lab с тремя production-like T-Bonk capstone-проектами, deliverables, drafts и rubric.\n- Cross-device curriculum sync через D1 с optimistic concurrency и deterministic conflict merge.\n- Adaptive Learning Path с четырьмя этапами и контрольными точками.',
  'README feature bullets'
);
patch(
  '- Lazy loading Learning Path, Assessment Center, SQLite, Monaco и графика активности.',
  '- Lazy loading Curriculum Studio, Learning Path, Assessment Center, SQLite, Monaco и графика активности.',
  'README lazy feature bullet'
);
patch(
  '- Cloudflare D1 для пользователей, сессий, recovery-кодов, прогресса и assessment reports.',
  '- Cloudflare D1 для пользователей, сессий, recovery-кодов, task progress, curriculum drafts и assessment reports.',
  'README D1 feature bullet'
);
patch(
  'Readiness использует mastery модулей, пройденные checkpoints и результаты Interview Mode. AI Coach получает только агрегированный учебный профиль и список рекомендованных тем; готовые SQL-решения в этом режиме запрещены.\n\n## Accessibility и клавиатура',
  `Readiness использует mastery модулей, пройденные checkpoints и результаты Interview Mode. AI Coach получает только агрегированный учебный профиль и список рекомендованных тем; готовые SQL-решения в этом режиме запрещены.

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

Подробная архитектура: [\`docs/curriculum-studio.md\`](docs/curriculum-studio.md).

## Accessibility и клавиатура`,
  'README Curriculum Studio section'
);
patch(
  '- Profile, Learning Path и Assessment Center удерживают фокус внутри открытого dialog;',
  '- Profile, Curriculum Studio, Learning Path и Assessment Center удерживают фокус внутри открытого dialog;',
  'README dialog accessibility'
);
patch(
  '- синхронизации прогресса и assessment reports;',
  '- синхронизации task progress, curriculum drafts и assessment reports;',
  'README offline sync boundary'
);
patch(
  'Learning Path, Assessment Center, SQLite, Monaco и ActivityChart не входят в обязательную стартовую загрузку.',
  'Curriculum Studio, Learning Path, Assessment Center, SQLite, Monaco и ActivityChart не входят в обязательную стартовую загрузку.',
  'README lazy boundary paragraph'
);
patch(
  '`npm run check` проверяет TypeScript, 120 SQL-решений, инварианты Adaptive Learning Path и Assessment Center: deterministic selection, diversity, prerequisites, scoring, report ranges и внешний ключ D1 к реальному `users.user_id`.',
  '`npm run check` проверяет TypeScript, 120 SQL-решений, инварианты Adaptive Learning Path и Assessment Center, а также curriculum graph: 20 lessons, prerequisite DAG, 20 runnable SQLite examples, task/checkpoint/project references, rubric weights и D1 cascade foreign key.',
  'README check description'
);
patch(
  'Bundle gate ограничивает initial entry, общий CSS и каждый крупный chunk одновременно в raw и gzip представлении. Он также требует отдельные lazy boundaries для Assessment Center, Learning Path, SQLite, ActivityChart и SqlEditor и запрещает ссылаться на них из `dist/index.html`.',
  'Bundle gate ограничивает initial entry, общий CSS и каждый крупный chunk одновременно в raw и gzip представлении. Он также требует отдельные lazy boundaries для Curriculum Studio, Assessment Center, Learning Path, SQLite, ActivityChart и SqlEditor и запрещает ссылаться на них из `dist/index.html`.',
  'README bundle gate'
);
patch(
  'Browser gate проверяет обязательный auth screen, регистрацию, восемь recovery-кодов, password reset, одноразовость кода, отзыв сессий, multi-device progress sync, профиль, существующие Academy/Learning Path flows, assessment resume/expiry, запрет подсказок, AI Interviewer, skill report sync, keyboard-only focus flows, offline/update UX, reduced motion, axe-core и Pixel 7 layout.',
  'Browser gate проверяет обязательный auth screen, регистрацию, восемь recovery-кодов, password reset, одноразовость кода, отзыв сессий, multi-device task/curriculum sync, профиль, Academy/Learning Path/Curriculum flows, runnable lesson examples, project completion, assessment resume/expiry, запрет подсказок, AI Interviewer, skill report sync, keyboard-only focus flows, offline/update UX, reduced motion, axe-core и Pixel 7 layout.',
  'README browser gate'
);
patch(
  '- `GET|PUT /api/settings`\n- `POST /api/mentor`',
  '- `GET|PUT /api/settings`\n- `GET|PUT /api/curriculum/progress`\n- `POST /api/mentor`',
  'README curriculum API'
);
patch(
  '- В браузере хранится отзываемый session token и локальная копия учебного прогресса.',
  '- В браузере хранится отзываемый session token, локальная копия task progress и curriculum drafts текущего аккаунта.',
  'README local privacy storage'
);

writeFileSync(path, source);
