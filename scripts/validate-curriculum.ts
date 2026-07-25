import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import initSqlJs from 'sql.js';
import {
  capstoneProjects,
  curriculumCheckpoints,
  curriculumLessons
} from '../src/data/complete-curriculum';
import { modules, tasks } from '../src/data/course-catalog';
import { advancedModules } from '../src/data/advanced-syllabus';
import { trainingSeedSql } from '../src/data/training-dataset';
import { dialectPatterns, dialects } from '../src/data/sql-dialects';
import { sqlExams, sqlTracks, syllabusCompetencies } from '../src/data/sql-exams';

const require = createRequire(import.meta.url);
const wasmPath = require.resolve('sql.js/dist/sql-wasm.wasm');
const SQL = await initSqlJs({ locateFile: () => wasmPath });

const errors: string[] = [];
const curriculumMigration = readFileSync(new URL('../migrations/0010_curriculum_progress.sql', import.meta.url), 'utf8');
const assert = (condition: unknown, message: string) => {
  if (!condition) errors.push(message);
};
const unique = (values: string[]) => new Set(values).size === values.length;
const moduleIds = new Set<string>(modules.map(([id]) => id));
const advancedModuleIds = new Set<string>(advancedModules.map(([id]) => id));
const taskIds = new Set(tasks.map(task => task.id));
const lessonIds = curriculumLessons.map(lesson => lesson.id);
const sectionIds = curriculumLessons.flatMap(lesson => lesson.sections.map(section => section.id));
const checkIds = curriculumLessons.map(lesson => lesson.check.id);

assert(curriculumMigration.includes('CREATE TABLE IF NOT EXISTS curriculum_progress'), 'Curriculum D1 migration must create curriculum_progress');
assert(curriculumMigration.includes('REFERENCES users(user_id) ON DELETE CASCADE'), 'Curriculum progress must cascade with the authenticated user');
assert(modules.length === 32, `Expected 32 modules, got ${modules.length}`);
assert(tasks.length === 240, `Expected 240 tasks, got ${tasks.length}`);
assert(curriculumLessons.length === 44, `Expected 44 lessons, got ${curriculumLessons.length}`);
assert(curriculumCheckpoints.length === 8, `Expected 8 checkpoints, got ${curriculumCheckpoints.length}`);
assert(unique(lessonIds), 'Lesson IDs must be unique');
assert(unique(sectionIds), 'Section IDs must be unique');
assert(unique(checkIds), 'Knowledge check IDs must be unique');

for (const [moduleId] of modules) {
  const lessons = curriculumLessons.filter(lesson => lesson.module === moduleId);
  assert(lessons.length >= 1, `${moduleId}: requires at least one lesson`);
  if (advancedModuleIds.has(moduleId)) assert(lessons.length >= 2, `${moduleId}: advanced module requires foundation and applied lessons`);
}

for (const lesson of curriculumLessons) {
  assert(moduleIds.has(lesson.module), `${lesson.id}: unknown module ${lesson.module}`);
  assert(lesson.id.startsWith(`lesson-${lesson.module}`), `${lesson.id}: lesson ID must start with lesson-${lesson.module}`);
  assert(lesson.title.trim().length >= 4, `${lesson.id}: title is too short`);
  assert(lesson.minutes >= 8 && lesson.minutes <= 90, `${lesson.id}: lesson duration out of range`);
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

const prerequisiteMap = new Map<string, Set<string>>();
for (const moduleId of moduleIds) prerequisiteMap.set(moduleId, new Set());
for (const lesson of curriculumLessons) {
  const set = prerequisiteMap.get(lesson.module) || new Set<string>();
  for (const prerequisite of lesson.prerequisites) set.add(prerequisite);
  prerequisiteMap.set(lesson.module, set);
}
const visiting = new Set<string>();
const visited = new Set<string>();
function visit(moduleId: string, path: string[]) {
  if (visiting.has(moduleId)) {
    errors.push(`Prerequisite cycle: ${[...path, moduleId].join(' -> ')}`);
    return;
  }
  if (visited.has(moduleId)) return;
  visiting.add(moduleId);
  for (const prerequisite of prerequisiteMap.get(moduleId) || []) visit(prerequisite, [...path, moduleId]);
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
  for (const moduleId of project.moduleIds) assert(moduleIds.has(moduleId), `${project.id}: unknown module ${moduleId}`);
  for (const deliverable of project.deliverables) {
    assert(deliverable.acceptance.length >= 3, `${project.id}/${deliverable.id}: requires at least 3 acceptance criteria`);
    assert(unique(deliverable.acceptance), `${project.id}/${deliverable.id}: duplicate acceptance criteria`);
    assert(deliverable.starterSql.trim().length >= 10, `${project.id}/${deliverable.id}: starter SQL is too short`);
  }
}
assert(unique(capstoneProjects.flatMap(project => project.deliverables.map(item => item.id))), 'Deliverable IDs must be globally unique');
assert(unique(capstoneProjects.flatMap(project => project.rubric.map(item => item.id))), 'Rubric IDs must be globally unique');

assert(sqlTracks.length === 5, `Expected 5 learning tracks, got ${sqlTracks.length}`);
assert(unique(sqlTracks.map(track => track.id)), 'Track IDs must be unique');
for (const track of sqlTracks) {
  assert(track.estimatedHours >= 4, `${track.id}: estimated hours too low`);
  assert(track.outcomes.length >= 4, `${track.id}: requires at least 4 outcomes`);
  assert(unique(track.moduleIds), `${track.id}: duplicate module references`);
  for (const moduleId of track.moduleIds) assert(moduleIds.has(moduleId), `${track.id}: unknown module ${moduleId}`);
}
const coveredByTracks = new Set(sqlTracks.flatMap(track => track.moduleIds));
for (const moduleId of moduleIds) assert(coveredByTracks.has(moduleId), `${moduleId}: not covered by any learning track`);

assert(sqlExams.length === 3, `Expected 3 exams, got ${sqlExams.length}`);
assert(unique(sqlExams.map(exam => exam.id)), 'Exam IDs must be unique');
assert(sqlExams.reduce((sum, exam) => sum + exam.readinessWeight, 0) === 100, 'Exam readiness weights must sum to 100');
for (const exam of sqlExams) {
  assert(exam.taskIds.length >= 10, `${exam.id}: exam pool is too small`);
  assert(unique(exam.taskIds), `${exam.id}: duplicate task IDs`);
  assert(exam.passingScore >= 50 && exam.passingScore <= 100, `${exam.id}: passing score out of range`);
  for (const taskId of exam.taskIds) assert(taskIds.has(taskId), `${exam.id}: unknown task ${taskId}`);
  for (const moduleId of exam.requiredModuleIds) assert(moduleIds.has(moduleId), `${exam.id}: unknown required module ${moduleId}`);
}

assert(syllabusCompetencies.length >= 10, 'Competency map is too small');
assert(unique(syllabusCompetencies.map(item => item.id)), 'Competency IDs must be unique');
for (const competency of syllabusCompetencies) {
  assert(competency.modules.length >= 1, `${competency.id}: requires modules`);
  for (const moduleId of competency.modules) assert(moduleIds.has(moduleId), `${competency.id}: unknown module ${moduleId}`);
  assert(sqlTracks.some(track => track.id === competency.track), `${competency.id}: unknown track ${competency.track}`);
}

assert(dialects.length === 4, `Expected 4 dialects, got ${dialects.length}`);
assert(dialectPatterns.length >= 10, 'Dialect Lab requires at least 10 patterns');
assert(unique(dialectPatterns.map(pattern => pattern.id)), 'Dialect pattern IDs must be unique');
for (const pattern of dialectPatterns) {
  for (const dialect of dialects) {
    assert(pattern.examples[dialect.id]?.trim().length >= 8, `${pattern.id}: missing ${dialect.id} example`);
  }
}

if (errors.length) {
  console.error(`Curriculum validation failed with ${errors.length} issue(s):`);
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`Curriculum validation passed: ${modules.length} modules, ${tasks.length} tasks, ${curriculumLessons.length} lessons, ${sectionIds.length} sections, ${curriculumCheckpoints.length} checkpoints, ${sqlTracks.length} tracks, ${sqlExams.length} exams, ${dialectPatterns.length} dialect patterns and ${capstoneProjects.length} capstone projects.`);
