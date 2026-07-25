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
const normalizedSql = (value: string) => value.replace(/\s+/g, ' ').trim().toLowerCase();

if (TOTAL_TASK_COUNT !== 240 || tasks.length !== 240) fail(`expected 240 tasks, received ${tasks.length}`);
if (modules.length !== 32) fail(`expected 32 modules, received ${modules.length}`);
if (new Set(tasks.map(task => task.id)).size !== tasks.length) fail('task IDs are not unique');
const taskFingerprints = tasks.map(task => JSON.stringify([
  task.module,
  task.title.trim(),
  task.description.trim(),
  task.starter.trim(),
  normalizedSql(task.solution)
]));
const fingerprintOwners = new Map<string, string[]>();
taskFingerprints.forEach((fingerprint, index) => {
  fingerprintOwners.set(fingerprint, [...(fingerprintOwners.get(fingerprint) || []), tasks[index].id]);
});
const duplicateFingerprints = Array.from(fingerprintOwners.entries()).filter(([, ids]) => ids.length > 1);
if (duplicateFingerprints.length) {
  for (const [fingerprint, ids] of duplicateFingerprints) {
    console.error(`Duplicate task contract ${ids.join(', ')}: ${fingerprint}`);
  }
  fail(`${duplicateFingerprints.length} duplicate task contract group(s)`);
}

const advancedIds = new Set<string>(advancedModules.map(([id]) => id));
for (const [moduleId] of modules) {
  const moduleTasks = tasks.filter(task => task.module === moduleId);
  const advanced = advancedIds.has(moduleId);
  const expected = advanced ? 10 : 6;
  if (moduleTasks.length !== expected) fail(`module ${moduleId} has ${moduleTasks.length} tasks instead of ${expected}`);
  if (advanced && new Set(moduleTasks.map(task => normalizedSql(task.solution))).size < 8) {
    fail(`advanced module ${moduleId} has insufficient SQL variation`);
  }
}

const SQL = await initSqlJs({
  locateFile: file => path.join(projectRoot, 'node_modules', 'sql.js', 'dist', file)
});

const failures: string[] = [];
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
    if (!result.length || result.every(item => item.values.length === 0)) {
      failures.push(`${task.id}: valid solution must return an observable result set`);
    }
  } catch (error) {
    failures.push(`${task.id}: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    database.close();
  }
}

if (failures.length) {
  console.error(failures.join('\n'));
  fail(`${failures.length} task(s) are invalid`);
}

console.log(`Course validation passed: ${tasks.length} executable result contracts across ${modules.length} modules.`);
