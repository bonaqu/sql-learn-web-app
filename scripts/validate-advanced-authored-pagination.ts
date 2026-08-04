import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import initSqlJs from 'sql.js';
import {
  advancedPaginationTaskOverride,
  paginationAuthoredTaskEvidence
} from '../src/data/advanced-authored-pagination';
import { advancedLessonTaskModePattern } from '../src/data/advanced-task-progression';
import { tasks } from '../src/data/course-catalog';

function taskNumber(taskId: string) { return Number(taskId.replace(/^task-/, '')); }
function baseTransferTitle(title: string) { return title.replace(/^(?:Interview|Puzzle)\s*[·:]\s*/i, '').trim(); }
function normalizedSolutionFingerprint(solution: string) {
  return solution.toLowerCase().replace(/'(?:''|[^'])*'/g, '?').replace(/\b\d+(?:\.\d+)?\b/g, '#').replace(/\s+/g, ' ').trim();
}

const expectedIds = Array.from({ length: 10 }, (_, index) => `task-${221 + index}`);
assert.deepEqual(Object.keys(paginationAuthoredTaskEvidence).sort((a,b) => taskNumber(a)-taskNumber(b)), expectedIds, 'Every Pagination task needs evidence tags');
const moduleTasks = tasks.filter(task => task.module === 'pagination-patterns').sort((a,b) => taskNumber(a.id)-taskNumber(b.id));
assert.deepEqual(moduleTasks.map(task => task.id), expectedIds, 'Pagination persisted task identity drifted');
assert.deepEqual(moduleTasks.map(task => task.mode), [...advancedLessonTaskModePattern, ...advancedLessonTaskModePattern], 'Pagination mode pattern drifted');
assert.equal(new Set(moduleTasks.map(task => baseTransferTitle(task.title))).size, 10, 'Pagination needs ten distinct titles');
assert.ok(moduleTasks.every(task => !/[·#]\s*\d+$/u.test(baseTransferTitle(task.title))), 'Pagination titles cannot rely on numeric suffixes');
assert.equal(new Set(moduleTasks.map(task => normalizedSolutionFingerprint(task.solution))).size, 10, 'Pagination collapsed to repeated SQL skeletons');

const evidence = new Set(Object.values(paginationAuthoredTaskEvidence).flat());
for (const required of ['total-order','tie-breaker','cursor-materialization','forward-keyset','strict-cursor-predicate','tie-loss-counterexample','backward-keyset','reverse-then-display','concurrent-insert','offset-duplicate','descending-keyset','cursor-completeness','opaque-cursor-contract','deep-page-cost','candidate-reduction','duplicate-audit','missing-item-audit','order-audit','pagination-reconciliation']) {
  assert.ok(evidence.has(required as never), `Pagination ladder lost evidence: ${required}`);
}
for (const task of moduleTasks) {
  const authored = advancedPaginationTaskOverride(task.id);
  assert.ok(authored, `${task.id}: authored source missing`);
  assert.equal(task.solution, authored?.solution, `${task.id}: canonical solution changed`);
  assert.ok((paginationAuthoredTaskEvidence[task.id]?.length || 0) >= 2, `${task.id}: insufficient evidence dimensions`);
  assert.ok(task.description.length >= 145, `${task.id}: reasoning contract too thin`);
}

const markers: Readonly<Record<string, readonly string[]>> = {
  'task-221': ['ORDER BY created_at, event_id', 'stable_position', 'cursor_key'],
  'task-222': ['LIMIT 3', 'row_cursor'],
  'task-223': ["(created_at, event_id) > ('2026-08-01T10:00:00Z', 2)"],
  'task-224': ['timestamp_only_ids', 'composite_cursor_ids', 'rows_lost_by_tie'],
  'task-225': ["(created_at, event_id) < ('2026-08-01T05:00:00Z', 5)", 'ORDER BY created_at DESC, event_id DESC'],
  'task-226': ['OFFSET 3', 'keyset_duplicates', 'offset_duplicates'],
  'task-227': ['ORDER BY created_at DESC, event_id DESC', 'LIMIT 2'],
  'task-228': ['cursor_components', "THEN 'complete'"],
  'task-229': ['offset_rows_touched', 'keyset_candidate_rows', 'candidate_reduction'],
  'task-230': ['LAG(item_id)', 'missing_ids', 'order_violations', 'emission_reconciliation_gap']
};
for (const task of moduleTasks) for (const marker of markers[task.id] || []) assert.ok(task.solution.includes(marker), `${task.id}: missing marker ${marker}`);
const transfers = moduleTasks.filter(task => task.mode === 'interview' || task.mode === 'puzzle');
assert.equal(transfers.length, 4, 'Pagination must retain four transfers');
for (const task of transfers) assert.ok(task.starter.includes('--'), `${task.id}: transfer lost blank-editor framing`);

type ExpectedResult = { columns: readonly string[]; values: readonly (readonly (string | number | null)[])[] };
const expectedResults: Readonly<Record<string, ExpectedResult>> = {
  'task-221': { columns:['event_id','created_at','stable_position','cursor_key'], values:[[1,'2026-08-01T10:00:00Z',1,'2026-08-01T10:00:00Z#0001'],[2,'2026-08-01T10:00:00Z',2,'2026-08-01T10:00:00Z#0002'],[3,'2026-08-01T11:00:00Z',3,'2026-08-01T11:00:00Z#0003'],[4,'2026-08-01T12:00:00Z',4,'2026-08-01T12:00:00Z#0004']] },
  'task-222': { columns:['event_id','created_at','row_cursor'], values:[[1,'2026-08-01T10:00:00Z','2026-08-01T10:00:00Z#1'],[2,'2026-08-01T10:00:00Z','2026-08-01T10:00:00Z#2'],[3,'2026-08-01T11:00:00Z','2026-08-01T11:00:00Z#3']] },
  'task-223': { columns:['event_id','created_at'], values:[[3,'2026-08-01T11:00:00Z'],[4,'2026-08-01T12:00:00Z'],[5,'2026-08-01T13:00:00Z']] },
  'task-224': { columns:['timestamp_only_ids','composite_cursor_ids','rows_lost_by_tie'], values:[['4','3,4',1]] },
  'task-225': { columns:['event_id','created_at'], values:[[2,'2026-08-01T02:00:00Z'],[3,'2026-08-01T03:00:00Z'],[4,'2026-08-01T04:00:00Z']] },
  'task-226': { columns:['keyset_ids','offset_ids','keyset_duplicates','offset_duplicates'], values:[['4,5,6','3,4,5',0,1]] },
  'task-227': { columns:['event_id','created_at'], values:[[4,'2026-08-01T04:00:00Z'],[3,'2026-08-01T03:00:00Z']] },
  'task-228': { columns:['request_id','cursor_components','cursor_state'], values:[[1,2,'complete'],[2,1,'incomplete'],[3,1,'incomplete'],[4,0,'incomplete']] },
  'task-229': { columns:['offset_rows_touched','keyset_candidate_rows','returned_rows','candidate_reduction'], values:[[95,10,5,85]] },
  'task-230': { columns:['expected_items','emitted_rows','distinct_items','duplicate_rows','missing_items','missing_ids','order_violations','emission_reconciliation_gap'], values:[[6,6,5,1,1,'5',1,0]] }
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
    assert.deepEqual(result[0].values, expectation.values.map(row => [...row]), `${task.id}: pagination semantics drifted`);
  } finally { database.close(); }
}
console.log('Authored pagination validated: exact total-order, forward/backward, tie, concurrent-insert, cursor, cost and trace outputs.');
