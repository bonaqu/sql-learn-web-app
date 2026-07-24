import { readFileSync, writeFileSync } from 'node:fs';

function read(path) { return readFileSync(path, 'utf8'); }
function write(path, value) { writeFileSync(path, value); }

function replaceOnce(source, before, after, label) {
  const count = source.split(before).length - 1;
  if (count !== 1) throw new Error(`${label}: expected 1 match, found ${count}`);
  return source.replace(before, after);
}

function replaceRegexOnce(source, pattern, after, label) {
  const matches = source.match(new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`)) || [];
  if (matches.length !== 1) throw new Error(`${label}: expected 1 regex match, found ${matches.length}`);
  return source.replace(pattern, after);
}

let app = read('src/App.tsx');
app = replaceOnce(
  app,
  "import { achievements, modules, SqlTask, tasks } from './data/course';\n",
  "import { achievements, modules, SqlTask, tasks } from './data/course';\nimport { trainingSeedSql } from './data/training-dataset';\n",
  'App training dataset import'
);
app = replaceRegexOnce(
  app,
  /const seedSql = `[\s\S]*?CREATE INDEX idx_tickets_priority_status ON tickets\(priority, status\);\n`;\n\n/,
  '',
  'App duplicated seed removal'
);
app = replaceOnce(app, '    database.run(seedSql);', '    database.run(trainingSeedSql);', 'App seed use');
app = replaceOnce(
  app,
  "        <button type=\"button\" data-testid=\"learning-path-trigger\" onMouseEnter={() => preloadDeferredFeature('learning-path')} onFocus={() => preloadDeferredFeature('learning-path')} onClick={() => openDeferredFeature('learning-path')}><Route /><span>Учебный путь</span></button>\n        <Nav icon={<BookOpen />} label=\"Каталог\" active={view === 'catalog'} onClick={() => navigate('catalog')} />",
  "        <button type=\"button\" data-testid=\"learning-path-trigger\" onMouseEnter={() => preloadDeferredFeature('learning-path')} onFocus={() => preloadDeferredFeature('learning-path')} onClick={() => openDeferredFeature('learning-path')}><Route /><span>Учебный путь</span></button>\n        <button type=\"button\" data-testid=\"curriculum-trigger\" onMouseEnter={() => preloadDeferredFeature('curriculum')} onFocus={() => preloadDeferredFeature('curriculum')} onClick={() => openDeferredFeature('curriculum')}><GraduationCap /><span>Уроки и проекты</span></button>\n        <Nav icon={<BookOpen />} label=\"Каталог\" active={view === 'catalog'} onClick={() => navigate('catalog')} />",
  'App desktop curriculum trigger'
);
app = replaceOnce(
  app,
  "      <button type=\"button\" data-testid=\"learning-path-mobile-trigger\" onTouchStart={() => preloadDeferredFeature('learning-path')} onFocus={() => preloadDeferredFeature('learning-path')} onClick={() => openDeferredFeature('learning-path')}><span className=\"mobile-nav-icon\"><Route /></span><small>Путь</small></button>\n      <MobileNav icon={<BrainCircuit />} label=\"Практика\" active={view === 'practice'} onClick={() => navigate('practice')} />",
  "      <button type=\"button\" data-testid=\"learning-path-mobile-trigger\" onTouchStart={() => preloadDeferredFeature('learning-path')} onFocus={() => preloadDeferredFeature('learning-path')} onClick={() => openDeferredFeature('learning-path')}><span className=\"mobile-nav-icon\"><Route /></span><small>Путь</small></button>\n      <button type=\"button\" data-testid=\"curriculum-mobile-trigger\" onTouchStart={() => preloadDeferredFeature('curriculum')} onFocus={() => preloadDeferredFeature('curriculum')} onClick={() => openDeferredFeature('curriculum')}><span className=\"mobile-nav-icon\"><GraduationCap /></span><small>Уроки</small></button>\n      <MobileNav icon={<BrainCircuit />} label=\"Практика\" active={view === 'practice'} onClick={() => navigate('practice')} />",
  'App mobile curriculum trigger'
);
write('src/App.tsx', app);

let curriculum = read('src/components/CurriculumPortal.tsx');
curriculum = replaceOnce(curriculum, '  curriculumCompletion,\n', '', 'Curriculum invalid import');
write('src/components/CurriculumPortal.tsx', curriculum);

let path = read('src/components/LearningPathPortal.tsx');
path = replaceOnce(
  path,
  "import { SqlTask } from '../data/course';\n",
  "import { SqlTask } from '../data/course';\nimport { openAcademyTask } from '../lib/academy-navigation';\n",
  'Learning Path navigation import'
);
path = replaceOnce(
  path,
  "function openTaskInAcademy(task: SqlTask) {\n  const navLabel = task.mode === 'interview' ? 'Interview' : task.mode === 'puzzle' ? 'SQL Puzzle' : 'Practice';\n  const desktopNav = Array.from(document.querySelectorAll<HTMLButtonElement>('.sidebar nav button'))\n    .find(button => button.textContent?.trim().startsWith(navLabel));\n  desktopNav?.click();\n\n  let attempts = 0;\n  const select = () => {\n    const row = Array.from(document.querySelectorAll<HTMLButtonElement>('.task-row'))\n      .find(button => button.querySelector('strong')?.textContent === task.title);\n    if (row) {\n      row.click();\n      row.scrollIntoView({ block: 'nearest' });\n      return;\n    }\n    attempts += 1;\n    if (attempts < 20) window.setTimeout(select, 60);\n  };\n  window.setTimeout(select, 40);\n}\n\n",
  '',
  'Learning Path old navigation helper'
);
path = replaceOnce(path, '    openTaskInAcademy(task);', '    openAcademyTask(task.id);', 'Learning Path task navigation call');
write('src/components/LearningPathPortal.tsx', path);

console.log('Curriculum integration patch applied.');
