import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import initSqlJs from 'sql.js';
import {
  advancedConcurrencyTaskOverride,
  concurrencyAuthoredTaskEvidence
} from '../src/data/advanced-authored-concurrency';
import { advancedLessonTaskModePattern } from '../src/data/advanced-task-progression';
import { tasks } from '../src/data/course-catalog';

function taskNumber(taskId: string) {
  return Number(taskId.replace(/^task-/, ''));
}

function baseTransferTitle(title: string) {
  return title.replace(/^(?:Interview|Puzzle)\s*[·:]\s*/i, '').trim();
}

function normalizedSolutionFingerprint(solution: string) {
  return solution
    .toLowerCase()
    .replace(/'(?:''|[^'])*'/g, '?')
    .replace(/\b\d+(?:\.\d+)?\b/g, '#')
    .replace(/\s+/g, ' ')
    .trim();
}

const expectedIds = Array.from({ length: 10 }, (_, index) => `task-${211 + index}`);
assert.deepEqual(
  Object.keys(concurrencyAuthoredTaskEvidence).sort((left, right) => taskNumber(left) - taskNumber(right)),
  expectedIds,
  'Every authored concurrency task needs explicit evidence tags'
);

const moduleTasks = tasks
  .filter(task => task.module === 'concurrency')
  .sort((left, right) => taskNumber(left.id) - taskNumber(right.id));
assert.deepEqual(moduleTasks.map(task => task.id), expectedIds, 'Concurrency persisted task identity drifted');
assert.deepEqual(
  moduleTasks.map(task => task.mode),
  [...advancedLessonTaskModePattern, ...advancedLessonTaskModePattern],
  'Concurrency must preserve two complete lesson/practice/transfer blocks'
);
assert.equal(new Set(moduleTasks.map(task => baseTransferTitle(task.title))).size, 10, 'Concurrency titles must describe ten distinct decisions');
assert.ok(moduleTasks.every(task => !/[·#]\s*\d+$/u.test(baseTransferTitle(task.title))), 'Concurrency titles cannot rely on numeric suffixes');
assert.equal(new Set(moduleTasks.map(task => normalizedSolutionFingerprint(task.solution))).size, 10, 'Concurrency tasks collapsed to repeated SQL skeletons');

const evidence = new Set(Object.values(concurrencyAuthoredTaskEvidence).flat());
for (const required of [
  'invariant-definition', 'read-write-set', 'optimistic-versioning', 'affected-row-proof',
  'stale-write-rejection', 'lost-update', 'atomic-update', 'savepoint', 'partial-rollback',
  'idempotency-key', 'replay-safety', 'retry-classification', 'idempotent-retry',
  'single-lease', 'claim-race', 'conservation-invariant', 'transaction-ledger',
  'conflict-diagnosis', 'outcome-reconciliation', 'fail-closed-retry'
]) assert.ok(evidence.has(required as never), `Concurrency ladder lost evidence: ${required}`);

for (const task of moduleTasks) {
  const taskEvidence = concurrencyAuthoredTaskEvidence[task.id];
  const authored = advancedConcurrencyTaskOverride(task.id);
  assert.ok(taskEvidence && taskEvidence.length >= 2, `${task.id}: expected at least two concurrency evidence dimensions`);
  assert.ok(authored, `${task.id}: canonical authored concurrency source is missing`);
  assert.equal(task.solution, authored?.solution, `${task.id}: progression overlays changed the canonical concurrency solution`);
  assert.ok(task.description.length >= 145, `${task.id}: concurrency reasoning contract is too thin`);
  assert.ok(task.solution.includes('SELECT'), `${task.id}: task lacks observable result evidence`);
}

const requiredSqlMarkers: Readonly<Record<string, readonly string[]>> = {
  'task-211': ['read_set', 'write_set', 'total-balance-conserved'],
  'task-212': ['version = 3', 'version = version + 1', 'changes() AS affected_rows'],
  'task-213': ["THEN 'version-conflict'", 'changes() = 0'],
  'task-214': ['observed_value + 1', 'value = value + 1', 'lost_updates_exposed'],
  'task-215': ['SAVEPOINT reserve_attempt', 'ROLLBACK TO reserve_attempt', 'RELEASE reserve_attempt'],
  'task-216': ['processed_requests', 'INSERT OR IGNORE', 'changes() = 1', "'applied-once'"],
  'task-217': ["already_committed = 1", "error_code IN ('SQLITE_BUSY','DEADLOCK','TIMEOUT')", "THEN 'manual-review'"],
  'task-218': ['job_id INTEGER PRIMARY KEY', 'INSERT OR IGNORE INTO job_leases', "THEN 'acquired'"],
  'task-219': ['BEGIN;', 'transfer_ledger', 'conservation_gap', 'COMMIT;'],
  'task-220': ["THEN 'optimistic-conflict'", "THEN 'retryable'", 'reconciliation_gap']
};
for (const task of moduleTasks) {
  for (const marker of requiredSqlMarkers[task.id] || []) {
    assert.ok(task.solution.includes(marker), `${task.id}: missing concurrency proof marker ${marker}`);
  }
}

const transferTasks = moduleTasks.filter(task => task.mode === 'interview' || task.mode === 'puzzle');
assert.equal(transferTasks.length, 4, 'Concurrency must retain two Interview and two Puzzle tasks');
for (const task of transferTasks) assert.ok(task.starter.includes('--'), `${task.id}: transfer task lost blank-editor framing`);

type ExpectedResult = {
  columns: readonly string[];
  values: readonly (readonly (string | number | null)[])[];
};

const expectedResults: Readonly<Record<string, ExpectedResult>> = {
  'task-211': {
    columns: ['operation_id', 'read_set', 'write_set', 'invariant'],
    values: [[1, 'accounts', 'accounts,transfer_ledger', 'total-balance-conserved'], [2, 'profiles', 'profiles', 'version-monotonic']]
  },
  'task-212': { columns: ['affected_rows', 'document_id', 'content', 'version'], values: [[1, 1, 'published', 4]] },
  'task-213': { columns: ['affected_rows', 'document_id', 'content', 'version', 'outcome'], values: [[0, 1, 'published', 4, 'version-conflict']] },
  'task-214': { columns: ['unsafe_final', 'atomic_final', 'lost_updates_exposed'], values: [[11, 12, 1]] },
  'task-215': { columns: ['sku', 'stock', 'order_rows', 'outcome'], values: [['GPU', 5, 0, 'rejected-and-restored']] },
  'task-216': { columns: ['ledger_rows', 'balance', 'outcome'], values: [[1, 125, 'applied-once']] },
  'task-217': {
    columns: ['attempt_id', 'error_code', 'idempotent', 'already_committed', 'retry_decision'],
    values: [[1, 'SQLITE_BUSY', 1, 0, 'retry'], [2, 'DEADLOCK', 1, 0, 'retry'], [3, 'UNIQUE_CONSTRAINT', 1, 0, 'do-not-retry'], [4, 'SQLITE_BUSY', 0, 0, 'manual-review'], [5, 'TIMEOUT', 1, 1, 'already-committed']]
  },
  'task-218': {
    columns: ['job_id', 'worker_id', 'lease_owner', 'claim_outcome'],
    values: [[10, 'worker-B', 'worker-B', 'acquired'], [10, 'worker-A', 'worker-B', 'lost-race'], [20, 'worker-C', 'worker-C', 'acquired']]
  },
  'task-219': {
    columns: ['total_before', 'total_after', 'conservation_gap', 'account_a', 'account_b', 'ledger_rows'],
    values: [[140, 140, 0, 70, 70, 1]]
  },
  'task-220': {
    columns: ['total_attempts', 'committed_attempts', 'conflict_attempts', 'retryable_attempts', 'manual_review_attempts', 'rejected_attempts', 'reconciliation_gap'],
    values: [[6, 2, 1, 1, 1, 1, 0]]
  }
};

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(currentDirectory, '..');
const SQL = await initSqlJs({ locateFile: file => path.join(projectRoot, 'node_modules', 'sql.js', 'dist', file) });
for (const task of moduleTasks) {
  const database = new SQL.Database();
  try {
    const result = database.exec(task.solution);
    assert.equal(result.length, 1, `${task.id}: expected one result set`);
    const expectation = expectedResults[task.id];
    assert.deepEqual(result[0].columns, [...expectation.columns], `${task.id}: columns drifted`);
    assert.deepEqual(result[0].values, expectation.values.map(row => [...row]), `${task.id}: concurrency semantics drifted`);
  } finally {
    database.close();
  }
}

console.log('Authored concurrency validated: exact invariant, optimistic-write, lost-update, savepoint, idempotency, retry, lease, transfer and outcome outputs.');
