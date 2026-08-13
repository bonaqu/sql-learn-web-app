import assert from 'node:assert/strict';
import { tasks } from '../src/data/course-catalog';
import {
  CLEAN_REVIEW_INTERVAL_DAYS,
  defaultProgress,
  hasDurableTaskEvidence,
  INITIAL_RETRIEVAL_DELAY_MINUTES,
  recordAttempt,
  recordHint,
  recordSolutionView,
  relatedRetrievalTask,
  reviewReason,
  reviewQueue,
  type Progress,
  type TaskStats
} from '../src/lib/progress';
import { gradeReviewSchedule, type ReviewSchedule } from '../src/lib/spaced-repetition';
import { evaluationContractForTask } from '../src/data/foundation-evaluation-contracts';
import { FOUNDATION_EVIDENCE_CONTRACT_VERSION, TASK_EVALUATION_CONTRACT_VERSION } from '../src/lib/task-evaluation-contract';

const target = tasks.find(task => task.mode === 'practice') || tasks[0];
assert.ok(target, 'Review scheduling requires at least one executable task.');

const now = Date.now();
const isoDaysAgo = (days: number) => new Date(now - days * 86_400_000).toISOString();
const history = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map(day => ({ day, solved: 0 }));

function progress(stats: TaskStats, completed = true): Progress {
  const contract = evaluationContractForTask(target.id);
  const verified = stats.independentPasses && target.evaluationContractId ? {
    evidenceContractVersion: FOUNDATION_EVIDENCE_CONTRACT_VERSION,
    evaluationContractId: target.evaluationContractId,
    evaluationContractVersion: TASK_EVALUATION_CONTRACT_VERSION,
    validatedFixtureIds: contract?.fixtures.map(fixture => fixture.id),
    hiddenFixtureIds: contract?.fixtures.filter(fixture => fixture.visibility !== 'public').map(fixture => fixture.id)
  } : {};
  return {
    version: 4,
    completed: completed ? [target.id] : [],
    taskStats: { [target.id]: { ...stats, ...verified } },
    xp: completed ? target.xp : 0,
    streak: completed ? 1 : 0,
    history
  };
}

const recentIndependentAt = isoDaysAgo(0.1);
const recentIndependent = progress({
  attempts: 2,
  incorrect: 1,
  hintsUsed: 1,
  independentPasses: 1,
  lastIndependentAt: recentIndependentAt,
  lastAttemptAt: recentIndependentAt,
  completedAt: isoDaysAgo(1)
});
assert.ok(!reviewQueue(recentIndependent).some(task => task.id === target.id),
  'A clean latest independent pass must resume the frontier instead of scheduling immediate review.');

const dueIndependentAt = isoDaysAgo(CLEAN_REVIEW_INTERVAL_DAYS + 0.5);
const dueIndependent = progress({
  attempts: 1,
  incorrect: 0,
  hintsUsed: 0,
  independentPasses: 1,
  lastIndependentAt: dueIndependentAt,
  lastAttemptAt: dueIndependentAt,
  completedAt: dueIndependentAt
});
assert.ok(reviewQueue(dueIndependent).some(task => task.id === target.id),
  'A clean independent pass must enter retrieval review after the spaced interval.');

const guidedCompletion = progress({
  attempts: 1,
  incorrect: 0,
  hintsUsed: 1,
  solutionViews: 0,
  independentPasses: 0,
  lastAttemptAt: isoDaysAgo(0.1),
  completedAt: isoDaysAgo(0.1)
});
assert.ok(reviewQueue(guidedCompletion).some(task => task.id === target.id),
  'Guided completion without independent evidence must schedule immediate remediation.');

const unresolvedFailure = progress({
  attempts: 2,
  incorrect: 1,
  hintsUsed: 0,
  independentPasses: 1,
  lastIndependentAt: isoDaysAgo(1),
  lastAttemptAt: isoDaysAgo(0.1),
  completedAt: isoDaysAgo(1)
});
assert.ok(reviewQueue(unresolvedFailure).some(task => task.id === target.id),
  'A failed attempt after prior independent evidence must restore immediate remediation.');

const unfinished = progress({
  attempts: 1,
  incorrect: 0,
  hintsUsed: 0,
  lastAttemptAt: isoDaysAgo(0.1)
}, false);
assert.ok(reviewQueue(unfinished).some(task => task.id === target.id),
  'An unfinished attempted task must remain recoverable through the review queue.');

const clock = Date.parse('2026-08-11T10:00:00.000Z');
const contract = evaluationContractForTask(target.id);
assert.ok(contract, 'Durable scheduling requires an executable target contract');
const contractEvidence = contract ? {
  contractId: contract.id,
  contractVersion: TASK_EVALUATION_CONTRACT_VERSION,
  evidenceContractVersion: FOUNDATION_EVIDENCE_CONTRACT_VERSION,
  fixtureIds: contract.fixtures.map(fixture => fixture.id),
  hiddenFixtureIds: contract.fixtures.filter(fixture => fixture.visibility !== 'public').map(fixture => fixture.id)
} : undefined;
const blank = (): Progress => ({
  ...defaultProgress,
  completed: [],
  taskStats: {},
  history: defaultProgress.history.map(point => ({ ...point }))
});
let scheduled = recordAttempt(blank(), target, true, { independent: true, contractEvidence, at: clock });
const transfer = relatedRetrievalTask(target, scheduled);
assert.ok(transfer && transfer.id !== target.id, 'Independent success must choose a non-identical related retrieval contract');
if (transfer) {
  const dueAt = Date.parse(scheduled.taskStats[transfer.id].retrievalDueAt || '');
  assert.equal(dueAt, clock + INITIAL_RETRIEVAL_DELAY_MINUTES * 60_000,
    'Initial retrieval delay must be deterministic and fake-clock testable');
  assert.ok(!reviewQueue(scheduled, 24, dueAt - 1).some(task => task.id === transfer.id),
    'Retrieval must not appear before its due boundary');
  assert.ok(reviewQueue(scheduled, 24, dueAt).some(task => task.id === transfer.id),
    'Retrieval must appear exactly at its due boundary');
  assert.equal(Date.parse('2026-08-11T13:10:00.000+03:00'), dueAt,
    'Equivalent timezone offsets must resolve to the same due instant');

  const repeatedSourcePass = recordAttempt(scheduled, target, true, { independent: true, contractEvidence, at: clock + 60_000 });
  assert.equal(repeatedSourcePass.taskStats[transfer.id].retrievalDueAt, scheduled.taskStats[transfer.id].retrievalDueAt,
    'Repeated source events must not duplicate or postpone the existing queue item');

  scheduled.taskStats[transfer.id].retrievalDueAt = new Date(dueAt).toISOString();
  const transferContract = evaluationContractForTask(transfer.id);
  const transferEvidence = transferContract ? {
    contractId: transferContract.id,
    contractVersion: TASK_EVALUATION_CONTRACT_VERSION,
    evidenceContractVersion: FOUNDATION_EVIDENCE_CONTRACT_VERSION,
    fixtureIds: transferContract.fixtures.map(fixture => fixture.id),
    hiddenFixtureIds: transferContract.fixtures.filter(fixture => fixture.visibility !== 'public').map(fixture => fixture.id)
  } : undefined;
  const passed = recordAttempt(scheduled, transfer, true, { independent: true, contractEvidence: transferEvidence, at: dueAt });
  assert.ok(hasDurableTaskEvidence(passed, target.id, dueAt + 1),
    'Clean delayed transfer must establish durable evidence');
  assert.equal(passed.taskStats[transfer.id].retrievalIntervalDays, 1,
    'First clean retrieval must expand to a one-day interval');
  const nextDue = Date.parse(passed.taskStats[transfer.id].retrievalDueAt || '');
  assert.equal(nextDue, dueAt + 86_400_000, 'First interval must have an exact deterministic bound');
  assert.equal(reviewReason(passed, transfer.id, nextDue)?.code, 'evidence-refresh',
    'Overdue durable evidence must explain why the task returned');

  const failed = recordAttempt(passed, transfer, false, { at: nextDue });
  assert.ok(!hasDurableTaskEvidence(failed, target.id, nextDue + 1),
    'Failed retrieval must remove only the relevant durable evidence');
  assert.equal(failed.taskStats[transfer.id].retrievalLapses, 1, 'Failed retrieval must record one relevant lapse');
  assert.equal(Date.parse(failed.taskStats[transfer.id].retrievalDueAt || ''), nextDue + 10 * 60_000,
    'First failed retrieval must schedule a bounded ten-minute retry');
  assert.equal(reviewReason(failed, transfer.id, nextDue + 10 * 60_000)?.code, 'failed-retrieval',
    'Failed retrieval must produce a targeted returning-learner explanation');
}

let assisted = recordHint(blank(), target.id);
assisted = recordAttempt(assisted, target, true, { independent: false, at: clock });
const assistedTransfer = relatedRetrievalTask(target, assisted);
assert.equal(assisted.taskStats[target.id].assistedPasses, 1, 'Guided success must be stored distinctly');
assert.ok(assistedTransfer && assisted.taskStats[assistedTransfer.id].retrievalSourceTaskId === target.id,
  'Guided success must schedule a related independent follow-up');

const solutionExposed = recordSolutionView(blank(), target.id, clock);
const solutionTransfer = relatedRetrievalTask(target, solutionExposed);
assert.ok(solutionTransfer && solutionTransfer.id !== target.id,
  'Solution exposure must schedule a different contract, never the revealed task itself');

for (const moduleId of new Set(tasks.map(task => task.module))) {
  const moduleTasks = tasks.filter(task => task.module === moduleId);
  let paired = blank();
  for (const moduleTask of moduleTasks) {
    paired = recordAttempt(paired, moduleTask, true, { independent: true, at: clock });
  }
  const incoming = moduleTasks.map(moduleTask => paired.taskStats[moduleTask.id]?.retrievalSourceTaskId);
  for (const [index, sourceId] of incoming.entries()) {
    assert.ok(sourceId, `Module ${moduleId} must allocate a retrieval source for ${moduleTasks[index].id}`);
    assert.notEqual(sourceId, moduleTasks[index].id,
      `Module ${moduleId} must never assign ${moduleTasks[index].id} as its own retrieval target`);
  }
  assert.equal(new Set(incoming).size, moduleTasks.length,
    `Module ${moduleId} must allocate one stable non-overwriting target per source task`);
  assert.deepEqual(new Set(incoming), new Set(moduleTasks.map(moduleTask => moduleTask.id)),
    `Module ${moduleId} must keep every source task reachable through delayed retrieval`);
}

const aggregateReview = tasks.find(task => task.module === 'aggregates');
const groupingReview = tasks.find(task => task.module === 'grouping');
const secondAggregateReview = tasks.find(task => task.module === 'aggregates' && task.id !== aggregateReview?.id);
assert.ok(aggregateReview && groupingReview && secondAggregateReview, 'Interleaving fixtures require aggregate and grouping tasks');
if (aggregateReview && groupingReview && secondAggregateReview) {
  const interleaving = blank();
  for (const task of [aggregateReview, secondAggregateReview, groupingReview]) {
    interleaving.taskStats[task.id] = {
      attempts: 1,
      incorrect: 1,
      hintsUsed: 0,
      lastAttemptAt: new Date(clock - 60_000).toISOString()
    };
  }
  const interleavedModules = reviewQueue(interleaving, 3, clock).map(task => task.module);
  assert.deepEqual(interleavedModules.slice(0, 2), ['aggregates', 'grouping'],
    'Review queue should interleave confusable aggregate/grouping concepts before repeating one module');
}

const staleReview: ReviewSchedule = {
  cardId: 'review-select',
  dueAt: new Date(now + 60_000).toISOString(),
  intervalDays: 3,
  ease: 2.5,
  repetitions: 2,
  lapses: 1,
  introducedAt: isoDaysAgo(4),
  lastReviewedAt: isoDaysAgo(1)
};
assert.equal(gradeReviewSchedule(staleReview, 'again', now), staleReview,
  'A stale/future Review task ID must not change review debt, repetitions or lapse evidence.');

process.stdout.write(`Review scheduling validated: immediate remediation, ${CLEAN_REVIEW_INTERVAL_DAYS}-day spacing and fail-closed stale Review grading.\n`);
