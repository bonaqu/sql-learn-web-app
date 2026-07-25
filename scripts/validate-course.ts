import path from 'node:path';
import { fileURLToPath } from 'node:url';
import initSqlJs from 'sql.js';
import { advancedModules } from '../src/data/advanced-syllabus.ts';
import { modules, tasks, TOTAL_TASK_COUNT } from '../src/data/course-catalog.ts';
import { trainingSeedSql } from '../src/data/training-dataset.ts';

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(currentDirectory, '..');

const fail = (message: string): never => {
  console.error(`COURSE VALIDATION FAILED: ${message}`);
  process.exit(1);
};

if (TOTAL_TASK_COUNT !== 240 || tasks.length !== 240) fail(`expected 240 tasks, received ${tasks.length}`);
if (modules.length !== 32) fail(`expected 32 modules, received ${modules.length}`);
if (new Set(tasks.map(task => task.id)).size !== tasks.length) fail('task IDs are not unique');
if (new Set(tasks.map(task => task.solution.replace(/\s+/g, ' ').trim())).size < 220) {
  fail('too many task solutions are duplicates');
}

const advancedIds = new Set(advancedModules.map(([id]) => id));
for (const [moduleId] of modules) {
  const moduleTasks = tasks.filter(task => task.module === moduleId);
  const expected = advancedIds.has(moduleId as never) ? 10 : 6;
  if (moduleTasks.length !== expected) fail(`module ${moduleId} has ${moduleTasks.length} tasks instead of ${expected}`);
}

const SQL = await initSqlJs({
  locateFile: file => path.join(projectRoot, 'node_modules', 'sql.js', 'dist', file)
});

const failures: string[] = [];
const warnings: string[] = [];
for (const task of tasks) {
  if (!task.title.trim() || !task.description.trim() || !task.solution.trim()) {
    failures.push(`${task.id}: missing required learning content`);
    continue;
  }
  if (task.hints.length < 2) failures.push(`${task.id}: expected at least two hints`);
  if (!task.guide.summary || !task.guide.mentalModel || !task.guide.checklist.length) {
    failures.push(`${task.id}: incomplete module guide`);
  }

  const database = new SQL.Database();
  try {
    database.run(trainingSeedSql);
    const result = database.exec(task.solution);
    if (!result.length) warnings.push(`${task.id}: valid solution currently returns an empty result set`);
  } catch (error) {
    failures.push(`${task.id}: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    database.close();
  }
}

if (warnings.length) {
  console.warn(`Course validation warnings (${warnings.length}):\n${warnings.join('\n')}`);
}
if (failures.length) {
  console.error(failures.join('\n'));
  fail(`${failures.length} task(s) are invalid`);
}

console.log(`Course validation passed: ${tasks.length} executable solutions across ${modules.length} modules.`);
