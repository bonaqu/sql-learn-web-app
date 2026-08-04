import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import initSqlJs from 'sql.js';
import {
  advancedJoinsAuthoredTaskEvidence,
  advancedJoinsAuthoredTaskIds
} from '../src/data/advanced-authored-joins';
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

const expectedIds = Array.from({ length: 10 }, (_, index) => `task-${161 + index}`);
assert.deepEqual(
  [...advancedJoinsAuthoredTaskIds].sort((left, right) => taskNumber(left) - taskNumber(right)),
  expectedIds,
  'Advanced-joins authored identity must remain task-161 through task-170'
);
assert.deepEqual(
  Object.keys(advancedJoinsAuthoredTaskEvidence).sort((left, right) => taskNumber(left) - taskNumber(right)),
  expectedIds,
  'Every authored advanced-joins task needs explicit evidence tags'
);

const moduleTasks = tasks
  .filter(task => task.module === 'advanced-joins')
  .sort((left, right) => taskNumber(left.id) - taskNumber(right.id));
assert.deepEqual(moduleTasks.map(task => task.id), expectedIds, 'Advanced-joins persisted task identity drifted');
assert.deepEqual(
  moduleTasks.map(task => task.mode),
  [...advancedLessonTaskModePattern, ...advancedLessonTaskModePattern],
  'Advanced joins must preserve two complete lesson/practice/transfer blocks'
);
assert.equal(
  new Set(moduleTasks.map(task => baseTransferTitle(task.title))).size,
  10,
  'Advanced-joins titles must describe ten distinct cardinality decisions'
);
assert.ok(
  moduleTasks.every(task => !/[·#]\s*\d+$/u.test(baseTransferTitle(task.title))),
  'Advanced-joins titles cannot use numeric suffixes as their primary distinction'
);
assert.equal(
  new Set(moduleTasks.map(task => normalizedSolutionFingerprint(task.solution))).size,
  10,
  'Advanced-joins tasks collapsed to repeated SQL skeletons after literal normalization'
);

const evidence = new Set(Object.values(advancedJoinsAuthoredTaskEvidence).flat());
for (const required of [
  'semi-join',
  'anti-join',
  'one-row-per-left',
  'pre-aggregation',
  'many-to-many-control',
  'relational-division',
  'exact-set-division',
  'self-join',
  'symmetric-pair-deduplication',
  'orphan-reconciliation',
  'full-outer-simulation',
  'latest-related-row',
  'as-of-join',
  'fanout-audit',
  'cardinality-proof'
]) {
  assert.ok(evidence.has(required as never), `Advanced-joins ladder lost evidence: ${required}`);
}

for (const task of moduleTasks) {
  const taskEvidence = advancedJoinsAuthoredTaskEvidence[task.id];
  assert.ok(taskEvidence && taskEvidence.length >= 2, `${task.id}: expected at least two join evidence dimensions`);
  assert.ok(task.description.length >= 145, `${task.id}: join reasoning contract is too thin`);
  assert.ok(task.solution.includes('SELECT'), `${task.id}: task lacks observable result evidence`);
}

const requiredSqlMarkers: Readonly<Record<string, readonly string[]>> = {
  'task-161': ['WHERE EXISTS', 't.customer_id = c.customer_id', 'open_ticket_count'],
  'task-162': ['WHERE NOT EXISTS', "x.status <> 'Closed' OR x.status IS NULL"],
  'task-163': ['minutes_per_ticket AS', 'tags_per_ticket AS', 'LEFT JOIN minutes_per_ticket', 'LEFT JOIN tags_per_ticket'],
  'task-164': ['NOT EXISTS (SELECT 1 FROM required_skills', 'WHERE NOT EXISTS (SELECT 1 FROM engineer_skills'],
  'task-165': ['required_channels r WHERE NOT EXISTS', 'AND NOT EXISTS (SELECT 1 FROM team_channels tc'],
  'task-166': ['JOIN pair_engineers b', 'a.engineer_id < b.engineer_id'],
  'task-167': ["'account-without-profile'", "'profile-without-account'", 'UNION ALL'],
  'task-168': ['ROW_NUMBER() OVER', 'event_at DESC, event_id DESC', 'r.rn = 1'],
  'task-169': ['h.effective_at <= i.occurred_at', 'PARTITION BY i.incident_id', 'WHERE rn = 1'],
  'task-170': ['COUNT(DISTINCT account_id)', 'fanout_excess', 'max_rows_per_account']
};

for (const task of moduleTasks) {
  for (const marker of requiredSqlMarkers[task.id] || []) {
    assert.ok(task.solution.includes(marker), `${task.id}: missing advanced-join proof marker ${marker}`);
  }
}

assert.equal(
  moduleTasks.filter(task => /\bSELECT\s+DISTINCT\b/i.test(task.solution)).length,
  0,
  'Advanced joins must not hide cardinality defects behind SELECT DISTINCT'
);

const transferTasks = moduleTasks.filter(task => task.mode === 'interview' || task.mode === 'puzzle');
assert.equal(transferTasks.length, 4, 'Advanced joins must retain two Interview and two Puzzle transfer tasks');
for (const task of transferTasks) {
  assert.ok(task.starter.includes('--'), `${task.id}: transfer task lost its blank-editor reasoning contract`);
}

const expectedResults: Readonly<Record<string, {
  columns: readonly string[];
  values: readonly (readonly (string | number | null)[])[];
}>> = {
  'task-161': {
    columns: ['customer_id', 'name', 'open_ticket_count'],
    values: [[1, 'Ann', 2], [3, 'Cara', 1]]
  },
  'task-162': {
    columns: ['customer_id', 'name', 'case_count'],
    values: [[1, 'Ann', 1], [4, 'Dan', 0]]
  },
  'task-163': {
    columns: ['ticket_id', 'service', 'total_minutes', 'tag_count'],
    values: [[1, 'VPN', 30, 2], [2, 'LMS', 5, 1], [3, 'VDI', 0, 1]]
  },
  'task-164': {
    columns: ['engineer_id', 'name', 'matched_required_count'],
    values: [[1, 'Ana', 3], [3, 'Cara', 3]]
  },
  'task-165': {
    columns: ['team_id', 'name', 'channel_count'],
    values: [[1, 'Alpha', 2]]
  },
  'task-166': {
    columns: ['team', 'left_id', 'right_id'],
    values: [['A', 1, 2], ['A', 1, 3], ['A', 2, 3], ['B', 4, 5]]
  },
  'task-167': {
    columns: ['gap_type', 'entity_id', 'gap_count'],
    values: [['account-without-profile', 2, 2], ['profile-without-account', 4, 2]]
  },
  'task-168': {
    columns: ['ticket_id', 'service', 'event_id', 'state'],
    values: [[1, 'VPN', 2, 'Assigned'], [2, 'LMS', 5, 'Reopened'], [3, 'VDI', null, null]]
  },
  'task-169': {
    columns: ['incident_id', 'service', 'owner', 'effective_at'],
    values: [
      [1, 'VPN', 'Alice', '2026-07-01T00:00:00Z'],
      [2, 'VPN', 'Bob', '2026-08-02T00:00:00Z'],
      [3, 'LMS', 'Cara', '2026-08-01T00:00:00Z'],
      [4, 'VDI', null, null]
    ]
  },
  'task-170': {
    columns: ['left_rows', 'joined_rows', 'distinct_left_rows', 'fanout_excess', 'max_rows_per_account'],
    values: [[3, 6, 3, 3, 4]]
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
    assert.ok(expectation, `${task.id}: missing exact join expectation`);
    assert.deepEqual(result[0].columns, [...expectation.columns], `${task.id}: result columns drifted`);
    assert.deepEqual(result[0].values, expectation.values.map(row => [...row]), `${task.id}: join cardinality semantics drifted`);
  } finally {
    database.close();
  }
}

console.log('Authored advanced joins validated: ten distinct semi, anti, pre-aggregation, division, self-pair, orphan, latest, as-of and fan-out contracts with exact result evidence.');
