import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  courseHealthItemView,
  courseHealthSignals,
  uncertaintyLabel,
  wilsonInterval,
  type CourseHealthItemAggregate
} from '../src/lib/course-health';

const base: CourseHealthItemAggregate = {
  periodStart: '2026-08-17',
  taskId: 'task-001',
  lessonId: 'lesson-sql-thinking',
  contributors: 5,
  attempted: 5,
  independent: 1,
  hinted: 4,
  solutionViewed: 2,
  misconceptions: 4,
  remediations: 5,
  remediationSuccesses: 1,
  retained: 0,
  placementChecks: 5,
  placementMatches: 2
};

const dictionary = readFileSync(new URL('../docs/learning-metrics-dictionary.md', import.meta.url), 'utf8');
const pilot = readFileSync(new URL('../docs/human-learning-pilot.md', import.meta.url), 'utf8');
const register = readFileSync(new URL('../docs/evidence/course-health-register.md', import.meta.url), 'utf8');
const issues = readFileSync(new URL('../docs/course-health-issue-register.md', import.meta.url), 'utf8');

assert.match(dictionary, /Clicks, page views, session length, streaks and XP are explicitly rejected as mastery proxies/);
for (const metric of ['Independent success', 'Hint dependence', 'Solution dependence', 'Misconception frequency', 'Remediation success', 'Delayed retention', 'Review debt', 'Stall', 'Placement accuracy', 'Transfer']) {
  assert.ok(dictionary.includes(metric), `Metric dictionary is missing ${metric}`);
}
for (const outcome of ['Independent task success', 'Delayed retention', 'Transfer', 'Next-step clarity', 'Friction/abandonment']) {
  assert.ok(pilot.includes(outcome), `Pilot protocol is missing ${outcome}`);
}
assert.match(pilot, /NOT STARTED — EXTERNAL ACCEPTANCE GATE/);
assert.match(pilot, /Stop the session immediately/);
assert.match(register, /no participants\/results/);
assert.match(issues, /P0.*privacy leakage/s);
assert.match(issues, /GitHub #82/);

assert.deepEqual(courseHealthSignals([]), [], 'Zero-evidence state must be deterministic and empty');
const lowSample = courseHealthItemView(base);
assert.equal(lowSample.evidenceStrength, 'low-sample');
assert.ok(lowSample.independentInterval.low < 0.2 && lowSample.independentInterval.high > 0.45, 'Low-sample interval must expose uncertainty');
assert.match(uncertaintyLabel(lowSample), /Мало данных: n=5/);
assert.deepEqual(wilsonInterval(0, 0), { rate: 0, low: 0, high: 1 });

const neighbour: CourseHealthItemAggregate = {
  ...base,
  taskId: 'task-002',
  contributors: 20,
  attempted: 40,
  independent: 35,
  hinted: 2,
  solutionViewed: 0,
  misconceptions: 1,
  remediations: 2,
  remediationSuccesses: 2,
  retained: 10,
  placementChecks: 10,
  placementMatches: 9
};
const signals = courseHealthSignals([base, neighbour]);
for (const expected of ['lesson-success-task-failure', 'mass-misconception', 'hint-escalation', 'placement-mismatch']) {
  assert.ok(signals.some(item => item.kind === expected && item.taskId === 'task-001'), `Missing ${expected} scenario`);
}
assert.ok(signals.some(item => item.kind === 'retention-collapse' && item.taskId === 'task-002'), 'Delayed retention collapse was not detected');
assert.ok(signals.every(item => item.priority !== 'P0'), 'Course-quality hypotheses must not become P0 without data/privacy breakage');
assert.ok(signals.every(item => item.alternative.length > 20 && item.acceptance.length >= 2), 'Signals need plausible alternatives and acceptance criteria');

const broadFailure = [1, 2, 3].map(index => ({
  ...base,
  taskId: `task-00${index}`,
  contributors: 20,
  attempted: 20,
  independent: 4,
  hinted: 12,
  solutionViewed: 6,
  misconceptions: 14
}));
assert.ok(courseHealthSignals(broadFailure).some(item => item.kind === 'lesson-explanation-risk' && !item.taskId), 'Broad lesson failure must differ from one-item difficulty jump');

const serialized = JSON.stringify({ lowSample, signals }).toLowerCase();
for (const forbidden of ['sql', 'email', 'password', 'token', 'session length', 'xp']) {
  assert.ok(!serialized.includes(`"${forbidden}"`), `Course-health schema unexpectedly contains ${forbidden}`);
}

process.stdout.write('Course-health validation passed: zero/low-sample/partial scenarios, Wilson uncertainty, task-vs-lesson diagnosis, hint escalation, placement mismatch, retention collapse and actionable non-blaming issues.\n');
