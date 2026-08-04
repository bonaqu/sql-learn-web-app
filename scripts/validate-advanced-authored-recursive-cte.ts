import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import initSqlJs from 'sql.js';
import {
  recursiveCteAuthoredTaskEvidence,
  recursiveCteAuthoredTaskIds
} from '../src/data/advanced-authored-recursive-cte';
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

const expectedIds = Array.from({ length: 10 }, (_, index) => `task-${171 + index}`);
assert.deepEqual(
  [...recursiveCteAuthoredTaskIds].sort((left, right) => taskNumber(left) - taskNumber(right)),
  expectedIds,
  'Recursive-CTE authored identity must remain task-171 through task-180'
);
assert.deepEqual(
  Object.keys(recursiveCteAuthoredTaskEvidence).sort((left, right) => taskNumber(left) - taskNumber(right)),
  expectedIds,
  'Every authored recursive-CTE task needs explicit evidence tags'
);

const moduleTasks = tasks
  .filter(task => task.module === 'recursive-cte')
  .sort((left, right) => taskNumber(left.id) - taskNumber(right.id));
assert.deepEqual(moduleTasks.map(task => task.id), expectedIds, 'Recursive-CTE persisted task identity drifted');
assert.deepEqual(
  moduleTasks.map(task => task.mode),
  [...advancedLessonTaskModePattern, ...advancedLessonTaskModePattern],
  'Recursive CTE must preserve two complete lesson/practice/transfer blocks'
);
assert.equal(
  new Set(moduleTasks.map(task => baseTransferTitle(task.title))).size,
  10,
  'Recursive-CTE titles must describe ten distinct recursion decisions'
);
assert.ok(
  moduleTasks.every(task => !/[·#]\s*\d+$/u.test(baseTransferTitle(task.title))),
  'Recursive-CTE titles cannot use numeric suffixes as their primary distinction'
);
assert.equal(
  new Set(moduleTasks.map(task => normalizedSolutionFingerprint(task.solution))).size,
  10,
  'Recursive-CTE tasks collapsed to repeated SQL skeletons after literal normalization'
);
assert.ok(moduleTasks.every(task => /\bWITH\s+RECURSIVE\b/i.test(task.solution)), 'Every recursive-CTE task must use WITH RECURSIVE');

const evidence = new Set(Object.values(recursiveCteAuthoredTaskEvidence).flat());
for (const required of [
  'anchor-member',
  'termination-predicate',
  'downward-hierarchy',
  'ancestor-chain',
  'cycle-guard',
  'visited-path',
  'reachability',
  'minimum-hops',
  'transitive-closure',
  'subtree-aggregation',
  'bill-of-materials',
  'quantity-propagation',
  'path-enumeration',
  'multiple-paths',
  'blast-radius',
  'depth-cap',
  'truncation-evidence'
]) {
  assert.ok(evidence.has(required as never), `Recursive-CTE ladder lost evidence: ${required}`);
}

for (const task of moduleTasks) {
  const taskEvidence = recursiveCteAuthoredTaskEvidence[task.id];
  assert.ok(taskEvidence && taskEvidence.length >= 3, `${task.id}: expected at least three recursion evidence dimensions`);
  assert.ok(task.description.length >= 145, `${task.id}: recursion reasoning contract is too thin`);
  assert.ok(task.solution.includes('SELECT'), `${task.id}: task lacks observable result evidence`);
}

const requiredSqlMarkers: Readonly<Record<string, readonly string[]>> = {
  'task-171': ['VALUES (1, 5)', 'remaining > 1'],
  'task-172': ['c.parent_id = h.node_id', "h.path || ' > ' || c.name"],
  'task-173': ['p.node_id = a.parent_id', "a.path_up || ' <- ' || p.name"],
  'task-174': ["instr(w.visited_path, '|' || e.to_node || '|') = 0", 'e.from_node = w.node'],
  'task-175': ['MIN(depth) AS minimum_hops', 'COUNT(*) AS path_count', 'p.depth < 6'],
  'task-176': ['SELECT node_id, node_id, 0', 'n.parent_id = c.descendant_id', 'descendant_count'],
  'task-177': ['x.cumulative_quantity * e.quantity', 'SUM(cumulative_quantity) AS total_quantity'],
  'task-178': ["p.node <> 'E'", 'display_path', "WHERE node = 'E'"],
  'task-179': ['e.dependency = i.component', 'MIN(depth) AS min_depth', 'COUNT(*) AS path_count'],
  'task-180': ['w.depth < 4', 'truncated_frontier', 'EXISTS (SELECT 1 FROM bounded_edges']
};

for (const task of moduleTasks) {
  for (const marker of requiredSqlMarkers[task.id] || []) {
    assert.ok(task.solution.includes(marker), `${task.id}: missing recursive-CTE proof marker ${marker}`);
  }
}

const unsafeGraphTasks = moduleTasks.filter(task =>
  ['task-174', 'task-175', 'task-178', 'task-179', 'task-180'].includes(task.id)
  && !task.solution.includes('instr(')
);
assert.equal(unsafeGraphTasks.length, 0, 'Graph recursion must carry an explicit visited-path cycle guard');

const transferTasks = moduleTasks.filter(task => task.mode === 'interview' || task.mode === 'puzzle');
assert.equal(transferTasks.length, 4, 'Recursive CTE must retain two Interview and two Puzzle transfer tasks');
for (const task of transferTasks) {
  assert.ok(task.starter.includes('--'), `${task.id}: transfer task lost its blank-editor reasoning contract`);
}

const expectedResults: Readonly<Record<string, {
  columns: readonly string[];
  values: readonly (readonly (string | number | null)[])[];
}>> = {
  'task-171': {
    columns: ['n', 'remaining'],
    values: [[1, 5], [2, 4], [3, 3], [4, 2], [5, 1]]
  },
  'task-172': {
    columns: ['node_id', 'name', 'depth', 'path'],
    values: [
      [1, 'Root', 0, 'Root'],
      [2, 'Support', 1, 'Root > Support'],
      [3, 'Data', 1, 'Root > Data'],
      [4, 'L1', 2, 'Root > Support > L1'],
      [5, 'L2', 2, 'Root > Support > L2'],
      [6, 'Analytics', 2, 'Root > Data > Analytics']
    ]
  },
  'task-173': {
    columns: ['node_id', 'name', 'distance_to_target', 'path_up'],
    values: [
      [5, 'Recursive CTE', 0, 'Recursive CTE'],
      [4, 'Advanced', 1, 'Recursive CTE <- Advanced'],
      [3, 'SQL', 2, 'Recursive CTE <- Advanced <- SQL'],
      [2, 'Education', 3, 'Recursive CTE <- Advanced <- SQL <- Education'],
      [1, 'Company', 4, 'Recursive CTE <- Advanced <- SQL <- Education <- Company']
    ]
  },
  'task-174': {
    columns: ['node', 'depth', 'display_path'],
    values: [
      ['A', 0, 'A'],
      ['B', 1, 'A > B'],
      ['C', 2, 'A > B > C'],
      ['D', 2, 'A > B > D'],
      ['E', 3, 'A > B > D > E']
    ]
  },
  'task-175': {
    columns: ['node', 'minimum_hops', 'path_count'],
    values: [['A', 0, 1], ['B', 1, 1], ['C', 1, 1], ['D', 2, 3], ['E', 2, 1], ['F', 2, 4]]
  },
  'task-176': {
    columns: ['node_id', 'name', 'descendant_count', 'max_depth'],
    values: [
      [1, 'Root', 6, 3],
      [2, 'Support', 2, 1],
      [3, 'Data', 2, 2],
      [4, 'L1', 0, 0],
      [5, 'L2', 0, 0],
      [6, 'Analytics', 1, 1],
      [7, 'BI', 0, 0]
    ]
  },
  'task-177': {
    columns: ['component', 'total_quantity', 'first_depth'],
    values: [
      ['Bolt', 12, 2],
      ['Frame', 1, 1],
      ['Spoke', 40, 2],
      ['Tire', 2, 2],
      ['Tube', 3, 2],
      ['Wheel', 2, 1]
    ]
  },
  'task-178': {
    columns: ['display_path', 'hops'],
    values: [['A > B > E', 2], ['A > B > D > E', 3], ['A > C > D > E', 3]]
  },
  'task-179': {
    columns: ['component', 'min_depth', 'path_count'],
    values: [
      ['auth', 0, 1],
      ['notifications', 1, 1],
      ['payments', 1, 1],
      ['profile', 1, 1],
      ['admin', 2, 3],
      ['reports', 2, 2]
    ]
  },
  'task-180': {
    columns: ['node', 'depth', 'truncated_frontier'],
    values: [[1, 0, 0], [2, 1, 0], [3, 2, 0], [4, 3, 0], [5, 4, 1]]
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
    assert.ok(expectation, `${task.id}: missing exact recursion expectation`);
    assert.deepEqual(result[0].columns, [...expectation.columns], `${task.id}: result columns drifted`);
    assert.deepEqual(result[0].values, expectation.values.map(row => [...row]), `${task.id}: recursion semantics drifted`);
  } finally {
    database.close();
  }
}

console.log('Authored recursive CTE validated: ten distinct bounded, hierarchy, ancestor, cycle-safe, reachability, closure, BOM, path, blast-radius and truncation contracts with exact result evidence.');
