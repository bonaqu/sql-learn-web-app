import { readFileSync } from 'node:fs';
import type { LearningAnalyticsEvent, LearningAnalyticsState } from '../src/lib/learning-analytics.ts';
import {
  buildLearningAnalyticsSnapshot,
  localLearningAnalyticsReport,
  sanitizeLearningAnalyticsState
} from '../src/lib/learning-analytics.ts';
import { defaultProgress } from '../src/lib/progress.ts';

const failures: string[] = [];
const assert = (condition: unknown, message: string) => { if (!condition) failures.push(message); };
const userId = '12345678-1234-4234-9234-123456789abc';
const sessionId = 'analytics-session-1234';
const start = new Date('2026-07-20T10:00:00.000Z');

function event(index: number, input: Omit<LearningAnalyticsEvent, 'version' | 'id' | 'sessionId' | 'occurredAt'>): LearningAnalyticsEvent {
  return {
    version: 1,
    id: `analytics-event-${String(index).padStart(4, '0')}`,
    sessionId,
    occurredAt: new Date(start.getTime() + index * 60_000).toISOString(),
    ...input
  };
}

const events: LearningAnalyticsEvent[] = [
  event(0, { type: 'session_started' }),
  event(1, { type: 'task_opened', taskId: 'task-001', moduleId: 'sql-thinking' }),
  event(2, { type: 'attempted', taskId: 'task-001', moduleId: 'sql-thinking', correct: false, independent: false }),
  event(3, { type: 'diagnostic_observed', taskId: 'task-001', moduleId: 'sql-thinking', diagnosticKind: 'result-shape' }),
  event(4, { type: 'attempted', taskId: 'task-001', moduleId: 'sql-thinking', correct: false, independent: false }),
  event(5, { type: 'diagnostic_observed', taskId: 'task-001', moduleId: 'sql-thinking', diagnosticKind: 'result-shape' }),
  event(6, { type: 'task_opened', taskId: 'task-002', moduleId: 'sql-thinking' }),
  event(7, { type: 'attempted', taskId: 'task-002', moduleId: 'sql-thinking', correct: false, independent: false }),
  event(8, { type: 'diagnostic_observed', taskId: 'task-002', moduleId: 'sql-thinking', diagnosticKind: 'result-shape' }),
  event(9, { type: 'attempted', taskId: 'task-002', moduleId: 'sql-thinking', correct: false, independent: false }),
  event(10, { type: 'attempted', taskId: 'task-002', moduleId: 'sql-thinking', correct: false, independent: false }),
  event(11, { type: 'attempted', taskId: 'task-002', moduleId: 'sql-thinking', correct: true, independent: true }),
  event(12, { type: 'understood', taskId: 'task-002', moduleId: 'sql-thinking', correct: true }),
  event(13, { type: 'independent_pass', taskId: 'task-002', moduleId: 'sql-thinking', correct: true, independent: true }),
  event(14, { type: 'remediation_started', taskId: 'task-002', moduleId: 'sql-thinking', remediation: 'hint' }),
  event(15, { type: 'remediation_completed', taskId: 'task-002', moduleId: 'sql-thinking', remediation: 'retry', correct: true, independent: true }),
  event(16, { type: 'session_ended', durationBucket: '15-30m' })
];

const rawState: LearningAnalyticsState = {
  version: 1,
  userId,
  sharing: 'coarse-opt-in',
  events: [...events, events[0]],
  experimentVariants: { 'remediation-copy-v1': 'control', 'unknown-experiment': 'variant-b' },
  updatedAt: new Date('2026-07-20T10:16:00.000Z').toISOString()
};

const state = sanitizeLearningAnalyticsState(rawState, userId);
assert(state.events.length === events.length, 'Duplicate event IDs must be removed');
assert(!Object.hasOwn(state.experimentVariants, 'unknown-experiment'), 'Unknown experiment IDs must not survive sanitization');
assert(state.events.every(item => !Object.hasOwn(item, 'sql')), 'Local event schema must not contain learner SQL');

const report = localLearningAnalyticsReport(state, defaultProgress);
assert(report.funnel.opened === 2, `Expected two opened tasks, got ${report.funnel.opened}`);
assert(report.funnel.attempted === 2, `Expected two attempted tasks, got ${report.funnel.attempted}`);
assert(report.funnel.understood === 1, `Expected one understood task, got ${report.funnel.understood}`);
assert(report.funnel.independent === 1, `Expected one independent task, got ${report.funnel.independent}`);
assert(report.attempts === 6, `Expected six attempts, got ${report.attempts}`);
assert(report.remediationSuccesses === 1, 'Remediation success was not counted');
assert(report.interventions.some(item => item.id === 'overload'), 'Overload rule did not fire for a 1/6 correct session');
assert(report.interventions.some(item => item.id === 'repeated-misconception'), 'Repeated misconception rule did not fire across two tasks');

const snapshot = buildLearningAnalyticsSnapshot(state, defaultProgress);
const serialized = JSON.stringify(snapshot).toLowerCase();
assert(snapshot.version === 1 && snapshot.courseVersion === 3, 'Snapshot version contract changed');
assert(snapshot.rows.length === 1 && snapshot.rows[0].moduleId === 'sql-thinking', 'Snapshot must aggregate at module level');
assert(!serialized.includes('task-001') && !serialized.includes('task-002'), 'Server snapshot must not contain task IDs');
assert(!serialized.includes('select ') && !serialized.includes(' sql'), 'Server snapshot must not contain learner SQL');
assert(!serialized.includes(userId), 'Server snapshot must not contain the user ID in its payload');

const migration = readFileSync(new URL('../migrations/0017_learning_analytics.sql', import.meta.url), 'utf8');
const worker = readFileSync(new URL('../worker/learning-analytics.ts', import.meta.url), 'utf8');
const index = readFileSync(new URL('../worker/index.ts', import.meta.url), 'utf8');
const library = readFileSync(new URL('../src/lib/learning-analytics.ts', import.meta.url), 'utf8');
const portal = readFileSync(new URL('../src/components/LearningAnalyticsPortal.tsx', import.meta.url), 'utf8');
const agent = readFileSync(new URL('../src/components/LearningAnalyticsAgent.tsx', import.meta.url), 'utf8');
const privacy = readFileSync(new URL('../docs/learning-analytics-privacy.md', import.meta.url), 'utf8');

assert((migration.match(/ON DELETE CASCADE/gi) || []).length === 2, 'Both analytics tables must cascade with account deletion');
assert(!/\bsql\s+TEXT\b/i.test(migration), 'Analytics D1 schema must not add a SQL text column');
assert(worker.includes('const MINIMUM_COHORT = 5'), 'Cohort suppression threshold must be five');
assert(worker.includes("current.sharing !== 'coarse-opt-in'"), 'Snapshot writes must require explicit opt-in');
assert(worker.includes('exactKeys(row, ROW_KEYS)'), 'Snapshot rows must reject unknown/free-text fields');
assert(worker.includes('DELETE FROM learning_analytics_snapshots'), 'Opt-out/delete must remove account snapshots');
assert(worker.includes('Number(row.retained) <= Number(row.independent)'), 'Impossible funnel states need validation');
assert(!/console\.(log|error)\([^\n]*payload/i.test(worker), 'Worker appears to log an analytics payload');
assert(index.includes('handleLearningAnalyticsRequest'), 'Authenticated Worker route is missing');
assert(library.includes("sharing: 'off'"), 'Local analytics must default to off');
assert(library.includes('MAX_EVENTS = 5_000'), 'Local event retention ceiling is missing');
assert(library.includes('MAX_EVENT_AGE_MS = 180'), 'Local event age boundary is missing');
assert(library.includes('KNOWN_EXPERIMENTS'), 'Experiment IDs are not allowlisted');
assert(agent.includes('PROGRESS_CHANGED_EVENT'), 'Analytics collector is not driven by progress deltas');
assert(portal.includes('Не собирается:'), 'UI does not disclose excluded data');
assert(portal.includes('Coarse opt-in'), 'UI does not expose explicit opt-in');
assert(portal.includes('Удалить данные'), 'UI does not expose deletion');
assert(portal.includes('Скрыть сигнал'), 'Interventions are not dismissible');
assert(privacy.includes('minimum cohort is five'), 'Privacy threat model does not document suppression');
assert(privacy.includes('Non-goals'), 'Privacy threat model does not state non-goals');

if (failures.length) {
  console.error(`Learning analytics validation failed with ${failures.length} issue(s):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('Learning analytics validation passed: versioned local events, deterministic interventions, SQL-free snapshots, explicit opt-in, k=5 suppression, export/delete and D1 cascade privacy contracts.');
