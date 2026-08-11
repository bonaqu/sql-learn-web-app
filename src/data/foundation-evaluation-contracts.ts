import type {
  FoundationConcept,
  TaskEvaluationColumn,
  TaskEvaluationContract,
  TaskEvaluationFixture,
  TaskOrderPolicy
} from '../lib/task-evaluation-contract';
import { coreAuthoredEvaluationContracts } from './core-authored-tasks';

const publicFixture: TaskEvaluationFixture = {
  id: 'public-base',
  label: 'Открытый учебный набор',
  visibility: 'public',
  setupSql: ''
};

const stateEdgeFixture: TaskEvaluationFixture = {
  id: 'hidden-state-edge',
  label: 'Состояния и NULL',
  visibility: 'hidden',
  setupSql: `
    INSERT INTO tickets VALUES
      (9001,'VPN','Open','High',1,1,55,120,'2026-08-01 09:00:00',NULL,'Open ticket with observed duration'),
      (9002,'Email','Closed','Medium',2,2,NULL,120,'2026-08-01 10:00:00','2026-08-01 11:00:00','Closed ticket with missing duration');
  `
};

const duplicateTieFixture: TaskEvaluationFixture = {
  id: 'adversarial-duplicates-ties',
  label: 'Дубли и равные значения',
  visibility: 'adversarial',
  setupSql: `
    INSERT INTO tickets VALUES
      (9010,'VPN','Closed','High',1,1,85,120,'2026-08-02 09:00:00','2026-08-02 10:25:00','Duplicate projection A'),
      (9011,'VPN','Closed','High',1,1,85,120,'2026-08-02 09:05:00','2026-08-02 10:30:00','Duplicate projection B'),
      (9012,'LMS','Open','High',2,2,NULL,120,'2026-08-02 09:10:00',NULL,'Ordering tie');
  `
};

export const foundationEvaluationFixtures = [
  publicFixture,
  stateEdgeFixture,
  duplicateTieFixture
] as const;

const preserveUnordered: TaskOrderPolicy = { kind: 'unordered' };

function column(name: string, type: TaskEvaluationColumn['type'], nullable = false, numericTolerance?: number): TaskEvaluationColumn {
  return { name, type, nullable, ...(numericTolerance === undefined ? {} : { numericTolerance }) };
}

function contract(
  taskId: string,
  columns: TaskEvaluationColumn[],
  requiredConcepts: FoundationConcept[],
  order: TaskOrderPolicy = preserveUnordered,
  fixtures: readonly TaskEvaluationFixture[] = foundationEvaluationFixtures
): TaskEvaluationContract {
  return {
    version: 'task-evaluation-v1',
    id: `foundation:${taskId}`,
    taskId,
    columns,
    duplicatePolicy: 'preserve',
    nullPolicy: 'preserve',
    order,
    statementPolicy: { readOnly: true, singleStatement: true },
    postState: { tablesUnchanged: ['tickets'] },
    fixtures: [...fixtures],
    requiredConcepts
  };
}

const thinkingConcepts: FoundationConcept[] = ['result-grain', 'select-list', 'from-source'];
const filteringConcepts: FoundationConcept[] = [...thinkingConcepts, 'where-filter'];
const booleanConcepts: FoundationConcept[] = [...filteringConcepts, 'boolean-logic'];
const nullConcepts: FoundationConcept[] = [...filteringConcepts, 'null-predicate'];
const selectConcepts: FoundationConcept[] = [...filteringConcepts, 'expression', 'alias'];

const corridorContracts = [
  contract('task-001', [column('ticket_id', 'integer'), column('service', 'text')], thinkingConcepts),
  contract('task-002', [column('ticket_id', 'integer'), column('status', 'text')], thinkingConcepts),
  contract('task-003', [column('service', 'text'), column('status', 'text')], thinkingConcepts),
  contract('task-004', [column('ticket_id', 'integer'), column('resolution_minutes', 'integer', true)], thinkingConcepts),
  contract('task-005', [column('ticket_id', 'integer'), column('sla_minutes', 'integer')], thinkingConcepts),
  contract('task-006', [column('ticket_id', 'integer'), column('priority', 'text'), column('service', 'text')], thinkingConcepts),
  contract('task-007', [
    column('ticket_id', 'integer'),
    column('resolution_minutes', 'integer', true),
    column('sla_minutes', 'integer'),
    column('delta_minutes', 'integer', true)
  ], selectConcepts),
  contract('task-008', [column('ticket_id', 'integer'), column('sla_hours', 'real')], selectConcepts),
  contract('task-009', [column('ticket_id', 'integer'), column('product', 'text')], selectConcepts),
  contract('task-010', [column('ticket_id', 'integer'), column('double_sla_minutes', 'integer')], selectConcepts),
  contract('task-011', [column('ticket_id', 'integer'), column('projected_minutes', 'integer', true)], selectConcepts),
  contract('task-012', [column('ticket_id', 'integer'), column('sla_usage_pct', 'real', true, 0.000001)], selectConcepts),
  contract('task-013', [column('ticket_id', 'integer'), column('status', 'text')], filteringConcepts),
  contract('task-014', [column('ticket_id', 'integer'), column('priority', 'text'), column('status', 'text')], booleanConcepts),
  contract('task-015', [column('ticket_id', 'integer'), column('service', 'text')], booleanConcepts),
  contract('task-016', [column('ticket_id', 'integer'), column('resolution_minutes', 'integer', true)], nullConcepts),
  contract('task-017', [column('ticket_id', 'integer'), column('status', 'text'), column('resolution_minutes', 'integer')], [...nullConcepts, 'boolean-logic']),
  contract('task-018', [column('ticket_id', 'integer'), column('service', 'text'), column('priority', 'text')], booleanConcepts)
];

const checkpointContracts = [
  contract('checkpoint-foundation-thinking', [
    column('ticket_id', 'integer'), column('customer_id', 'integer', true), column('subject', 'text')
  ], thinkingConcepts),
  contract('checkpoint-foundation-filtering', [
    column('ticket_id', 'integer'), column('priority', 'text'), column('status', 'text')
  ], booleanConcepts),
  contract('checkpoint-foundation-select', [
    column('ticket_id', 'integer'), column('remaining_minutes', 'integer', true)
  ], selectConcepts),
  contract('checkpoint-foundation-sorting', [
    column('ticket_id', 'integer'), column('sla_minutes', 'integer')
  ], [...selectConcepts, 'stable-order', 'limit'], {
    kind: 'ordered',
    keys: [
      { column: 'sla_minutes', direction: 'asc', nulls: 'not-applicable' },
      { column: 'ticket_id', direction: 'asc', nulls: 'not-applicable' }
    ],
    completeTieBreak: true
  }),
  contract('checkpoint-foundation-aggregates', [column('open_count', 'integer')], [...filteringConcepts, 'aggregate'])
];

export const taskEvaluationContracts: readonly TaskEvaluationContract[] = [
  ...corridorContracts,
  ...checkpointContracts,
  ...coreAuthoredEvaluationContracts
];

const contractsById = new Map(taskEvaluationContracts.map(item => [item.id, item]));

export function taskEvaluationContract(id: string) {
  return contractsById.get(id) || null;
}

export function evaluationContractForTask(taskId: string) {
  return taskEvaluationContracts.find(item => item.taskId === taskId) || null;
}

export const foundationCorridorTaskIds = corridorContracts.map(item => item.taskId);
