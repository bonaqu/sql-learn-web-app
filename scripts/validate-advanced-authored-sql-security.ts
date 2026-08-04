import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import initSqlJs from 'sql.js';
import {
  advancedSqlSecurityTaskOverride,
  sqlSecurityAuthoredTaskEvidence
} from '../src/data/advanced-authored-sql-security';
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

const expectedIds = Array.from({ length: 10 }, (_, index) => `task-${201 + index}`);
assert.deepEqual(
  Object.keys(sqlSecurityAuthoredTaskEvidence).sort((left, right) => taskNumber(left) - taskNumber(right)),
  expectedIds,
  'Every authored SQL security task needs explicit evidence tags'
);

const moduleTasks = tasks
  .filter(task => task.module === 'sql-security')
  .sort((left, right) => taskNumber(left.id) - taskNumber(right.id));
assert.deepEqual(moduleTasks.map(task => task.id), expectedIds, 'SQL security persisted task identity drifted');
assert.deepEqual(
  moduleTasks.map(task => task.mode),
  [...advancedLessonTaskModePattern, ...advancedLessonTaskModePattern],
  'SQL security must preserve two complete lesson/practice/transfer blocks'
);
assert.equal(new Set(moduleTasks.map(task => baseTransferTitle(task.title))).size, 10, 'SQL security titles must describe ten distinct decisions');
assert.ok(moduleTasks.every(task => !/[·#]\s*\d+$/u.test(baseTransferTitle(task.title))), 'SQL security titles cannot rely on numeric suffixes');
assert.equal(new Set(moduleTasks.map(task => normalizedSolutionFingerprint(task.solution))).size, 10, 'SQL security tasks collapsed to repeated SQL skeletons');

const evidence = new Set(Object.values(sqlSecurityAuthoredTaskEvidence).flat());
for (const required of [
  'value-binding', 'fixed-query-shape', 'injection-payload', 'identifier-whitelist', 'deny-by-default',
  'tenant-isolation', 'result-scope', 'least-privilege', 'permission-matrix', 'redacted-logging',
  'secret-minimization', 'dynamic-sql-review', 'unsafe-concatenation', 'sensitive-column-policy',
  'ownership-authorization', 'explicit-grant', 'log-audit', 'secret-detection',
  'decision-reconciliation', 'fail-closed-order'
]) assert.ok(evidence.has(required as never), `SQL security ladder lost evidence: ${required}`);

for (const task of moduleTasks) {
  const taskEvidence = sqlSecurityAuthoredTaskEvidence[task.id];
  const authored = advancedSqlSecurityTaskOverride(task.id);
  assert.ok(taskEvidence && taskEvidence.length >= 2, `${task.id}: expected at least two security evidence dimensions`);
  assert.ok(authored, `${task.id}: canonical authored SQL security source is missing`);
  assert.equal(task.solution, authored?.solution, `${task.id}: progression overlays changed the canonical security solution`);
  assert.ok(task.description.length >= 145, `${task.id}: security reasoning contract is too thin`);
  assert.ok(task.solution.includes('SELECT'), `${task.id}: task lacks observable result evidence`);
}

const requiredSqlMarkers: Readonly<Record<string, readonly string[]>> = {
  'task-201': ['a.username = rv.input_text', 'COUNT(a.account_id) AS matched_accounts', "''' OR 1=1 --'"],
  'task-202': ['allowed_sort_keys', 'a.sort_key = r.requested_key', "ELSE 'rejected'"],
  'task-203': ['t.tenant_id = r.tenant_id', 'cross_tenant_rows'],
  'task-204': ["p.permission = 'read'", "p.permission = 'write'", "p.permission = 'admin'"],
  'task-205': ["'***@'", "'token-length:' || length(api_token)", 'raw_email_leak', 'raw_token_leak'],
  'task-206': ["construction_mode IN ('bound-value','static')", "'unsafe-value-concat'", "'unsafe-identifier'"],
  'task-207': ['allowed_export_columns', 'password_hash', 'accepted_columns', 'rejected_columns'],
  'task-208': ['r.owner_id = q.actor_id', 'EXISTS (SELECT 1 FROM resource_grants', "ELSE 'denied'"],
  'task-209': ["LIKE '%password = ''%'", "LIKE '%api_token = ''%'", 'risky_log_ids'],
  'task-210': ["authenticated = 0", "tenant_match = 0", "permission_granted = 0", "identifier_whitelisted = 0", 'reconciliation_gap']
};
for (const task of moduleTasks) {
  for (const marker of requiredSqlMarkers[task.id] || []) {
    assert.ok(task.solution.includes(marker), `${task.id}: missing security proof marker ${marker}`);
  }
}

assert.ok(!moduleTasks[0].solution.includes('EXECUTE'), 'Value-binding task must not execute generated SQL');
assert.ok(!moduleTasks[0].solution.includes('eval'), 'Value-binding task must keep input as data');
assert.ok(!moduleTasks[1].solution.includes('DROP TABLE tickets; SELECT'), 'Identifier-whitelist task must not execute the rejected identifier');

const transferTasks = moduleTasks.filter(task => task.mode === 'interview' || task.mode === 'puzzle');
assert.equal(transferTasks.length, 4, 'SQL security must retain two Interview and two Puzzle tasks');
for (const task of transferTasks) assert.ok(task.starter.includes('--'), `${task.id}: transfer task lost blank-editor framing`);

type ExpectedResult = {
  columns: readonly string[];
  values: readonly (readonly (string | number | null)[])[];
};

const expectedResults: Readonly<Record<string, ExpectedResult>> = {
  'task-201': {
    columns: ['request_id', 'input_text', 'matched_accounts'],
    values: [[1, 'alice', 1], [2, "' OR 1=1 --", 0]]
  },
  'task-202': {
    columns: ['request_id', 'requested_key', 'safe_expression', 'decision'],
    values: [
      [1, 'created_at', 'created_at, ticket_id', 'allowed'],
      [2, 'priority', 'priority_rank, ticket_id', 'allowed'],
      [3, 'priority; DROP TABLE tickets', null, 'rejected']
    ]
  },
  'task-203': {
    columns: ['request_id', 'visible_count', 'cross_tenant_rows'],
    values: [[1, 2, 0], [2, 1, 0]]
  },
  'task-204': {
    columns: ['user_id', 'username', 'can_read', 'can_write', 'can_admin'],
    values: [[1, 'viewer', 1, 0, 0], [2, 'operator', 1, 1, 0], [3, 'owner', 1, 1, 1], [4, 'unassigned', 0, 0, 0]]
  },
  'task-205': {
    columns: ['request_id', 'safe_log', 'raw_email_leak', 'raw_token_leak'],
    values: [
      [1, 'request=1;email=a***@example.com;token=token-length:15;outcome=allowed', 0, 0],
      [2, 'request=2;email=b***@corp.test;token=token-length:15;outcome=denied', 0, 0]
    ]
  },
  'task-206': {
    columns: ['sample_id', 'construction_mode', 'review_state'],
    values: [[1, 'bound-value', 'safe'], [2, 'value-concat', 'unsafe-value-concat'], [3, 'raw-identifier', 'unsafe-identifier'], [4, 'static', 'safe']]
  },
  'task-207': {
    columns: ['request_id', 'accepted_columns', 'rejected_columns', 'decision'],
    values: [[1, 'account_id,display_name', 'password_hash', 'rejected'], [2, 'status', null, 'allowed']]
  },
  'task-208': {
    columns: ['request_id', 'access_reason'],
    values: [[1, 'owner'], [2, 'explicit-grant'], [3, 'denied'], [4, 'denied']]
  },
  'task-209': {
    columns: ['total_logs', 'risky_logs', 'risky_log_ids', 'safe_logs'],
    values: [[4, 2, '2,3', 2]]
  },
  'task-210': {
    columns: ['total_requests', 'allowed_requests', 'unauthenticated_requests', 'tenant_mismatch_requests', 'permission_denied_requests', 'identifier_rejected_requests', 'reconciliation_gap'],
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
    assert.deepEqual(result[0].values, expectation.values.map(row => [...row]), `${task.id}: security semantics drifted`);
  } finally {
    database.close();
  }
}

console.log('Authored SQL security validated: exact binding, allowlist, tenant, privilege, redaction, review, authorization, log-audit and fail-closed outputs.');
