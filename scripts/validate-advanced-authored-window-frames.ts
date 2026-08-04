import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import initSqlJs from 'sql.js';
import {
  windowFramesAuthoredTaskEvidence,
  windowFramesAuthoredTaskIds
} from '../src/data/advanced-authored-window-frames';
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

const expectedIds = Array.from({ length: 10 }, (_, index) => `task-${181 + index}`);
assert.deepEqual(
  [...windowFramesAuthoredTaskIds].sort((left, right) => taskNumber(left) - taskNumber(right)),
  expectedIds,
  'Window-frames authored identity must remain task-181 through task-190'
);
assert.deepEqual(
  Object.keys(windowFramesAuthoredTaskEvidence).sort((left, right) => taskNumber(left) - taskNumber(right)),
  expectedIds,
  'Every authored window-frame task needs explicit evidence tags'
);

const moduleTasks = tasks
  .filter(task => task.module === 'window-frames')
  .sort((left, right) => taskNumber(left.id) - taskNumber(right.id));
assert.deepEqual(moduleTasks.map(task => task.id), expectedIds, 'Window-frames persisted task identity drifted');
assert.deepEqual(
  moduleTasks.map(task => task.mode),
  [...advancedLessonTaskModePattern, ...advancedLessonTaskModePattern],
  'Window frames must preserve two complete lesson/practice/transfer blocks'
);
assert.equal(new Set(moduleTasks.map(task => baseTransferTitle(task.title))).size, 10, 'Window-frame titles must describe ten distinct decisions');
assert.ok(moduleTasks.every(task => !/[·#]\s*\d+$/u.test(baseTransferTitle(task.title))), 'Window-frame titles cannot rely on numeric suffixes');
assert.equal(new Set(moduleTasks.map(task => normalizedSolutionFingerprint(task.solution))).size, 10, 'Window-frame tasks collapsed to repeated SQL skeletons');

const evidence = new Set(Object.values(windowFramesAuthoredTaskEvidence).flat());
for (const required of [
  'running-total', 'deterministic-order', 'rows-frame', 'range-frame', 'peer-groups',
  'rolling-average', 'centered-window', 'lag-delta', 'gaps-and-islands', 'sessionization',
  'cumulative-distinct', 'ranking-ties', 'last-value-frame', 'unbounded-following'
]) assert.ok(evidence.has(required as never), `Window-frame ladder lost evidence: ${required}`);

for (const task of moduleTasks) {
  const taskEvidence = windowFramesAuthoredTaskEvidence[task.id];
  assert.ok(taskEvidence && taskEvidence.length >= 2, `${task.id}: expected at least two window evidence dimensions`);
  assert.ok(task.description.length >= 145, `${task.id}: window reasoning contract is too thin`);
  assert.ok(task.solution.includes('SELECT'), `${task.id}: task lacks observable result evidence`);
}

const requiredSqlMarkers: Readonly<Record<string, readonly string[]>> = {
  'task-181': ['ORDER BY event_at, event_id ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW'],
  'task-182': ['ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW', 'RANGE BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW'],
  'task-183': ['ROWS BETWEEN 2 PRECEDING AND CURRENT ROW'],
  'task-184': ['ROWS BETWEEN 1 PRECEDING AND 1 FOLLOWING', 'frame_rows'],
  'task-185': ['LAG(value)', "previous_value IS NULL THEN 'baseline'"],
  'task-186': ['ROW_NUMBER() OVER', "printf('-%d days', rn)", 'island_key'],
  'task-187': ['julianday(event_at)', '> 30', 'SUM(new_session) OVER'],
  'task-188': ['PARTITION BY customer_id', 'first_occurrence', 'cumulative_unique'],
  'task-189': ['ROW_NUMBER() OVER', 'RANK() OVER', 'DENSE_RANK() OVER'],
  'task-190': ['CURRENT ROW) AS last_so_far', 'UNBOUNDED FOLLOWING) AS partition_last']
};
for (const task of moduleTasks) for (const marker of requiredSqlMarkers[task.id] || []) assert.ok(task.solution.includes(marker), `${task.id}: missing window proof marker ${marker}`);

const transferTasks = moduleTasks.filter(task => task.mode === 'interview' || task.mode === 'puzzle');
assert.equal(transferTasks.length, 4, 'Window frames must retain two Interview and two Puzzle tasks');
for (const task of transferTasks) assert.ok(task.starter.includes('--'), `${task.id}: transfer task lost blank-editor framing`);

const expectedResults: Readonly<Record<string, { columns: readonly string[]; values: readonly (readonly (string | number | null)[])[] }>> = {
  'task-181': {
    columns: ['event_id', 'service', 'event_at', 'amount', 'running_amount'],
    values: [
      [4, 'LMS', '2026-08-01T09:00:00Z', 7, 7], [5, 'LMS', '2026-08-01T10:00:00Z', 3, 10],
      [1, 'VPN', '2026-08-01T10:00:00Z', 10, 10], [2, 'VPN', '2026-08-01T10:00:00Z', 20, 30], [3, 'VPN', '2026-08-01T11:00:00Z', 5, 35]
    ]
  },
  'task-182': { columns: ['row_id', 'sort_key', 'amount', 'rows_running', 'range_running'], values: [[1, 1, 10, 10, 30], [2, 1, 20, 30, 30], [3, 2, 5, 35, 35]] },
  'task-183': {
    columns: ['team', 'metric_date', 'value', 'rolling_average'],
    values: [['A', '2026-08-01', 10, 10], ['A', '2026-08-02', 20, 15], ['A', '2026-08-03', 30, 20], ['A', '2026-08-04', 40, 30], ['B', '2026-08-01', 5, 5], ['B', '2026-08-02', 15, 10]]
  },
  'task-184': { columns: ['point_id', 'position', 'value', 'frame_rows', 'centered_average'], values: [[1, 1, 10, 2, 15], [2, 2, 20, 3, 26.667], [3, 3, 50, 3, 56.667], [4, 4, 100, 2, 75]] },
  'task-185': {
    columns: ['snapshot_id', 'service', 'snapshot_at', 'value', 'previous_value', 'delta', 'change_state'],
    values: [[4, 'LMS', '2026-08-01', 50, null, null, 'baseline'], [5, 'LMS', '2026-08-02', 70, 50, 20, 'increase'], [1, 'VPN', '2026-08-01', 100, null, null, 'baseline'], [2, 'VPN', '2026-08-02', 130, 100, 30, 'increase'], [3, 'VPN', '2026-08-03', 125, 130, -5, 'decrease']]
  },
  'task-186': {
    columns: ['user_id', 'island_start', 'island_end', 'island_days'],
    values: [['A', '2026-08-01', '2026-08-02', 2], ['A', '2026-08-04', '2026-08-06', 3], ['B', '2026-08-02', '2026-08-02', 1], ['B', '2026-08-04', '2026-08-04', 1]]
  },
  'task-187': {
    columns: ['user_id', 'session_number', 'session_start', 'session_end', 'event_count'],
    values: [['A', 1, '2026-08-01T10:00:00Z', '2026-08-01T10:10:00Z', 2], ['A', 2, '2026-08-01T11:00:00Z', '2026-08-01T11:20:00Z', 2], ['B', 1, '2026-08-01T09:00:00Z', '2026-08-01T09:00:00Z', 1], ['B', 2, '2026-08-01T09:45:00Z', '2026-08-01T09:45:00Z', 1]]
  },
  'task-188': { columns: ['event_id', 'customer_id', 'first_occurrence', 'cumulative_unique'], values: [[1, 1, 1, 1], [2, 2, 1, 2], [3, 1, 0, 2], [4, 3, 1, 3], [5, 2, 0, 3]] },
  'task-189': { columns: ['player_id', 'player', 'score', 'row_number_position', 'rank_position', 'dense_rank_position'], values: [[1, 'Ann', 100, 1, 1, 1], [2, 'Bob', 90, 2, 2, 2], [3, 'Cara', 90, 3, 2, 2], [4, 'Dan', 80, 4, 4, 3]] },
  'task-190': { columns: ['event_id', 'account', 'event_at', 'value', 'last_so_far', 'partition_last'], values: [[1, 'A', '2026-08-01', 10, 10, 30], [2, 'A', '2026-08-02', 20, 20, 30], [3, 'A', '2026-08-03', 30, 30, 30], [4, 'B', '2026-08-01', 5, 5, 15], [5, 'B', '2026-08-02', 15, 15, 15]] }
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
    assert.deepEqual(result[0].values, expectation.values.map(row => [...row]), `${task.id}: window semantics drifted`);
  } finally { database.close(); }
}

console.log('Authored window frames validated: exact running, peer, rolling, centered, delta, island, session, cumulative-distinct, ranking and LAST_VALUE outputs.');
