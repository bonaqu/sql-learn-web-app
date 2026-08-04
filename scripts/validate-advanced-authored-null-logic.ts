import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import initSqlJs from 'sql.js';
import {
  nullLogicAuthoredTaskEvidence,
  nullLogicAuthoredTaskIds
} from '../src/data/advanced-authored-null-logic';
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

const expectedIds = Array.from({ length: 10 }, (_, index) => `task-${141 + index}`);
assert.deepEqual(
  [...nullLogicAuthoredTaskIds].sort((left, right) => taskNumber(left) - taskNumber(right)),
  expectedIds,
  'NULL-logic authored identity must remain task-141 through task-150'
);
assert.deepEqual(
  Object.keys(nullLogicAuthoredTaskEvidence).sort((left, right) => taskNumber(left) - taskNumber(right)),
  expectedIds,
  'Every authored NULL-logic task needs explicit evidence tags'
);

const moduleTasks = tasks
  .filter(task => task.module === 'null-logic-advanced')
  .sort((left, right) => taskNumber(left.id) - taskNumber(right.id));
assert.deepEqual(moduleTasks.map(task => task.id), expectedIds, 'NULL-logic persisted task identity drifted');
assert.deepEqual(
  moduleTasks.map(task => task.mode),
  [...advancedLessonTaskModePattern, ...advancedLessonTaskModePattern],
  'NULL-logic must preserve two complete lesson/practice/transfer blocks'
);
assert.equal(
  new Set(moduleTasks.map(task => baseTransferTitle(task.title))).size,
  10,
  'NULL-logic titles must describe ten distinct reasoning decisions'
);
assert.ok(
  moduleTasks.every(task => !/[·#]\s*\d+$/u.test(baseTransferTitle(task.title))),
  'NULL-logic titles cannot use numeric suffixes as their primary distinction'
);
assert.equal(
  new Set(moduleTasks.map(task => normalizedSolutionFingerprint(task.solution))).size,
  10,
  'NULL-logic tasks collapsed to repeated SQL skeletons after literal normalization'
);

const evidence = new Set(Object.values(nullLogicAuthoredTaskEvidence).flat());
for (const required of [
  'three-valued-logic',
  'where-unknown',
  'not-in-trap',
  'null-safe-anti-join',
  'null-safe-equality',
  'business-fallback',
  'missingness-preservation',
  'safe-division',
  'aggregate-null-semantics',
  'explicit-null-order',
  'outer-join-presence',
  'check-unknown',
  'not-null-contract'
]) {
  assert.ok(evidence.has(required as never), `NULL-logic authored ladder lost evidence: ${required}`);
}

for (const task of moduleTasks) {
  const taskEvidence = nullLogicAuthoredTaskEvidence[task.id];
  assert.ok(taskEvidence && taskEvidence.length >= 2, `${task.id}: expected at least two NULL evidence dimensions`);
  assert.ok(task.description.length >= 145, `${task.id}: NULL reasoning contract is too thin`);
  assert.ok(task.solution.includes('SELECT'), `${task.id}: task lacks observable result evidence`);
}

const requiredSqlMarkers: Readonly<Record<string, readonly string[]>> = {
  'task-141': ['one_equals_null', 'null_equals_null', "ELSE 'UNKNOWN'"],
  'task-142': ["status <> 'Closed' OR status IS NULL", 'unknown-status'],
  'task-143': ['NOT EXISTS', 'blocked_regions b', 'safe_customer_count'],
  'task-144': ['expected_value = actual_value', 'expected_value IS NULL AND actual_value IS NULL'],
  'task-145': ["NULLIF(TRIM(email), '')", 'raw_email IS NULL', 'display_email'],
  'task-146': ['NULLIF(total_count, 0)', 'no-denominator', 'resolved_ratio'],
  'task-147': ['COUNT(*) AS total_rows', 'COUNT(resolution_minutes)', 'missing_rows', 'known_average'],
  'task-148': ['ORDER BY due_at IS NULL ASC', 'due_at ASC', 'task_id ASC'],
  'task-149': ['LEFT JOIN notification_preferences', 'p.customer_id IS NULL', 'p.channel IS NULL'],
  'task-150': ['CHECK(score BETWEEN 0 AND 100)', "pragma_table_info('score_policy')", 'check-accepted-unknown']
};

for (const task of moduleTasks) {
  for (const marker of requiredSqlMarkers[task.id] || []) {
    assert.ok(task.solution.includes(marker), `${task.id}: missing NULL-logic proof marker ${marker}`);
  }
}

const dangerousNotIn = moduleTasks.filter(task => /\bNOT\s+IN\s*\(/i.test(task.solution));
assert.equal(dangerousNotIn.length, 0, 'Authored NULL module must not demonstrate unsafe NOT IN over nullable sets');

const transferTasks = moduleTasks.filter(task => task.mode === 'interview' || task.mode === 'puzzle');
assert.equal(transferTasks.length, 4, 'NULL-logic must retain two Interview and two Puzzle transfer tasks');
for (const task of transferTasks) {
  assert.ok(task.starter.includes('--'), `${task.id}: transfer task lost its blank-editor reasoning contract`);
}

const expectedResults: Readonly<Record<string, {
  columns: readonly string[];
  values: readonly (readonly (string | number | null)[])[];
}>> = {
  'task-141': {
    columns: ['label', 'truth_value'],
    values: [
      ['null_equals_null', 'UNKNOWN'],
      ['one_equals_null', 'UNKNOWN'],
      ['one_equals_one', 'TRUE'],
      ['one_equals_two', 'FALSE']
    ]
  },
  'task-142': {
    columns: ['ticket_id', 'status', 'inclusion_reason'],
    values: [
      [201, 'Open', 'not-closed'],
      [203, null, 'unknown-status'],
      [204, 'Pending', 'not-closed']
    ]
  },
  'task-143': {
    columns: ['customer_id', 'region', 'safe_customer_count'],
    values: [[2, 'LV', 2], [3, 'EE', 2]]
  },
  'task-144': {
    columns: ['pair_id', 'expected_value', 'actual_value', 'match_state'],
    values: [
      [1, 'email', 'email', 'match'],
      [2, null, null, 'match'],
      [3, null, 'sms', 'different'],
      [4, 'chat', null, 'different'],
      [5, 'vpn', 'lms', 'different']
    ]
  },
  'task-145': {
    columns: ['customer_id', 'raw_email', 'normalized_email', 'email_state', 'display_email'],
    values: [
      [1, null, null, 'missing', 'not-provided'],
      [2, '   ', null, 'blank', 'not-provided'],
      [3, ' Alice@Example.com ', 'Alice@Example.com', 'present', 'Alice@Example.com']
    ]
  },
  'task-146': {
    columns: ['team', 'resolved_ratio', 'ratio_state'],
    values: [['A', 0.8, 'calculated'], ['B', null, 'no-denominator'], ['C', 0, 'calculated']]
  },
  'task-147': {
    columns: ['service', 'total_rows', 'known_rows', 'missing_rows', 'known_average'],
    values: [['LMS', 3, 1, 2, 60], ['VPN', 3, 2, 1, 60]]
  },
  'task-148': {
    columns: ['task_id', 'title', 'due_at'],
    values: [
      [4, 'D', '2026-08-03'],
      [2, 'B', '2026-08-05'],
      [3, 'C', '2026-08-05'],
      [1, 'A', null],
      [5, 'E', null]
    ]
  },
  'task-149': {
    columns: ['customer_id', 'name', 'channel', 'preference_state'],
    values: [
      [1, 'Ann', 'email', 'channel-selected'],
      [2, 'Bob', null, 'preference-without-channel'],
      [3, 'Cara', null, 'no-preference-row']
    ]
  },
  'task-150': {
    columns: ['stored_null_rows', 'not_null_enforced', 'contract_evidence'],
    values: [[1, 0, 'check-accepted-unknown']]
  }
};

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(currentDirectory, '..');
const SQL = await initSqlJs({
  locateFile: file => path.join(projectRoot, 'node_modules', 'sql.js', 'dist', file)
});

for (const task of moduleTasks) {
  const database = new SQL.Database();
  try {
    const result = database.exec(task.solution);
    assert.equal(result.length, 1, `${task.id}: expected exactly one observable result set`);
    const expectation = expectedResults[task.id];
    assert.ok(expectation, `${task.id}: missing exact semantic expectation`);
    assert.deepEqual(result[0].columns, [...expectation.columns], `${task.id}: result columns drifted`);
    assert.deepEqual(result[0].values, expectation.values.map(row => [...row]), `${task.id}: NULL semantics drifted`);
  } finally {
    database.close();
  }
}

console.log('Authored NULL logic validated: ten distinct contracts with exact TRUE/FALSE/UNKNOWN, filtering, anti-join, comparison, fallback, aggregate, ordering, join-presence and schema result evidence.');
