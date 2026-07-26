import { readFileSync } from 'node:fs';
import { tasks } from '../src/data/course-catalog';
import {
  assessmentBlueprint,
  assessmentEligibility,
  assessmentModes,
  type AssessmentMode,
  type AssessmentSession,
  buildAssessmentReport,
  mergeAssessmentAnswer,
  selectAssessmentTasks
} from '../src/lib/assessment';
import { defaultProgress, type Progress } from '../src/lib/progress';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const practiced: Progress = {
  ...defaultProgress,
  completed: tasks.slice(0, 30).map(task => task.id),
  taskStats: Object.fromEntries(tasks.slice(0, 30).map((task, index) => [task.id, {
    attempts: index % 3 + 1,
    incorrect: index % 2,
    hintsUsed: index % 4 === 0 ? 1 : 0,
    lastAttemptAt: new Date(2026, 6, index % 20 + 1).toISOString(),
    completedAt: new Date(2026, 6, index % 20 + 1).toISOString()
  }]))
};
const completeProgress: Progress = {
  ...defaultProgress,
  completed: tasks.map(task => task.id),
  taskStats: Object.fromEntries(tasks.map(task => [task.id, {
    attempts: 1,
    incorrect: 0,
    hintsUsed: 0,
    lastAttemptAt: new Date(2026, 6, 24).toISOString(),
    completedAt: new Date(2026, 6, 24).toISOString()
  }]))
};

for (const mode of Object.keys(assessmentModes) as AssessmentMode[]) {
  const config = assessmentModes[mode];
  const progress = mode === 'quick' || mode === 'diagnostic'
    ? defaultProgress
    : mode === 'production' || mode === 'final'
      ? completeProgress
      : practiced;
  const eligibility = assessmentEligibility(mode, progress);
  assert(eligibility.eligible, `${mode}: expected eligible fixture`);
  const first = selectAssessmentTasks(mode, progress);
  const second = selectAssessmentTasks(mode, progress);
  assert(first.length === config.taskCount, `${mode}: wrong task count`);
  assert(new Set(first.map(task => task.id)).size === first.length, `${mode}: duplicate task`);
  assert(JSON.stringify(first.map(task => task.id)) === JSON.stringify(second.map(task => task.id)), `${mode}: selection must be deterministic`);
  assert(new Set(first.map(task => task.module)).size >= Math.min(config.taskCount, mode === 'quick' ? 3 : 4), `${mode}: insufficient module diversity`);
  assert(config.blueprintVersion === assessmentBlueprint(mode).version, `${mode}: config/blueprint version drift`);
  assert(config.thresholdVersion === assessmentBlueprint(mode).thresholdVersion, `${mode}: config/threshold version drift`);
  if (mode === 'interview') assert(first.some(task => task.mode === 'interview'), 'interview: must include interview tasks');
  if (mode === 'exam') assert(first.every(task => task.mode !== 'lesson' && task.mode !== 'puzzle'), 'exam: invalid task mode');
  if (config.fixedTaskIds) assert(JSON.stringify(first.map(task => task.id)) === JSON.stringify(config.fixedTaskIds), mode + ': fixed pool changed');
}

const quickTasks = selectAssessmentTasks('quick', defaultProgress);
const startedAt = new Date(Date.now() - 8 * 60_000).toISOString();
const completedAt = new Date().toISOString();
const session: AssessmentSession = {
  version: 1,
  id: '00000000-0000-4000-8000-000000000001',
  userId: 'validator-user-0000000000000001',
  mode: 'quick',
  status: 'active',
  startedAt,
  updatedAt: completedAt,
  deadlineAt: new Date(Date.now() + 4 * 60_000).toISOString(),
  completedAt,
  taskIds: quickTasks.map(task => task.id),
  currentIndex: quickTasks.length - 1,
  baselineReadiness: 20,
  formId: 'QUICK-assessment-blueprint-v2-F1',
  blueprintVersion: 'assessment-blueprint-v2',
  thresholdVersion: 'assessment-thresholds-v2',
  selection: {
    excludedKnownSolutions: 0,
    fallbackKnownSolutions: 0,
    distinctModules: 3,
    distinctSkills: 3
  },
  answers: Object.fromEntries(quickTasks.map((task, index) => [task.id, {
    taskId: task.id,
    sql: task.solution,
    attempts: index + 1,
    incorrect: index,
    technicalErrors: index === 2 ? 1 : 0,
    correct: index < 2,
    skipped: index === 2,
    elapsedSeconds: 90 + index * 30,
    interviewerUses: 0,
    startedAt,
    completedAt
  }]))
};

const report = buildAssessmentReport(session, 'completed');
assert(report.score >= 0 && report.score <= 100, 'report score out of range');
assert(report.accuracy === 67, 'report accuracy regression');
assert(report.taskScores.length === quickTasks.length, 'task score count mismatch');
assert(report.moduleScores.length >= 2, 'module report is too narrow');
assert(report.localDebrief.length > 120, 'explainable local debrief is missing');
assert(report.readinessDelta >= -5 && report.readinessDelta <= 10, 'readiness delta out of range');
assert(report.formId === session.formId, 'report form identity was lost');
assert(report.measurement?.eligibleItems === 2, 'skipped technical-error task must be excluded from measurement');
assert(report.measurement?.excludedItems === 1, 'measurement exclusion count mismatch');
assert(report.measurement?.scoreBand.low !== report.measurement?.scoreBand.high, 'score must not be presented with false precision');
assert(report.taskScores[2].telemetryExclusionReason === 'skipped', 'exclusion reason priority changed');

const answered = mergeAssessmentAnswer(session.answers[quickTasks[0].id], {
  attempts: 3,
  incorrect: 2,
  technicalErrors: 1,
  correct: true,
  skipped: false,
  elapsedSeconds: 125,
  completedAt
});
const afterStaleTimer = mergeAssessmentAnswer(answered, { sql: 'SELECT 1;', elapsedSeconds: 5 });
assert(afterStaleTimer.attempts === 3, 'timer patch regressed attempts');
assert(afterStaleTimer.incorrect === 2, 'timer patch regressed incorrect count');
assert(afterStaleTimer.technicalErrors === 1, 'timer patch regressed technical-error evidence');
assert(afterStaleTimer.correct, 'timer patch regressed correct state');
assert(afterStaleTimer.elapsedSeconds === 130, 'timer patch must advance latest elapsed time by one tick');
const afterStaleRun = mergeAssessmentAnswer(afterStaleTimer, {
  attempts: 1,
  incorrect: 0,
  technicalErrors: 0,
  correct: false,
  elapsedSeconds: 40
});
assert(afterStaleRun.attempts === 3, 'stale run regressed attempts');
assert(afterStaleRun.incorrect === 2, 'stale run regressed incorrect count');
assert(afterStaleRun.technicalErrors === 1, 'stale run regressed technical-error count');
assert(afterStaleRun.correct, 'stale run regressed correct state');
assert(afterStaleRun.elapsedSeconds === 130, 'stale run regressed elapsed time');

const lockedExam = assessmentEligibility('exam', defaultProgress);
assert(!lockedExam.eligible && lockedExam.missingCompleted === assessmentModes.exam.minimumCompleted, 'exam prerequisites must be enforced');

const reportMigration = readFileSync(new URL('../migrations/0004_assessment_center.sql', import.meta.url), 'utf8');
assert(/REFERENCES\s+users\s*\(\s*user_id\s*\)/i.test(reportMigration), 'assessment report FK must reference users.user_id');
assert(!/REFERENCES\s+users\s*\(\s*id\s*\)/i.test(reportMigration), 'assessment report FK must not reference a nonexistent users.id');
const calibrationMigration = readFileSync(new URL('../migrations/0015_assessment_item_calibration.sql', import.meta.url), 'utf8');
assert(/PRIMARY KEY\s*\(\s*task_id\s*,\s*blueprint_version\s*\)/i.test(calibrationMigration), 'calibration aggregate identity is missing');
assert(/report_id\s+TEXT\s+PRIMARY KEY/i.test(calibrationMigration), 'deduplicating calibration receipt is missing');
assert(!/sql\s+TEXT/i.test(calibrationMigration), 'calibration aggregate must not store learner SQL');

console.log(`Assessment validation passed: ${Object.keys(assessmentModes).length} modes, calibrated form identity, monotonic session merge, uncertainty band, telemetry exclusions and privacy-first D1 contract.`);
