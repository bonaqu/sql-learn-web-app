import { curriculumLessons } from '../src/data/complete-curriculum.ts';
import { evaluationContractForTask } from '../src/data/foundation-evaluation-contracts.ts';
import { lessonChecks } from '../src/data/lesson-checks.ts';
import { tasks, type SqlTask } from '../src/data/course-catalog.ts';
import { classifySqlAttempt, diagnosticForKind } from '../src/lib/attempt-diagnostics.ts';
import { mergeProgress } from '../src/lib/auth.ts';
import { emptyCurriculumProgress } from '../src/lib/curriculum-progress.ts';
import { lessonMasteryState, lessonRemediation, moduleAppliedLessonScore } from '../src/lib/mastery-loop.ts';
import {
  defaultProgress,
  hasIndependentTaskEvidence,
  recordAttempt,
  recordHint,
  recordSolutionView,
  type Progress
} from '../src/lib/progress.ts';
import {
  initialReviewSchedule,
  introduceReviewSchedule,
  reviewEvidenceForModule,
  reviewStats,
  type ReviewState
} from '../src/lib/spaced-repetition.ts';
import {
  FOUNDATION_EVIDENCE_CONTRACT_VERSION,
  TASK_EVALUATION_CONTRACT_VERSION,
  type TaskEvaluationEvidence
} from '../src/lib/task-evaluation-contract.ts';

const failures: string[] = [];
const assert = (condition: unknown, message: string) => { if (!condition) failures.push(message); };
const now = Date.parse('2026-07-25T18:00:00.000Z');

function taskFor(moduleId: string): SqlTask {
  const task = tasks.find(item => item.module === moduleId);
  if (!task) throw new Error(`Missing task for ${moduleId}`);
  return task;
}

function blankProgress(): Progress {
  return { ...defaultProgress, taskStats: {}, completed: [], history: defaultProgress.history.map(item => ({ ...item })) };
}

function contractEvidenceFor(task: SqlTask): TaskEvaluationEvidence | undefined {
  const contract = evaluationContractForTask(task.id);
  if (!contract) return undefined;
  return {
    contractId: contract.id,
    contractVersion: TASK_EVALUATION_CONTRACT_VERSION,
    evidenceContractVersion: FOUNDATION_EVIDENCE_CONTRACT_VERSION,
    fixtureIds: contract.fixtures.map(fixture => fixture.id),
    hiddenFixtureIds: contract.fixtures
      .filter(fixture => fixture.visibility !== 'public')
      .map(fixture => fixture.id)
  };
}

const selectTask = taskFor('select');
const filteringTask = taskFor('filtering');
const aggregateTask = taskFor('aggregates');
const joinTask = taskFor('joins');
const expected = [{ columns: ['id', 'name'], values: [[1, 'A'], [2, 'B']] }];

assert(classifySqlAttempt({ task: selectTask, sql: 'SELECT,', errorMessage: 'near "FROM": syntax error' }).kind === 'syntax', 'Syntax errors must be classified');
assert(classifySqlAttempt({ task: selectTask, sql: 'SELECT unknown', errorMessage: 'no such column: unknown' }).kind === 'schema', 'Schema errors must be classified');
assert(classifySqlAttempt({ task: selectTask, sql: 'SELECT 1', actual: [{ columns: ['id'], values: [[1], [2]] }], expected }).kind === 'result-shape', 'Column mismatch must be result-shape');
assert(classifySqlAttempt({ task: selectTask, sql: 'SELECT 1', actual: [{ columns: ['id', 'name'], values: [[1, 'A']] }], expected }).kind === 'row-set', 'Missing rows must be row-set');
assert(classifySqlAttempt({ task: selectTask, sql: 'SELECT 1', actual: [{ columns: ['id', 'name'], values: [[2, 'B'], [1, 'A']] }], expected }).kind === 'ordering', 'Same rows in different order must be ordering');
assert(classifySqlAttempt({ task: selectTask, sql: 'SELECT 1', actual: [{ columns: ['id', 'name'], values: [[1, 'X'], [2, 'Y']] }], expected }).kind === 'values', 'Value mismatch must be values');
assert(classifySqlAttempt({ task: filteringTask, sql: 'SELECT * WHERE x NOT IN (...)', actual: [{ columns: ['id'], values: [] }], expected: [{ columns: ['id'], values: [[1]] }] }).kind === 'null-filter', 'Empty nullable filter result must be null-filter');
assert(classifySqlAttempt({ task: aggregateTask, sql: 'SELECT COUNT(*)', actual: [{ columns: ['count'], values: [[1], [2]] }], expected: [{ columns: ['count'], values: [[2]] }] }).kind === 'aggregation', 'Aggregate row mismatch must be aggregation');
assert(classifySqlAttempt({ task: joinTask, sql: 'SELECT * FROM a JOIN b', actual: [{ columns: ['id'], values: [[1], [1], [2]] }], expected: [{ columns: ['id'], values: [[1], [2]] }] }).kind === 'join-cardinality', 'JOIN multiplication must be join-cardinality');
assert(Boolean(diagnosticForKind('ordering').nextStep), 'Every diagnostic must provide a next step');

let progress = blankProgress();
const syntaxDiagnostic = diagnosticForKind('syntax');
progress = recordAttempt(progress, selectTask, false, { diagnostic: syntaxDiagnostic });
assert(progress.taskStats[selectTask.id]?.errorKinds?.syntax === 1, 'Failed attempt must persist diagnostic kind');
assert(progress.taskStats[selectTask.id]?.lastDiagnostic?.kind === 'syntax', 'Failed attempt must persist last diagnostic');
progress = recordHint(progress, selectTask.id);
progress = recordAttempt(progress, selectTask, true, { independent: false });
assert(!hasIndependentTaskEvidence(progress, selectTask.id), 'Guided success must not become independent evidence');
progress = recordSolutionView(progress, selectTask.id);
assert(progress.taskStats[selectTask.id]?.solutionViews === 1, 'Solution view must be explicit evidence');
progress = recordAttempt(progress, selectTask, true, {
  independent: true,
  contractEvidence: contractEvidenceFor(selectTask)
});
assert(hasIndependentTaskEvidence(progress, selectTask.id), 'Later independent retry must establish mastery');

const legacyProgress: Progress = {
  ...defaultProgress,
  completed: [selectTask.id],
  taskStats: { [selectTask.id]: { attempts: 1, incorrect: 0, hintsUsed: 0, completedAt: '2026-01-01T00:00:00.000Z' } },
  history: defaultProgress.history.map(item => ({ ...item }))
};
assert(!hasIndependentTaskEvidence(legacyProgress, selectTask.id), 'Legacy single-fixture completion must not become contracted foundation evidence');
const guidedLegacy: Progress = {
  ...legacyProgress,
  taskStats: { [selectTask.id]: { attempts: 2, incorrect: 1, hintsUsed: 1, completedAt: '2026-01-01T00:00:00.000Z' } }
};
assert(!hasIndependentTaskEvidence(guidedLegacy, selectTask.id), 'Hinted legacy completion must not be assumed independent');
const uncontractedLegacy: Progress = {
  ...defaultProgress,
  completed: [joinTask.id],
  taskStats: { [joinTask.id]: { attempts: 1, incorrect: 0, hintsUsed: 0, completedAt: '2026-01-01T00:00:00.000Z' } },
  history: defaultProgress.history.map(item => ({ ...item }))
};
assert(hasIndependentTaskEvidence(uncontractedLegacy, joinTask.id), 'Uncontracted legacy modules must retain their compatibility fallback');

const schemaDiagnostic = diagnosticForKind('schema');
const localProgress: Progress = {
  ...blankProgress(), completed: [selectTask.id], taskStats: { [selectTask.id]: {
    attempts: 3, incorrect: 2, hintsUsed: 1, independentPasses: 1, solutionViews: 0,
    errorKinds: { syntax: 2 }, lastDiagnostic: syntaxDiagnostic,
    lastAttemptAt: '2026-07-25T17:00:00.000Z', completedAt: '2026-07-25T16:00:00.000Z'
  } }
};
const cloudProgress: Progress = {
  ...blankProgress(), completed: [selectTask.id], taskStats: { [selectTask.id]: {
    attempts: 4, incorrect: 3, hintsUsed: 1, independentPasses: 2, solutionViews: 1,
    lastIndependentAt: '2026-07-25T17:30:00.000Z', errorKinds: { syntax: 1, schema: 3 },
    lastDiagnostic: schemaDiagnostic, lastAttemptAt: '2026-07-25T18:00:00.000Z', completedAt: '2026-07-25T16:30:00.000Z'
  } }
};
const mergedStats = mergeProgress(localProgress, cloudProgress).taskStats[selectTask.id];
assert(mergedStats.independentPasses === 2, 'Cross-device merge must preserve strongest independent evidence');
assert(mergedStats.solutionViews === 1, 'Cross-device merge must preserve solution provenance');
assert(mergedStats.errorKinds?.syntax === 2 && mergedStats.errorKinds?.schema === 3, 'Cross-device merge must preserve diagnostic counters');
assert(mergedStats.lastDiagnostic?.kind === 'schema', 'Latest diagnostic must survive cross-device merge');
assert(mergedStats.completedAt === '2026-07-25T16:00:00.000Z', 'Earliest completion must remain stable');

const lesson = curriculumLessons[0];
const checks = lessonChecks(lesson);
const legacyCurriculum = {
  ...emptyCurriculumProgress(),
  completedSections: lesson.sections.map(section => section.id),
  completedLessons: [lesson.id],
  answers: { [lesson.check.id]: { optionIndex: lesson.check.correctIndex, correct: true, answeredAt: '2026-07-25T17:00:00.000Z' } },
  updatedAt: '2026-07-25T17:00:00.000Z'
};
const legacyState = lessonMasteryState(lesson, defaultProgress, legacyCurriculum);
assert(legacyState.theoryComplete, 'Legacy section evidence must remain visible');
assert(!legacyState.checkCorrect && legacyState.checksCompleted === 1, 'One legacy MCQ must not bypass new concept checks');
assert(legacyState.nextAction === 'check', 'Incomplete concept inventory must be the next action');

const curriculum = {
  ...legacyCurriculum,
  answers: Object.fromEntries(checks.map(check => [check.id, {
    optionIndex: check.correctIndex,
    correct: true,
    answeredAt: '2026-07-25T17:00:00.000Z'
  }]))
};
const beforePractice = lessonMasteryState(lesson, defaultProgress, curriculum);
assert(beforePractice.theoryComplete && beforePractice.checkCorrect, 'All concept checks must complete the reasoning stage');
assert(beforePractice.checksCompleted === checks.length && beforePractice.checksTotal === checks.length, 'Mastery must expose check progress');
assert(!beforePractice.mastered && beforePractice.nextAction === 'practice', 'Concept checks without independent SQL must not equal applied mastery');

const diagnosticProgress = recordAttempt(blankProgress(), taskFor(lesson.module), false, { diagnostic: diagnosticForKind('result-shape') });
const remediation = lessonRemediation(diagnosticProgress, lesson);
assert(Boolean(remediation?.nextStep), 'Task errors must create targeted remediation');
assert(Boolean(remediation?.misconceptionId), 'Targeted remediation must map to a misconception');

const practiceTask = tasks.find(item => lesson.practiceTaskIds.includes(item.id));
assert(Boolean(practiceTask), 'Lesson must have a valid practice task');
if (practiceTask) {
  const appliedProgress = recordAttempt(blankProgress(), practiceTask, true, {
    independent: true,
    contractEvidence: contractEvidenceFor(practiceTask)
  });
  const applied = lessonMasteryState(lesson, appliedProgress, curriculum);
  assert(applied.mastered, 'Theory, all checks and independent SQL must establish applied mastery');
  assert(!applied.durableMastery && applied.nextAction === 'review', 'Applied mastery must still require retrieval review');
  const moduleScore = moduleAppliedLessonScore(lesson.module, appliedProgress, curriculum);
  assert(moduleScore.score === 100 && moduleScore.completed === 1, 'Skill graph lesson score must use applied mastery');

  const evidence = reviewEvidenceForModule(lesson.module, appliedProgress, curriculum, now);
  assert(Boolean(evidence), 'Applied lesson must introduce review evidence');
  assert(evidence?.source === 'independent-practice', 'Newest independent practice must introduce the review card');
  const initial = initialReviewSchedule(`review-${lesson.module}`);
  const introduced = introduceReviewSchedule(initial, evidence, now);
  assert(Boolean(introduced.introducedAt), 'Evidence must introduce a review card');
  assert(new Date(introduced.dueAt).getTime() === now + 10 * 60_000, 'Fresh evidence must schedule first recall after ten minutes');
  assert(introduceReviewSchedule(initial, null, now) === initial, 'Unstudied module must stay locked');
  const state: ReviewState = { version: 1, schedules: { [introduced.cardId]: introduced, locked: initialReviewSchedule('locked') } };
  const stats = reviewStats(state, now);
  assert(stats.available === 1 && stats.locked === 1 && stats.due === 0, 'Review stats must separate available, locked and due cards');
}

if (failures.length) {
  console.error(`Mastery Loop validation failed with ${failures.length} issue(s):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log(`Mastery Loop validated: ${curriculumLessons.length} lessons, ${tasks.length} tasks, multi-check reasoning, targeted remediation, independent evidence and gated retention.`);
