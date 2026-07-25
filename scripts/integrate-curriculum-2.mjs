import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = process.cwd();
const read = path => readFileSync(join(root, path), 'utf8');
const write = (path, content) => writeFileSync(join(root, path), content);

function replaceOnce(source, before, after, label) {
  const count = source.split(before).length - 1;
  if (count !== 1) throw new Error(`${label}: expected 1 match, got ${count}`);
  return source.replace(before, after);
}

function filesUnder(directory) {
  const output = [];
  for (const name of readdirSync(join(root, directory))) {
    const absolute = join(root, directory, name);
    if (statSync(absolute).isDirectory()) output.push(...filesUnder(relative(root, absolute)));
    else if (/\.(?:ts|tsx)$/.test(name)) output.push(relative(root, absolute));
  }
  return output;
}

const courseImportExclusions = new Set([
  'src/data/course.ts',
  'src/data/curriculum.ts',
  'src/data/advanced-syllabus.ts',
  'src/data/course-catalog.ts',
  'src/data/advanced-curriculum.ts',
  'src/data/complete-curriculum.ts'
]);
const curriculumImportExclusions = new Set([
  'src/data/curriculum.ts',
  'src/data/advanced-curriculum.ts',
  'src/data/complete-curriculum.ts'
]);

for (const path of [...filesUnder('src'), ...filesUnder('scripts'), ...filesUnder('tests')]) {
  let source = read(path);
  const original = source;
  if (!courseImportExclusions.has(path)) {
    source = source
      .replaceAll("from './data/course'", "from './data/course-catalog'")
      .replaceAll("from '../data/course'", "from '../data/course-catalog'")
      .replaceAll("from '../../data/course'", "from '../../data/course-catalog'")
      .replaceAll("from '../src/data/course.ts'", "from '../src/data/course-catalog.ts'")
      .replaceAll("from '../src/data/course'", "from '../src/data/course-catalog'");
  }
  if (!curriculumImportExclusions.has(path)) {
    source = source
      .replaceAll("from './data/curriculum'", "from './data/complete-curriculum'")
      .replaceAll("from '../data/curriculum'", "from '../data/complete-curriculum'")
      .replaceAll("from '../../data/curriculum'", "from '../../data/complete-curriculum'")
      .replaceAll("from '../src/data/curriculum'", "from '../src/data/complete-curriculum'");
  }
  if (source !== original) write(path, source);
}

let curriculum = read('src/data/curriculum.ts');
curriculum = replaceOnce(
  curriculum,
  "import { moduleGuides, modules, tasks } from './course';\n\nexport type CourseModuleId = typeof modules[number][0];",
  "import { moduleGuides, modules, tasks } from './course';\nimport type { AdvancedModuleId } from './advanced-syllabus';\n\ntype CoreModuleId = typeof modules[number][0];\nexport type CourseModuleId = CoreModuleId | AdvancedModuleId;",
  'curriculum module union'
);
curriculum = replaceOnce(curriculum, 'const blueprints: Record<CourseModuleId, Blueprint> = {', 'const blueprints: Record<CoreModuleId, Blueprint> = {', 'core blueprint typing');
write('src/data/curriculum.ts', curriculum);

let advancedCurriculum = read('src/data/advanced-curriculum.ts');
advancedCurriculum = replaceOnce(
  advancedCurriculum,
  "      prerequisites: [module] as CurriculumLesson['prerequisites'],",
  "      prerequisites: basePrerequisites,",
  'advanced applied prerequisite'
);
write('src/data/advanced-curriculum.ts', advancedCurriculum);

let app = read('src/App.tsx');
app = app.replace(
  "import { achievements, modules, SqlTask, tasks } from './data/course-catalog';",
  "import { achievements, modules, SqlTask, tasks, TOTAL_TASK_COUNT } from './data/course-catalog';"
);
app = app.replace('<span><BrainCircuit /> 120 задач</span>', '<span><BrainCircuit /> {TOTAL_TASK_COUNT} задач</span>');
app = app.replace('<strong>{progress.completed.length}<span>/120</span></strong>', '<strong>{progress.completed.length}<span>/{TOTAL_TASK_COUNT}</span></strong>');
write('src/App.tsx', app);

let learningPath = read('src/lib/learning-path.ts');
learningPath = learningPath.replace(/export const phaseDefinitions = \[[\s\S]*?\] as const;/, `export const phaseDefinitions = [
  {
    id: 'foundation',
    title: 'I. Надёжная база',
    subtitle: 'Контракт результата, фильтры, сортировка и агрегаты',
    moduleIds: ['sql-thinking', 'select', 'filtering', 'sorting', 'aggregates', 'grouping']
  },
  {
    id: 'composition',
    title: 'II. Конструирование запросов',
    subtitle: 'JOIN, подзапросы, CTE, окна, даты, текст и множества',
    moduleIds: ['joins', 'subqueries', 'cte', 'windows', 'dates', 'text', 'set-ops']
  },
  {
    id: 'production-core',
    title: 'III. Production core',
    subtitle: 'Качество, индексы, планы, транзакции и схема',
    moduleIds: ['data-quality', 'indexes', 'explain', 'transactions', 'schema']
  },
  {
    id: 'support-track',
    title: 'IV. Support Analytics',
    subtitle: 'SLA, операционные метрики и базовая витрина T-Bonk',
    moduleIds: ['support', 'final']
  },
  {
    id: 'data-change',
    title: 'V. Изменения и целостность',
    subtitle: 'DML, schema evolution и продвинутая NULL-логика',
    moduleIds: ['dml', 'schema-evolution', 'null-logic-advanced']
  },
  {
    id: 'advanced-querying',
    title: 'VI. Advanced querying',
    subtitle: 'Условные метрики, existence patterns и рекурсивные CTE',
    moduleIds: ['conditional-aggregation', 'advanced-joins', 'recursive-cte']
  },
  {
    id: 'modern-sql',
    title: 'VII. Modern SQL',
    subtitle: 'Window frames, JSON и безопасная параметризация',
    moduleIds: ['window-frames', 'json-sql', 'sql-security']
  },
  {
    id: 'production-operations',
    title: 'VIII. Production operations',
    subtitle: 'Concurrency, keyset pagination и SQL-расследования',
    moduleIds: ['concurrency', 'pagination-patterns', 'incident-investigation']
  }
] as const;`);
write('src/lib/learning-path.ts', learningPath);

let workerCurriculum = read('worker/curriculum.ts');
workerCurriculum = workerCurriculum
  .replace('validIdList(value.completedSections, ID_PATTERN, 120)', 'validIdList(value.completedSections, ID_PATTERN, 240)')
  .replace('validIdList(value.completedLessons, LESSON_PATTERN, 40)', 'validIdList(value.completedLessons, LESSON_PATTERN, 80)')
  .replace('if (entries.length > 60) return false;', 'if (entries.length > 120) return false;');
write('worker/curriculum.ts', workerCurriculum);

let packageJson = JSON.parse(read('package.json'));
packageJson.version = '3.0.0';
write('package.json', `${JSON.stringify(packageJson, null, 2)}\n`);

let indexHtml = read('index.html').replaceAll('120 практических задач', '240 практических задач').replaceAll('120 задач', '240 задач');
write('index.html', indexHtml);

let readme = read('README.md')
  .replaceAll('20 модулей', '32 модуля')
  .replaceAll('120 задач', '240 задач')
  .replaceAll('120 SQL', '240 SQL');
write('README.md', readme);

console.log('Curriculum 2 integration patch applied.');
