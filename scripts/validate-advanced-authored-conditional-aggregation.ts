import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import initSqlJs from 'sql.js';
import {
  advancedConditionalAggregationTaskOverride,
  conditionalAggregationAuthoredTaskEvidence,
  conditionalAggregationAuthoredTaskIds
} from '../src/data/advanced-authored-conditional-aggregation';
import { advancedLessonTaskModePattern } from '../src/data/advanced-task-progression';
import { tasks } from '../src/data/course-catalog';
import { syntaxFrontierTaskOverride } from '../src/data/syntax-frontier-content';

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

const expectedIds = Array.from({ length: 10 }, (_, index) => `task-${151 + index}`);
assert.deepEqual(
  [...conditionalAggregationAuthoredTaskIds].sort((left, right) => taskNumber(left) - taskNumber(right)),
  expectedIds,
  'Conditional-aggregation authored identity must remain task-151 through task-160'
);
assert.deepEqual(
  Object.keys(conditionalAggregationAuthoredTaskEvidence).sort((left, right) => taskNumber(left) - taskNumber(right)),
  expectedIds,
  'Every authored conditional-aggregation task needs explicit evidence tags'
);

const moduleTasks = tasks
  .filter(task => task.module === 'conditional-aggregation')
  .sort((left, right) => taskNumber(left.id) - taskNumber(right.id));
assert.deepEqual(moduleTasks.map(task => task.id), expectedIds, 'Conditional-aggregation persisted task identity drifted');
assert.deepEqual(
  moduleTasks.map(task => task.mode),
  [...advancedLessonTaskModePattern, ...advancedLessonTaskModePattern],
  'Conditional aggregation must preserve two complete lesson/practice/transfer blocks'
);
assert.equal(
  new Set(moduleTasks.map(task => baseTransferTitle(task.title))).size,
  10,
  'Conditional-aggregation titles must describe ten distinct metric decisions'
);
assert.ok(
  moduleTasks.every(task => !/[·#]\s*\d+$/u.test(baseTransferTitle(task.title))),
  'Conditional-aggregation titles cannot use numeric suffixes as their primary distinction'
);
assert.equal(
  new Set(moduleTasks.map(task => normalizedSolutionFingerprint(task.solution))).size,
  10,
  'Conditional-aggregation tasks collapsed to repeated SQL skeletons after literal normalization'
);

const authoredFoundation = advancedConditionalAggregationTaskOverride('task-151');
const syntaxFoundation = syntaxFrontierTaskOverride('task-151');
const finalFoundation = moduleTasks.find(task => task.id === 'task-151');
assert.ok(authoredFoundation, 'Canonical authored conditional-aggregation foundation is missing');
assert.ok(syntaxFoundation, 'Syntax frontier no longer owns the conditional-aggregation foundation boundary');
assert.ok(finalFoundation, 'Final conditional-aggregation foundation task is missing');
assert.deepEqual(syntaxFoundation, authoredFoundation, 'Syntax frontier duplicated or mutated the authored conditional-aggregation foundation');
assert.deepEqual(
  {
    title: finalFoundation.title,
    description: finalFoundation.description,
    starter: finalFoundation.starter,
    solution: finalFoundation.solution,
    hints: finalFoundation.hints
  },
  authoredFoundation,
  'Final task-151 drifted from the single canonical authored/syntax-frontier contract'
);

const evidence = new Set(Object.values(conditionalAggregationAuthoredTaskEvidence).flat());
for (const required of [
  'aggregate-filter',
  'shared-source-set',
  'exclusive-buckets',
  'reconciliation',
  'overlapping-cohorts',
  'intersection',
  'denominator-policy',
  'zero-denominator',
  'entity-grain',
  'conditional-distinct',
  'unknown-measure',
  'missingness-count',
  'weighted-average',
  'effective-weight',
  'cohort-conversion',
  'user-level-flags',
  'boundary-buckets',
  'control-total'
]) {
  assert.ok(evidence.has(required as never), `Conditional-aggregation ladder lost evidence: ${required}`);
}

for (const task of moduleTasks) {
  const taskEvidence = conditionalAggregationAuthoredTaskEvidence[task.id];
  assert.ok(taskEvidence && taskEvidence.length >= 2, `${task.id}: expected at least two metric evidence dimensions`);
  assert.ok(task.description.length >= 145, `${task.id}: metric reasoning contract is too thin`);
  assert.ok(task.solution.includes('SELECT'), `${task.id}: task lacks observable result evidence`);
}

const requiredSqlMarkers: Readonly<Record<string, readonly string[]>> = {
  'task-151': [
    "COUNT(*) FILTER (WHERE priority = 'Critical')",
    "COUNT(*) FILTER (WHERE status = 'Closed')"
  ],
  'task-152': ['status IS NULL', 'reconciliation_gap'],
  'task-153': ['is_critical = 1 AND is_breached = 1', 'either_count', 'naive_sum'],
  'task-154': ['eligible = 1 AND resolved = 1', 'NULLIF(SUM(eligible), 0)'],
  'task-155': [
    "COUNT(DISTINCT CASE WHEN event_type = 'resolved' THEN customer_id END)",
    'resolved_events'
  ],
  'task-156': ['COUNT(amount) FILTER', 'amount IS NULL', 'display_approved_amount'],
  'task-157': ['score IS NOT NULL THEN weight', 'effective_weight', 'NULLIF'],
  'task-158': ['GROUP BY cohort, user_id', 'orphan_purchase_users', 'conversion_rate'],
  'task-159': ['resolution_minutes <= 60', 'resolution_minutes > 60 AND resolution_minutes <= 90', 'resolution_minutes > 90', 'reconciliation_gap'],
  'task-160': ['WITH per_service AS', "UNION ALL SELECT 'ALL'", 'reconciliation_gap']
};

for (const task of moduleTasks) {
  for (const marker of requiredSqlMarkers[task.id] || []) {
    assert.ok(task.solution.includes(marker), `${task.id}: missing conditional-aggregation proof marker ${marker}`);
  }
}

const transferTasks = moduleTasks.filter(task => task.mode === 'interview' || task.mode === 'puzzle');
assert.equal(transferTasks.length, 4, 'Conditional aggregation must retain two Interview and two Puzzle transfer tasks');
for (const task of transferTasks) {
  assert.ok(task.starter.includes('--'), `${task.id}: transfer task lost its blank-editor reasoning contract`);
}

const expectedResults: Readonly<Record<string, {
  columns: readonly string[];
  values: readonly (readonly (string | number | null)[])[];
}>> = {
  'task-151': {
    columns: ['service', 'total_count', 'critical_count', 'closed_count'],
    values: [['LMS', 3, 2, 1], ['VPN', 3, 2, 2]]
  },
  'task-152': {
    columns: ['service', 'total_count', 'open_count', 'closed_count', 'pending_count', 'unknown_count', 'reconciliation_gap'],
    values: [['LMS', 4, 2, 1, 0, 1, 0], ['VPN', 4, 1, 1, 1, 1, 0]]
  },
  'task-153': {
    columns: ['total_count', 'critical_count', 'breached_count', 'both_count', 'either_count', 'naive_sum'],
    values: [[5, 3, 3, 2, 4, 6]]
  },
  'task-154': {
    columns: ['channel', 'eligible_count', 'resolved_eligible_count', 'resolved_rate'],
    values: [['chat', 0, 0, null], ['email', 2, 1, 50], ['web', 2, 0, 0]]
  },
  'task-155': {
    columns: ['event_rows', 'unique_customers', 'resolved_customers', 'resolved_events'],
    values: [[7, 4, 2, 3]]
  },
  'task-156': {
    columns: ['team', 'approved_rows', 'known_approved_amounts', 'approved_amount', 'missing_approved_amounts', 'display_approved_amount'],
    values: [['A', 2, 1, 100, 1, 100], ['B', 1, 0, null, 1, 0], ['C', 0, 0, null, 0, 0]]
  },
  'task-157': {
    columns: ['team', 'total_rows', 'known_rows', 'effective_weight', 'weighted_average'],
    values: [['A', 2, 2, 3, 86.667], ['B', 2, 2, 0, null], ['C', 2, 1, 1, 70]]
  },
  'task-158': {
    columns: ['cohort', 'eligible_users', 'converted_users', 'orphan_purchase_users', 'conversion_rate'],
    values: [['A', 2, 1, 1, 50], ['B', 3, 2, 0, 66.7]]
  },
  'task-159': {
    columns: ['total_count', 'on_time_count', 'near_breach_count', 'breached_count', 'missing_count', 'reconciliation_gap'],
    values: [[7, 2, 2, 2, 1, 0]]
  },
  'task-160': {
    columns: ['service', 'total_count', 'closed_count', 'active_count', 'reconciliation_gap'],
    values: [['LMS', 2, 0, 2, 0], ['VDI', 1, 1, 0, 0], ['VPN', 3, 2, 1, 0], ['ALL', 6, 3, 3, 0]]
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
    assert.ok(expectation, `${task.id}: missing exact metric expectation`);
    assert.deepEqual(result[0].columns, [...expectation.columns], `${task.id}: result columns drifted`);
    assert.deepEqual(result[0].values, expectation.values.map(row => [...row]), `${task.id}: metric semantics drifted`);
  } finally {
    database.close();
  }
}

console.log('Authored conditional aggregation validated: ten distinct contracts with exact FILTER, bucket, overlap, denominator, entity-grain, missingness, weighted, cohort, boundary and control-total result evidence.');
