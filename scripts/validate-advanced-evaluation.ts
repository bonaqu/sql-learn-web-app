import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import initSqlJs from 'sql.js';
import { CORE_TASK_COUNT, tasks } from '../src/data/course-catalog';
import { evaluateTaskSql, TaskSqlExecutionError } from '../src/lib/task-evaluation-contract';

const require = createRequire(import.meta.url);
const wasmPath = require.resolve('sql.js/dist/sql-wasm.wasm');
const SQL = await initSqlJs({ locateFile: () => wasmPath });
const advancedTasks = tasks.slice(CORE_TASK_COUNT);

assert.equal(advancedTasks.length, 120, 'Advanced evaluator gate must cover all 120 tasks');
assert.ok(advancedTasks.every(task => task.evaluationPolicy === 'disposable-script'), 'Every advanced task needs an explicit disposable-script policy');

for (const task of advancedTasks) {
  const result = evaluateTaskSql(SQL, task, task.solution, 'practice');
  assert.equal(result.correct, true, `${task.id}: canonical solution fails through the shared application evaluator`);
  assert.equal(result.evidence, null, `${task.id}: disposable bridge must not claim hidden/adversarial contract evidence`);
}

const wrongAnswers = new Map<string, string>([
  ['task-121', tasks.find(task => task.id === 'task-121')!.solution.replace(/UPDATE incident_queue[\s\S]*?; SELECT/i, 'SELECT')],
  ['task-131', 'CREATE TEMP TABLE service_contracts(service TEXT PRIMARY KEY); SELECT * FROM service_contracts;'],
  ['task-141', "SELECT 'always_true' AS label, 'TRUE' AS truth_value;"],
  ['task-171', 'SELECT 1 AS n, 5 AS remaining;'],
  ['task-191', 'SELECT 1 AS event_id, 1 AS ticket_id, NULL AS channel;'],
  ['task-225', 'CREATE TEMP TABLE counters(id INTEGER PRIMARY KEY, value INTEGER NOT NULL); INSERT INTO counters VALUES (1, 105); SELECT id, value FROM counters;']
]);

for (const [taskId, sql] of wrongAnswers) {
  const task = tasks.find(item => item.id === taskId)!;
  const result = evaluateTaskSql(SQL, task, sql, 'practice');
  assert.equal(result.correct, false, `${taskId}: representative wrong answer received a green result`);
  assert.ok(result.diagnostic, `${taskId}: representative wrong answer lacks diagnostic feedback`);
}

const disposableTask = tasks.find(task => task.id === 'task-121')!;
for (const sql of [
  "UPDATE tickets SET status = 'Closed' WHERE ticket_id = 1001; SELECT ticket_id FROM tickets;",
  "ATTACH DATABASE 'outside.db' AS outside; SELECT 1;",
  'PRAGMA query_only = OFF; SELECT 1;'
]) {
  const result = evaluateTaskSql(SQL, disposableTask, sql, 'practice');
  assert.equal(result.correct, false, 'Disposable evaluator accepted an environment or persistent-data mutation');
  assert.equal(result.diagnostic?.contractCode, 'unsafe-mutation', 'Unsafe disposable SQL needs a policy diagnostic');
}

const uncontractedReadOnlyTask = {
  ...tasks[0],
  evaluationPolicy: undefined,
  evaluationContractId: undefined
};
assert.throws(
  () => evaluateTaskSql(SQL, uncontractedReadOnlyTask, 'DELETE FROM tickets;', 'practice'),
  (reason: unknown) => reason instanceof TaskSqlExecutionError
    && reason.kind === 'learner'
    && /readonly database/i.test(reason.message),
  'Default uncontracted fallback must remain read-only'
);

const contaminated = `${disposableTask.solution}\nCREATE TEMP TABLE leaked_state(value INTEGER); INSERT INTO leaked_state VALUES (1);`;
assert.equal(evaluateTaskSql(SQL, disposableTask, contaminated, 'practice').correct, false, 'Unexpected temp state must fail the semantic comparison');
assert.equal(evaluateTaskSql(SQL, disposableTask, disposableTask.solution, 'practice').correct, true, 'A prior disposable run leaked state into the next attempt');

process.stdout.write(`Advanced shared evaluator validated: ${advancedTasks.length}/120 canonical solutions, ${wrongAnswers.size} semantic mutants, unsafe-policy and isolation gates.\n`);
