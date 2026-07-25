import { readFileSync } from 'node:fs';
import { curriculumCheckpoints, curriculumLessons, capstoneProjects } from '../src/data/complete-curriculum';
import { modules, tasks } from '../src/data/course-catalog';
import {
  buildCheckpointReport,
  checkpointDurationMinutes,
  type CheckpointAnswer,
  type CheckpointReport,
  type CheckpointSession
} from '../src/lib/checkpoints';
import { emptyCurriculumProgress } from '../src/lib/curriculum-progress';
import { phaseDefinitions } from '../src/lib/learning-path';
import type { Progress } from '../src/lib/progress';
import { buildSkillEvidenceGraph } from '../src/lib/skill-evidence';

const errors: string[] = [];
const assert = (condition: unknown, message: string) => {
  if (!condition) errors.push(message);
};
const unique = (values: string[]) => new Set(values).size === values.length;
const taskById = new Map(tasks.map(task => [task.id, task]));
const moduleIds = new Set(modules.map(([id]) => id));

assert(curriculumCheckpoints.length === 8, `Expected 8 checkpoints, got ${curriculumCheckpoints.length}`);
assert(phaseDefinitions.length === curriculumCheckpoints.length, 'Every learning phase needs exactly one executable checkpoint');
assert(unique(curriculumCheckpoints.map(item => item.id)), 'Checkpoint IDs must be unique');

for (const [index, checkpoint] of curriculumCheckpoints.entries()) {
  assert(checkpoint.taskIds.length === 5, `${checkpoint.id}: deterministic pool must contain exactly 5 tasks`);
  assert(unique(checkpoint.taskIds), `${checkpoint.id}: task pool contains duplicates`);
  assert(checkpoint.moduleIds.length >= 2, `${checkpoint.id}: requires multiple modules`);
  assert(unique([...checkpoint.moduleIds]), `${checkpoint.id}: module pool contains duplicates`);
  assert(checkpoint.passingScore >= 70 && checkpoint.passingScore <= 90, `${checkpoint.id}: passing score is outside 70..90`);
  assert(Boolean(phaseDefinitions[index]), `${checkpoint.id}: phase mapping is missing`);

  for (const moduleId of checkpoint.moduleIds) {
    assert(moduleIds.has(moduleId), `${checkpoint.id}: unknown module ${moduleId}`);
  }
  for (const taskId of checkpoint.taskIds) {
    const task = taskById.get(taskId);
    assert(Boolean(task), `${checkpoint.id}: unknown task ${taskId}`);
    assert(
      Boolean(task && checkpoint.moduleIds.some(moduleId => moduleId === task.module)),
      `${checkpoint.id}: task ${taskId} belongs to ${task?.module}`
    );
  }
}

const phaseModuleIds = phaseDefinitions.flatMap(phase => [...phase.moduleIds]);
assert(unique(phaseModuleIds), 'Learning phases must not assign a module twice');
assert(phaseModuleIds.length === modules.length, `Learning phases cover ${phaseModuleIds.length}/${modules.length} modules`);
for (const moduleId of moduleIds) assert(phaseModuleIds.includes(moduleId as never), `Module ${moduleId} is absent from phase graph`);

const fullProgress: Progress = {
  version: 4,
  completed: tasks.map(task => task.id),
  taskStats: Object.fromEntries(tasks.map(task => [task.id, {
    attempts: 1,
    incorrect: 0,
    hintsUsed: 0,
    lastAttemptAt: '2026-07-25T10:00:00.000Z',
    completedAt: '2026-07-25T10:00:00.000Z'
  }])),
  xp: tasks.reduce((sum, task) => sum + task.xp, 0),
  streak: 1,
  history: ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map(day => ({ day, solved: 1 }))
};

const reports: CheckpointReport[] = curriculumCheckpoints.map((checkpoint, checkpointIndex) => {
  const answers = Object.fromEntries(checkpoint.taskIds.map((taskId, taskIndex) => [taskId, {
    taskId,
    sql: taskById.get(taskId)?.solution || 'SELECT 1;',
    attempts: 1,
    incorrect: 0,
    correct: true,
    skipped: false,
    elapsedSeconds: 120 + taskIndex,
    startedAt: `2026-07-25T10:${String(taskIndex).padStart(2, '0')}:00.000Z`,
    completedAt: `2026-07-25T10:${String(taskIndex).padStart(2, '0')}:30.000Z`
  } satisfies CheckpointAnswer]));
  const startedAt = `2026-07-25T${String(10 + checkpointIndex).padStart(2, '0')}:00:00.000Z`;
  const session: CheckpointSession = {
    version: 1,
    id: `00000000-0000-4000-8000-${String(checkpointIndex + 1).padStart(12, '0')}`,
    userId: '00000000-0000-4000-8000-000000000001',
    checkpointId: checkpoint.id,
    status: 'active',
    startedAt,
    updatedAt: startedAt,
    deadlineAt: new Date(new Date(startedAt).getTime() + checkpointDurationMinutes(checkpoint.id) * 60_000).toISOString(),
    taskIds: [...checkpoint.taskIds],
    currentIndex: checkpoint.taskIds.length - 1,
    answers
  };
  const report = buildCheckpointReport(session, 'completed', []);
  assert(report.taskScores.length === 5, `${checkpoint.id}: report task score count mismatch`);
  assert(report.moduleScores.length >= 2, `${checkpoint.id}: report module evidence is too narrow`);
  assert(report.passed, `${checkpoint.id}: perfect session must pass`);
  assert(report.score >= checkpoint.passingScore, `${checkpoint.id}: perfect score below threshold`);
  return report;
});

const curriculum = {
  ...emptyCurriculumProgress(),
  completedSections: curriculumLessons.flatMap(lesson => lesson.sections.map(section => section.id)),
  completedLessons: curriculumLessons.map(lesson => lesson.id),
  completedProjects: capstoneProjects.map(project => project.id)
};
const graph = buildSkillEvidenceGraph(fullProgress, curriculum, [], reports);
assert(graph.modules.length === modules.length, `Evidence graph has ${graph.modules.length}/${modules.length} modules`);
assert(graph.phases.length === phaseDefinitions.length, `Evidence graph has ${graph.phases.length}/${phaseDefinitions.length} phases`);
assert(unique(graph.modules.map(item => item.moduleId)), 'Evidence graph contains duplicate modules');
assert(graph.phases.every(item => item.checkpointPassed), 'Perfect checkpoint reports must pass every phase');
assert(graph.phases.every(item => item.completed), 'Perfect progress must complete every phase');
assert(graph.modules.every(item => item.evidence.practice.score >= 80), 'Perfect progress must produce strong practice evidence');
assert(graph.modules.every(item => Object.keys(item.evidence).length === 5), 'Every module must expose five evidence kinds');

const migration = readFileSync(new URL('../migrations/0011_checkpoint_reports.sql', import.meta.url), 'utf8');
assert(migration.includes('CREATE TABLE IF NOT EXISTS checkpoint_reports'), 'Checkpoint migration must create checkpoint_reports');
assert(migration.includes('REFERENCES users(user_id) ON DELETE CASCADE'), 'Checkpoint reports must cascade with users');
assert(migration.includes('CREATE INDEX'), 'Checkpoint migration needs a report lookup index');

const workerSource = readFileSync(new URL('../worker/checkpoints.ts', import.meta.url), 'utf8');
assert(workerSource.includes("'/api/checkpoints/reports'"), 'Worker must expose checkpoint report endpoint');
assert(workerSource.includes('MAX_REPORT_BYTES'), 'Worker must enforce checkpoint payload size');
assert(workerSource.includes('Checkpoint owner mismatch'), 'Worker must validate report ownership');

if (errors.length) {
  console.error(`Checkpoint and evidence validation failed with ${errors.length} issue(s):`);
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`Checkpoint validation passed: ${curriculumCheckpoints.length} sessions, ${reports.length} reports, ${graph.modules.length} module evidence nodes and ${graph.phases.length} phase nodes.`);
