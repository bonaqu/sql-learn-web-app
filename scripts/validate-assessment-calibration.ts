import { assessmentBlueprints, assessmentItemBank } from '../src/data/assessment-blueprints';
import {
  MINIMUM_CALIBRATION_EVIDENCE,
  buildAssessmentMeasurement,
  calibrationFromAggregate,
  calibrationSnapshot,
  wilsonInterval,
  type AssessmentItemAggregate
} from '../src/lib/assessment-calibration';
import {
  assessmentFormCoverage,
  assessmentFormOverlap,
  selectAssessmentForm,
  type AssessmentSelectionReport
} from '../src/lib/assessment-selection';
import { defaultProgress, type Progress } from '../src/lib/progress';
import { tasks } from '../src/data/course-catalog';

const failures: string[] = [];
const assert = (condition: unknown, message: string) => { if (!condition) failures.push(message); };

const completeProgress: Progress = {
  ...defaultProgress,
  completed: tasks.map(task => task.id),
  taskStats: Object.fromEntries(tasks.map((task, index) => [task.id, {
    attempts: 1 + index % 3,
    incorrect: index % 4 === 0 ? 2 : index % 3 === 0 ? 1 : 0,
    hintsUsed: index % 11 === 0 ? 1 : 0,
    independentPasses: index % 5 === 0 ? 1 : 0,
    lastAttemptAt: new Date(2026, 6, 20 + index % 5).toISOString(),
    completedAt: new Date(2026, 6, 20 + index % 5).toISOString()
  }]))
};

assert(assessmentItemBank.length === tasks.length, 'Every SQL task must have assessment item metadata');
assert(new Set(assessmentItemBank.map(item => item.taskId)).size === tasks.length, 'Assessment item IDs must be unique');
for (const item of assessmentItemBank) {
  assert(item.expectedSeconds >= 120 && item.expectedSeconds <= 600, `${item.taskId}: expected time out of bounds`);
  assert(item.eligibleModes.length >= 1, `${item.taskId}: no eligible assessment mode`);
}

for (const mode of ['quick', 'interview', 'exam', 'production', 'final'] as const) {
  const syntheticUser = `canonical-${mode}-forms-0000000000000000`;
  const forms = Array.from({ length: 4 }, (_, index) => {
    const priorAttempts: AssessmentSelectionReport[] = Array.from({ length: index }, (__, attemptIndex) => ({
      mode,
      status: 'abandoned',
      completedAt: `2026-07-25T12:0${attemptIndex}:00.000Z`,
      taskScores: []
    }));
    return selectAssessmentForm({
      mode,
      progress: completeProgress,
      userId: syntheticUser,
      reports: priorAttempts,
      calibration: calibrationSnapshot([])
    });
  });
  assert(new Set(forms.map(form => form.formId)).size === 4, `${mode}: selector must cycle through four distinct canonical form IDs`);
  for (const form of forms) {
    const coverage = assessmentFormCoverage(mode, form.tasks);
    assert(coverage.valid, `${mode} ${form.formId}: invalid blueprint coverage (${JSON.stringify(coverage)})`);
    assert(form.blueprintVersion === assessmentBlueprints[mode].version, `${mode}: blueprint version drift`);
    assert(form.distinctModules >= assessmentBlueprints[mode].minimumDistinctModules, `${mode}: insufficient module coverage`);
    assert(form.distinctSkills >= assessmentBlueprints[mode].minimumDistinctSkills, `${mode}: insufficient skill coverage`);
  }
  for (let left = 0; left < forms.length; left += 1) {
    for (let right = left + 1; right < forms.length; right += 1) {
      const overlap = assessmentFormOverlap(forms[left].tasks, forms[right].tasks);
      assert(overlap <= assessmentBlueprints[mode].maximumFormOverlap + 0.001, `${mode}: parallel form overlap ${overlap.toFixed(2)} exceeds ${assessmentBlueprints[mode].maximumFormOverlap}`);
    }
  }
}

const knownUserId = 'known-solution-validator-00000000000001';
const firstProduction = selectAssessmentForm({
  mode: 'production',
  progress: completeProgress,
  userId: knownUserId,
  reports: [],
  calibration: calibrationSnapshot([])
});
const knownReports: AssessmentSelectionReport[] = [{
  mode: 'production',
  status: 'completed',
  completedAt: '2026-07-25T12:00:00.000Z',
  taskScores: firstProduction.tasks.map(task => ({ taskId: task.id, correct: true }))
}];
const secondProduction = selectAssessmentForm({
  mode: 'production',
  progress: completeProgress,
  userId: knownUserId,
  reports: knownReports,
  calibration: calibrationSnapshot([])
});
const repeated = secondProduction.tasks.filter(task => firstProduction.tasks.some(previous => previous.id === task.id));
assert(repeated.length <= Math.ceil(firstProduction.tasks.length * assessmentBlueprints.production.maximumFormOverlap), 'Adaptive selection repeats too many known solutions');
assert(secondProduction.fallbackKnownSolutions <= repeated.length, 'Known-solution fallback accounting is invalid');

const expiredReports: AssessmentSelectionReport[] = knownReports.map(report => ({ ...report, status: 'expired' }));
const afterExpired = selectAssessmentForm({
  mode: 'production',
  progress: completeProgress,
  userId: knownUserId,
  reports: expiredReports,
  calibration: calibrationSnapshot([])
});
assert(afterExpired.excludedKnownSolutions === 0, 'Expired report must not mark correct items as known solutions');
assert(afterExpired.fallbackKnownSolutions === 0, 'Expired report must not force known-solution fallback');

function aggregate(taskId: string, overrides: Partial<AssessmentItemAggregate>): AssessmentItemAggregate {
  return {
    taskId,
    blueprintVersion: 'assessment-blueprint-v3',
    eligibleAttempts: MINIMUM_CALIBRATION_EVIDENCE,
    correctCount: 18,
    firstAttemptCorrect: 12,
    durationSecondsSum: MINIMUM_CALIBRATION_EVIDENCE * 300,
    independenceSum: MINIMUM_CALIBRATION_EVIDENCE * 95,
    lowAttempts: 15,
    lowCorrect: 6,
    highAttempts: 15,
    highCorrect: 12,
    technicalErrorAttempts: 0,
    updatedAt: '2026-07-25T12:00:00.000Z',
    ...overrides
  };
}

const taskId = assessmentItemBank.find(item => item.eligibleModes.includes('production'))?.taskId || assessmentItemBank[0].taskId;
const tooEasy = calibrationFromAggregate(aggregate(taskId, {
  eligibleAttempts: 100,
  correctCount: 95,
  firstAttemptCorrect: 90,
  durationSecondsSum: 10_000,
  independenceSum: 9_800,
  lowAttempts: 50,
  lowCorrect: 47,
  highAttempts: 50,
  highCorrect: 48
}));
assert(tooEasy?.flags.includes('too-easy'), 'Synthetic easy item was not flagged');

const tooHard = calibrationFromAggregate(aggregate(taskId, {
  eligibleAttempts: 100,
  correctCount: 12,
  firstAttemptCorrect: 8,
  durationSecondsSum: 60_000,
  independenceSum: 9_000,
  lowAttempts: 50,
  lowCorrect: 5,
  highAttempts: 50,
  highCorrect: 7
}));
assert(tooHard?.flags.includes('too-hard'), 'Synthetic hard item was not flagged');

const nondiscriminating = calibrationFromAggregate(aggregate(taskId, {
  eligibleAttempts: 100,
  correctCount: 52,
  firstAttemptCorrect: 40,
  lowAttempts: 50,
  lowCorrect: 25,
  highAttempts: 50,
  highCorrect: 27
}));
assert(nondiscriminating?.flags.includes('nondiscriminating'), 'Synthetic nondiscriminating item was not flagged');

const insufficient = calibrationFromAggregate(aggregate(taskId, {
  eligibleAttempts: 4,
  correctCount: 4,
  firstAttemptCorrect: 4,
  durationSecondsSum: 400,
  independenceSum: 400,
  lowAttempts: 2,
  lowCorrect: 2,
  highAttempts: 2,
  highCorrect: 2
}));
assert(insufficient?.evidence === 'insufficient', 'Small sample must remain insufficient');
assert(insufficient?.flags.length === 0, 'Small sample must not produce quality flags');

const intervalSmall = wilsonInterval(3, 4);
const intervalLarge = wilsonInterval(75, 100);
assert(intervalSmall.high - intervalSmall.low > intervalLarge.high - intervalLarge.low, 'Confidence interval must narrow with evidence volume');

const zeroEvidence = buildAssessmentMeasurement({
  score: 0,
  correct: 0,
  eligibleItems: 0,
  excludedItems: 3,
  taskIds: assessmentItemBank.slice(0, 3).map(item => item.taskId),
  formId: 'QUICK-assessment-blueprint-v3-F1',
  snapshot: calibrationSnapshot([])
});
assert(zeroEvidence.accuracyInterval.low === 0 && zeroEvidence.accuracyInterval.high === 100, 'Zero eligible evidence must have full accuracy uncertainty');
assert(zeroEvidence.scoreBand.low === 0 && zeroEvidence.scoreBand.high === 100, 'Zero eligible evidence must have full score uncertainty');
assert(zeroEvidence.calibratedItems === 0, 'Excluded items must not count as calibrated measurement evidence');
assert(zeroEvidence.reliability === 'limited', 'Zero eligible evidence must remain limited');

if (failures.length) {
  console.error(`Assessment calibration validation failed with ${failures.length} issue(s):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Assessment calibration validated: ${assessmentItemBank.length} items, four canonical blueprint-equivalent forms, known-solution avoidance, invalid-report isolation, zero-evidence uncertainty, Wilson intervals and reproducible quality flags.`);
