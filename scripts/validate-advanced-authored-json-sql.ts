import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import initSqlJs from 'sql.js';
import {
  advancedJsonSqlTaskOverride,
  jsonSqlAuthoredTaskEvidence
} from '../src/data/advanced-authored-json-sql';
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

const expectedIds = Array.from({ length: 10 }, (_, index) => `task-${191 + index}`);
assert.deepEqual(
  Object.keys(jsonSqlAuthoredTaskEvidence).sort((left, right) => taskNumber(left) - taskNumber(right)),
  expectedIds,
  'Every authored JSON SQL task needs explicit evidence tags'
);

const moduleTasks = tasks
  .filter(task => task.module === 'json-sql')
  .sort((left, right) => taskNumber(left.id) - taskNumber(right.id));
assert.deepEqual(moduleTasks.map(task => task.id), expectedIds, 'JSON SQL persisted task identity drifted');
assert.deepEqual(
  moduleTasks.map(task => task.mode),
  [...advancedLessonTaskModePattern, ...advancedLessonTaskModePattern],
  'JSON SQL must preserve two complete lesson/practice/transfer blocks'
);
assert.equal(new Set(moduleTasks.map(task => baseTransferTitle(task.title))).size, 10, 'JSON SQL titles must describe ten distinct decisions');
assert.ok(moduleTasks.every(task => !/[·#]\s*\d+$/u.test(baseTransferTitle(task.title))), 'JSON SQL titles cannot rely on numeric suffixes');
assert.equal(new Set(moduleTasks.map(task => normalizedSolutionFingerprint(task.solution))).size, 10, 'JSON SQL tasks collapsed to repeated SQL skeletons');

const evidence = new Set(Object.values(jsonSqlAuthoredTaskEvidence).flat());
for (const required of [
  'json-validity', 'guarded-extraction', 'sql-null', 'missing-path', 'json-null', 'json-type',
  'typed-extraction', 'boolean-extraction', 'array-expansion', 'empty-array', 'object-expansion',
  'key-type-audit', 'safe-json-update', 'json-remove', 'json-aggregation',
  'deterministic-json-order', 'duplicate-key-audit', 'schema-version', 'required-field', 'quality-report'
]) assert.ok(evidence.has(required as never), `JSON SQL ladder lost evidence: ${required}`);

for (const task of moduleTasks) {
  const taskEvidence = jsonSqlAuthoredTaskEvidence[task.id];
  const authored = advancedJsonSqlTaskOverride(task.id);
  assert.ok(taskEvidence && taskEvidence.length >= 2, `${task.id}: expected at least two JSON evidence dimensions`);
  assert.ok(authored, `${task.id}: canonical authored JSON source is missing`);
  assert.equal(task.solution, authored?.solution, `${task.id}: progression overlays changed the canonical JSON solution`);
  assert.ok(task.description.length >= 145, `${task.id}: JSON reasoning contract is too thin`);
  assert.ok(task.solution.includes('SELECT'), `${task.id}: task lacks observable result evidence`);
}

const requiredSqlMarkers: Readonly<Record<string, readonly string[]>> = {
  'task-191': ['document IS NULL', 'json_valid(document) = 0', "'valid-' || json_type(document)"],
  'task-192': ["json_type(document, '$.value') IS NULL", "json_type(document, '$.value') = 'null'", "'value-' || json_type"],
  'task-193': ["json_extract(document, '$.count')", "json_type(document, '$.enabled')", 'json_valid(document) = 1'],
  'task-194': ["json_type(d.document, '$.tags') = 'array'", 'LEFT JOIN json_each', "'{\"tags\":[]}'"],
  'task-195': ["json_type(d.document, '$.metrics') = 'object'", 'COUNT(key) AS key_count', "type IN ('integer','real')"],
  'task-196': ['json_remove(json_set', "'$.preferences.theme'", "'$.revision'", "'$.deprecated'"],
  'task-197': ['ORDER BY service, ticket_id', 'json_group_array(ticket_id)', 'json_group_object(CAST(ticket_id AS TEXT), priority)'],
  'task-198': ['JOIN json_each(d.document)', 'COUNT(*) AS duplicate_count', "GROUP_CONCAT(value, ' > ')"],
  'task-199': ["THEN 'invalid-json'", "THEN 'unsupported-version'", "THEN 'wrong-service-type'", "ELSE 'valid-v2'"],
  'task-200': ["THEN 'missing-path'", "THEN 'json-null'", "THEN 'wrong-type'", 'reconciliation_gap']
};
for (const task of moduleTasks) {
  for (const marker of requiredSqlMarkers[task.id] || []) {
    assert.ok(task.solution.includes(marker), `${task.id}: missing JSON proof marker ${marker}`);
  }
}

const unsafeJsonCalls = moduleTasks.filter(task => {
  if (task.id === 'task-193' || task.id === 'task-197' || task.id === 'task-198') return false;
  const solution = task.solution.toLowerCase();
  return solution.includes('json_extract') && !solution.includes('json_valid');
});
assert.equal(unsafeJsonCalls.length, 0, 'JSON extraction over nullable or malformed documents must be guarded by json_valid');

const transferTasks = moduleTasks.filter(task => task.mode === 'interview' || task.mode === 'puzzle');
assert.equal(transferTasks.length, 4, 'JSON SQL must retain two Interview and two Puzzle tasks');
for (const task of transferTasks) assert.ok(task.starter.includes('--'), `${task.id}: transfer task lost blank-editor framing`);

type ExpectedResult = {
  columns: readonly string[];
  values: readonly (readonly (string | number | null)[])[];
};

const expectedResults: Readonly<Record<string, ExpectedResult>> = {
  'task-191': {
    columns: ['doc_id', 'document_state'],
    values: [[1, 'sql-null'], [2, 'invalid-json'], [3, 'valid-object'], [4, 'valid-array'], [5, 'valid-integer']]
  },
  'task-192': {
    columns: ['doc_id', 'value_state'],
    values: [[1, 'sql-null-document'], [2, 'invalid-json'], [3, 'missing-path'], [4, 'json-null'], [5, 'value-integer'], [6, 'value-text']]
  },
  'task-193': {
    columns: ['payload_id', 'count_value', 'count_type', 'label_value', 'label_type', 'enabled_value', 'enabled_type'],
    values: [[1, 3, 'integer', 'ready', 'text', 1, 'true'], [2, '3', 'text', 7, 'integer', 0, 'false']]
  },
  'task-194': {
    columns: ['doc_id', 'tag_count', 'sorted_tags'],
    values: [[1, 2, 'urgent,vpn'], [2, 0, null], [3, 0, null], [4, 0, null]]
  },
  'task-195': {
    columns: ['doc_id', 'key_count', 'numeric_keys', 'null_keys'],
    values: [[1, 3, 2, 1], [2, 0, 0, 0], [3, 0, 0, 0]]
  },
  'task-196': {
    columns: ['profile_id', 'update_state', 'theme', 'revision', 'deprecated_type'],
    values: [[1, 'updated', 'dark', 2, null], [2, 'not-updated', null, null, null]]
  },
  'task-197': {
    columns: ['service', 'ticket_ids', 'priority_by_ticket'],
    values: [
      ['LMS', '[2,4]', '{"2":"Low","4":"High"}'],
      ['VPN', '[1,3]', '{"1":"Critical","3":"High"}']
    ]
  },
  'task-198': {
    columns: ['doc_id', 'key', 'duplicate_count', 'values_seen'],
    values: [[1, 'role', 2, 'user > admin']]
  },
  'task-199': {
    columns: ['doc_id', 'contract_state'],
    values: [[1, 'invalid-json'], [2, 'unsupported-version'], [3, 'missing-service'], [4, 'wrong-service-type'], [5, 'valid-v2']]
  },
  'task-200': {
    columns: ['total_rows', 'sql_null_rows', 'invalid_rows', 'missing_rows', 'json_null_rows', 'wrong_type_rows', 'valid_number_rows', 'reconciliation_gap'],
    values: [[7, 1, 1, 1, 1, 1, 2, 0]]
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
    assert.deepEqual(result[0].values, expectation.values.map(row => [...row]), `${task.id}: JSON semantics drifted`);
  } finally {
    database.close();
  }
}

console.log('Authored JSON SQL validated: exact validity, missingness, typing, expansion, update, aggregation, duplicate-key, version and quality-report outputs.');
