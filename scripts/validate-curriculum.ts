import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import initSqlJs from 'sql.js';
import { capstoneProjects, curriculumCheckpoints, curriculumLessons } from '../src/data/complete-curriculum';
import { modules, tasks } from '../src/data/course-catalog';
import { trainingSeedSql } from '../src/data/training-dataset';

const require = createRequire(import.meta.url);
const wasmPath = require.resolve('sql.js/dist/sql-wasm.wasm');
const SQL = await initSqlJs({ locateFile: () => wasmPath });

const errors: string[] = [];
const curriculumMigration = readFileSync(new URL('../migrations/0010_curriculum_progress.sql', import.meta.url), 'utf8');
const assert = (condition: unknown, message: string) => {
  if (!condition) errors.push(message);
};
const unique = (values: string[]) => new Set(values).size === values.length;
const moduleIds = new Set(modules.map(([id]) => id));
const taskIds = new Set(tasks.map(task => task.id));
const lessonIds = new Set(curriculumLessons.map(lesson => lesson.id));
const sectionIds = curriculumLessons.flatMap(lesson => lesson.sections.map(section => section.id));
const checkIds = curriculumLessons.map(lesson => lesson.check.id);

assert(curriculumMigration.includes('CREATE TABLE IF NOT EXISTS curriculum_progress'), 'Curriculum D1 migration must create curriculum_progress');
assert(curriculumMigration.includes('REFERENCES users(user_id) ON DELETE CASCADE'), 'Curriculum progress must cascade with the authenticated user');
assert(curriculumLessons.length === modules.length, `Expected ${modules.length} lessons, got ${curriculumLessons.length}`);
assert(unique([...lessonIds]), 'Lesson IDs must be unique');
assert(unique(sectionIds), 'Section IDs must be unique');
assert(unique(checkIds), 'Knowledge check IDs must be unique');

for (const [index, lesson] of curriculumLessons.entries()) {
  assert(moduleIds.has(lesson.module), `${lesson.id}: unknown module ${lesson.module}`);
  assert(lesson.id === `lesson-${lesson.module}`, `${lesson.id}: lesson ID must be stable and module-based`);
  assert(lesson.title === modules[index][1], `${lesson.id}: title differs from course module`);
  assert(lesson.objectives.length >= 3, `${lesson.id}: requires at least 3 objectives`);
  assert(lesson.sections.length >= 2, `${lesson.id}: requires at least 2 theory sections`);
  assert(lesson.sections.some(section => section.kind === 'pitfalls'), `${lesson.id}: missing pitfalls section`);
  assert(lesson.glossary.length >= 2, `${lesson.id}: requires at least 2 glossary entries`);
  assert(lesson.example.sql.trim().length >= 12, `${lesson.id}: runnable example is empty`);
  assert(lesson.check.options.length >= 3, `${lesson.id}: check requires at least 3 options`);
  assert(lesson.check.correctIndex >= 0 && lesson.check.correctIndex < lesson.check.options.length, `${lesson.id}: invalid correctIndex`);
  assert(lesson.check.explanation.trim().length >= 20, `${lesson.id}: check explanation is too short`);
  assert(lesson.practiceTaskIds.length >= 2, `${lesson.id}: requires at least 2 linked practice tasks`);
  assert(unique(lesson.practiceTaskIds), `${lesson.id}: duplicate practice task links`);
  for (const taskId of lesson.practiceTaskIds) {
    assert(taskIds.has(taskId), `${lesson.id}: unknown practice task ${taskId}`);
    const task = tasks.find(item => item.id === taskId);
    assert(task?.module === lesson.module, `${lesson.id}: task ${taskId} belongs to ${task?.module}`);
  }
  for (const prerequisite of lesson.prerequisites) {
    assert(moduleIds.has(prerequisite), `${lesson.id}: unknown prerequisite ${prerequisite}`);
    assert(prerequisite !== lesson.module, `${lesson.id}: self prerequisite`);
  }

  const database = new SQL.Database();
  try {
    database.run(trainingSeedSql);
    database.exec(lesson.example.sql);
  } catch (reason) {
    errors.push(`${lesson.id}: example failed: ${reason instanceof Error ? reason.message : String(reason)}`);
  } finally {
    database.close();
  }
}

const lessonByModule = new Map(curriculumLessons.map(lesson => [lesson.module, lesson]));
const visiting = new Set<string>();
const visited = new Set<string>();
function visit(moduleId: string, path: string[]) {
  if (visiting.has(moduleId)) {
    errors.push(`Prerequisite cycle: ${[...path, moduleId].join(' -> ')}`);
    return;
  }
  if (visited.has(moduleId)) return;
  visiting.add(moduleId);
  const lesson = lessonByModule.get(moduleId as never);
  for (const prerequisite of lesson?.prerequisites || []) visit(prerequisite, [...path, moduleId]);
  visiting.delete(moduleId);
  visited.add(moduleId);
}
for (const moduleId of moduleIds) visit(moduleId, []);

const checkpointIds = curriculumCheckpoints.map(checkpoint => checkpoint.id);
assert(unique(checkpointIds), 'Checkpoint IDs must be unique');
for (const checkpoint of curriculumCheckpoints) {
  assert(checkpoint.moduleIds.length >= 3, `${checkpoint.id}: requires at least 3 modules`);
  assert(checkpoint.taskIds.length >= 3, `${checkpoint.id}: requires at least 3 tasks`);
  assert(checkpoint.passingScore >= 60 && checkpoint.passingScore <= 100, `${checkpoint.id}: passingScore out of range`);
  assert(unique(checkpoint.criteria), `${checkpoint.id}: duplicate criteria`);
  for (const moduleId of checkpoint.moduleIds) assert(moduleIds.has(moduleId), `${checkpoint.id}: unknown module ${moduleId}`);
  for (const taskId of checkpoint.taskIds) assert(taskIds.has(taskId), `${checkpoint.id}: unknown task ${taskId}`);
}

assert(capstoneProjects.length >= 3, 'At least 3 capstone projects are required');
const projectIds = capstoneProjects.map(project => project.id);
assert(unique(projectIds), 'Project IDs must be unique');
for (const project of capstoneProjects) {
  assert(project.deliverables.length >= 3, `${project.id}: requires at least 3 deliverables`);
  assert(project.rubric.length >= 4, `${project.id}: requires at least 4 rubric criteria`);
  assert(project.rubric.reduce((sum, item) => sum + item.weight, 0) === 100, `${project.id}: rubric weights must sum to 100`);
  assert(unique(project.deliverables.map(item => item.id)), `${project.id}: duplicate deliverable IDs`);
  assert(unique(project.rubric.map(item => item.id)), `${project.id}: duplicate rubric IDs`);
  assert(unique(project.rubric.map(item => item.title)), `${project.id}: duplicate rubric titles`);
  for (const moduleId of project.moduleIds) assert(moduleIds.has(moduleId), `${project.id}: unknown module ${moduleId}`);
  for (const deliverable of project.deliverables) {
    assert(deliverable.acceptance.length >= 3, `${project.id}/${deliverable.id}: requires at least 3 acceptance criteria`);
    assert(unique(deliverable.acceptance), `${project.id}/${deliverable.id}: duplicate acceptance criteria`);
    assert(deliverable.starterSql.trim().length >= 10, `${project.id}/${deliverable.id}: starter SQL is too short`);
  }
}

const allProjectDeliverables = capstoneProjects.flatMap(project => project.deliverables.map(item => item.id));
const allRubricIds = capstoneProjects.flatMap(project => project.rubric.map(item => item.id));
assert(unique(allProjectDeliverables), 'Deliverable IDs must be globally unique');
assert(unique(allRubricIds), 'Rubric IDs must be globally unique');

if (errors.length) {
  console.error(`Curriculum validation failed with ${errors.length} issue(s):`);
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`Curriculum validation passed: ${curriculumLessons.length} lessons, ${sectionIds.length} sections, ${curriculumCheckpoints.length} checkpoints, ${capstoneProjects.length} capstone projects and ${curriculumLessons.length} runnable SQLite examples.`);
