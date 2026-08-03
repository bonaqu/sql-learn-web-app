import assert from 'node:assert/strict';
import { tasks } from '../src/data/course-catalog';
import {
  CLEAN_REVIEW_INTERVAL_DAYS,
  reviewQueue,
  type Progress,
  type TaskStats
} from '../src/lib/progress';

const target = tasks.find(task => task.mode === 'practice') || tasks[0];
assert.ok(target, 'Review scheduling requires at least one executable task.');

const now = Date.now();
const isoDaysAgo = (days: number) => new Date(now - days * 86_400_000).toISOString();
const history = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map(day => ({ day, solved: 0 }));

function progress(stats: TaskStats, completed = true): Progress {
  return {
    version: 4,
    completed: completed ? [target.id] : [],
    taskStats: { [target.id]: stats },
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

console.log(`Review scheduling validated: immediate remediation for unresolved evidence and ${CLEAN_REVIEW_INTERVAL_DAYS}-day spacing after a clean latest independent pass.`);