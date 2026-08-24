import { readFileSync } from 'node:fs';
import { tasks } from '../src/data/course-catalog';
import {
  assessmentBlueprint,
  assessmentAdaptiveDecision,
  assessmentEligibility,
  assessmentModes,
  type AssessmentMode,
  type AssessmentSession,
  buildAssessmentReport,
  finalizeAdaptiveDiagnosticSession,
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
  if (mode === 'interview') assert(first.every(task => task.mode === 'interview' && task.evaluationContractId), 'interview: every task must be original Interview content with a hidden contract');
  if (mode === 'exam') assert(first.every(task => task.mode !== 'lesson' && task.mode !== 'puzzle'), 'exam: invalid task mode');
  if (mode === 'diagnostic') assert(first.every(task => task.evaluationContractId && task.learningContract), 'diagnostic: every parallel-form probe needs an authored hidden contract');
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
  formId: 'QUICK-assessment-blueprint-v4-F1',
  blueprintVersion: 'assessment-blueprint-v4',
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

const diagnosticTasks = selectAssessmentTasks('diagnostic', defaultProgress);
const diagnosticSession: AssessmentSession = {
  ...session,
  id: '00000000-0000-4000-8000-000000000002',
  mode: 'diagnostic',
  formId: 'DIAGNOSTIC-assessment-blueprint-v4-F1',
  taskIds: diagnosticTasks.map(task => task.id),
  currentIndex: 2,
  selection: {
    excludedKnownSolutions: 0,
    fallbackKnownSolutions: 0,
    distinctModules: 7,
    distinctSkills: 6
  },
  answers: Object.fromEntries(diagnosticTasks.map((task, index) => [task.id, {
    taskId: task.id,
    sql: task.starter,
    attempts: 0,
    incorrect: 0,
    technicalErrors: 0,
    correct: false,
    skipped: index < 3,
    elapsedSeconds: index < 3 ? 20 : 0,
    interviewerUses: 0,
    startedAt,
    completedAt: index < 3 ? completedAt : undefined
  }]))
};
const diagnosticDecision = assessmentAdaptiveDecision(diagnosticSession);
assert(diagnosticDecision?.shouldStop && diagnosticDecision.completedCount === 3,
  'Zero-level diagnostic must stop after the minimum three executable probes.');
const finalizedDiagnostic = finalizeAdaptiveDiagnosticSession(diagnosticSession);
assert(finalizedDiagnostic.taskIds.length === 3, 'Adaptive finalization must exclude unshown challenge tasks from scoring.');
const diagnosticReport = buildAssessmentReport(finalizedDiagnostic, 'completed');
assert(diagnosticReport.taskScores.length === 3, 'Adaptive report must score only observed tasks.');
assert(diagnosticReport.adaptiveDecision?.scoreBand.low === diagnosticDecision.scoreBand.low,
  'Adaptive report must retain the explicit uncertainty boundary.');
assert(diagnosticReport.localDebrief.includes('Стартовая граница'),
  'Adaptive report must explain why placement stopped.');

const interviewTasks = selectAssessmentTasks('interview', practiced);
const interviewSession: AssessmentSession = {
  ...session,
  id: '00000000-0000-4000-8000-000000000003',
  mode: 'interview',
  formId: 'INTERVIEW-assessment-blueprint-v4-F1',
  deadlineAt: new Date(Date.now() + 35 * 60_000).toISOString(),
  taskIds: interviewTasks.map(task => task.id),
  currentIndex: interviewTasks.length - 1,
  selection: {
    excludedKnownSolutions: 0,
    fallbackKnownSolutions: 0,
    distinctModules: 5,
    distinctSkills: 5
  },
  answers: Object.fromEntries(interviewTasks.map((task, index) => [task.id, {
    taskId: task.id,
    sql: task.solution,
    attempts: 1,
    incorrect: 0,
    technicalErrors: 0,
    correct: true,
    skipped: false,
    elapsedSeconds: 180,
    interviewerUses: index === 0 ? 1 : 0,
    hintsUsed: 0,
    solutionViews: 0,
    explanation: 'Одна строка соответствует целевой сущности; сначала фиксирую grain, затем применяю условия и стабильный порядок.',
    alternative: 'Альтернатива использует CTE: она нагляднее, но добавляет этап.',
    edgeCases: 'NULL, дубли и ties обрабатываются явно и не меняют кратность результата.',
    startedAt,
    completedAt
  }]))
};
const interviewReport = buildAssessmentReport(interviewSession, 'completed');
assert(interviewReport.explanationRubric?.completed === 5, 'Interview report lost completed explanation rubrics');
assert(interviewReport.explanationRubric?.awaitingHumanReview === 5, 'Interview prose must wait for human review');
assert(interviewReport.taskScores.every(item => item.explanationRubric?.proseScore === null), 'Interview report invented an AI prose score');
assert(interviewReport.assistance?.interviewerUses === 1 && interviewReport.assistance.independent === false, 'Assistance provenance is not visible');
assert(interviewReport.independence < 100, 'Assisted interview report still claims full independence');

const reportMigration = readFileSync(new URL('../migrations/0004_assessment_center.sql', import.meta.url), 'utf8');
assert(/REFERENCES\s+users\s*\(\s*user_id\s*\)/i.test(reportMigration), 'assessment report FK must reference users.user_id');
assert(!/REFERENCES\s+users\s*\(\s*id\s*\)/i.test(reportMigration), 'assessment report FK must not reference a nonexistent users.id');
const calibrationMigration = readFileSync(new URL('../migrations/0015_assessment_item_calibration.sql', import.meta.url), 'utf8');
assert(/PRIMARY KEY\s*\(\s*task_id\s*,\s*blueprint_version\s*\)/i.test(calibrationMigration), 'calibration aggregate identity is missing');
assert(/report_id\s+TEXT\s+PRIMARY KEY/i.test(calibrationMigration), 'deduplicating calibration receipt is missing');
assert(!/sql\s+TEXT/i.test(calibrationMigration), 'calibration aggregate must not store learner SQL');
const productionSmoke = readFileSync(new URL('./assessment-calibration-production-smoke.mjs', import.meta.url), 'utf8');
assert(productionSmoke.includes('explanationRubric: nonInterviewRubric'), 'Production assessment smoke lost the strict explanation rubric contract');
assert(productionSmoke.includes('hintsUsed: 0, solutionViews: 0'), 'Production assessment smoke lost assistance provenance fields');
assert(productionSmoke.includes('assistance: { interviewerUses: 0, hintsUsed: 0, solutionViews: 0, independent: true }'), 'Production assessment smoke lost report-level assistance aggregation');
assert(productionSmoke.includes("require.resolve('wrangler')"), 'Production assessment smoke bypasses the project-local Wrangler entrypoint');

console.log(`Assessment validation passed: ${Object.keys(assessmentModes).length} modes, 3→5→7 adaptive placement, calibrated form identity, monotonic session merge, uncertainty band, telemetry exclusions and privacy-first D1 contract.`);
