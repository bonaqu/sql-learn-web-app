import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import initSqlJs from 'sql.js';
import type { QueryExecResult } from 'sql.js';
import {
  ADVANCED_EVIDENCE_CONTRACT_VERSION,
  ADVANCED_TASK_EVALUATION_CONTRACT_VERSION,
  advancedTaskEvaluationContract,
  advancedTaskEvaluationContracts
} from '../src/data/advanced-evaluation-contracts';
import { CORE_TASK_COUNT, tasks } from '../src/data/course-catalog';
import { trainingSeedSql } from '../src/data/training-dataset';
import { evaluateTaskSql, TaskSqlExecutionError } from '../src/lib/task-evaluation-contract';
import { initialLabSetup, splitSqlStatements } from '../src/lib/sql-statements';

const require = createRequire(import.meta.url);
const wasmPath = require.resolve('sql.js/dist/sql-wasm.wasm');
const SQL = await initSqlJs({ locateFile: () => wasmPath });
const advancedTasks = tasks.slice(CORE_TASK_COUNT);

const statements = splitSqlStatements;

function sqlLiteral(value: unknown) {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') return String(value);
  if (value instanceof Uint8Array) return `X'${Array.from(value, byte => byte.toString(16).padStart(2, '0')).join('')}'`;
  return `'${String(value).replace(/'/g, "''")}'`;
}

function quoteIdentifier(value: string) {
  return `"${value.replace(/"/g, '""')}"`;
}

function hardcodedResult(block: QueryExecResult) {
  if (!block.values.length) {
    return `SELECT ${block.columns.map(column => `NULL AS ${quoteIdentifier(column)}`).join(', ')} WHERE 0`;
  }
  return block.values.map((row, rowIndex) => `SELECT ${row.map((value, columnIndex) =>
    `${sqlLiteral(value)}${rowIndex === 0 ? ` AS ${quoteIdentifier(block.columns[columnIndex])}` : ''}`
  ).join(', ')}`).join(' UNION ALL ');
}

function publicCollisionMutant(task: typeof advancedTasks[number]) {
  const parts = statements(task.solution);
  const final = parts.at(-1) || '';
  assert.match(final, /^(?:SELECT|WITH)\b/i, `${task.id}: public-collision mutation requires a read-only final result statement`);
  const database = new SQL.Database();
  try {
    database.run(trainingSeedSql);
    const output = database.exec(task.solution);
    const finalBlock = output.at(-1);
    assert.ok(finalBlock, `${task.id}: canonical advanced script has no tabular result`);
    return `${parts.slice(0, -1).join('; ')}; ${hardcodedResult(finalBlock!)}`;
  } finally {
    database.close();
  }
}

assert.equal(advancedTasks.length, 120, 'Advanced evaluator gate must cover all 120 tasks');
assert.ok(advancedTasks.every(task => task.evaluationPolicy === 'disposable-script'), 'Every advanced task needs an explicit disposable-script policy');
assert.equal(advancedTaskEvaluationContracts.length, 120, 'Every advanced task needs a versioned evaluation contract');

for (const task of advancedTasks) {
  const contract = task.evaluationContractId ? advancedTaskEvaluationContract(task.evaluationContractId) : null;
  assert.ok(contract, `${task.id}: advanced evaluation contract is missing`);
  assert.equal(contract?.taskId, task.id, `${task.id}: evaluation contract targets another task`);
  assert.ok((contract?.evidenceTags.length || 0) >= 2, `${task.id}: authored competency evidence is too thin`);
  assert.deepEqual(contract?.probes.map(probe => probe.visibility), contract?.inputPolicy === 'fixed-input' ? [] : ['hidden', 'adversarial'], `${task.id}: hidden probe visibility drifted`);
  const result = evaluateTaskSql(SQL, task, task.solution, 'practice');
  assert.equal(result.correct, true, `${task.id}: canonical solution fails through the shared application evaluator`);
  assert.equal(result.evidence?.contractId, contract?.id, `${task.id}: evidence receipt points to another contract`);
  assert.equal(result.evidence?.contractVersion, ADVANCED_TASK_EVALUATION_CONTRACT_VERSION, `${task.id}: evaluation contract version drifted`);
  assert.equal(result.evidence?.evidenceContractVersion, ADVANCED_EVIDENCE_CONTRACT_VERSION, `${task.id}: evidence receipt version drifted`);
  assert.equal(result.evidence?.fixtureIds.length, 1 + (contract?.probes.length || 0), `${task.id}: fixture receipt count drifted`);
  assert.equal(result.evidence?.hiddenFixtureIds.length, contract?.probes.length || 0, `${task.id}: hidden receipt count drifted`);
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

let publicCollisionMutants = 0;
for (const task of advancedTasks) {
  if (['task-140','task-141','task-171','task-229'].includes(task.id)) continue;
  const sql = task.id === 'task-129'
    ? task.solution.replace('WHERE session_id IN (SELECT session_id FROM session_audit)', 'WHERE user_id = 50')
    : publicCollisionMutant(task);
  const result = evaluateTaskSql(SQL, task, sql, 'practice');
  assert.equal(result.correct, false, `${task.id}: task-specific adversarial mutant received a green result`);
  assert.ok(result.diagnostic, `${task.id}: task-specific adversarial mutant lacks diagnostic feedback`);
  if (task.id !== 'task-129') {
    publicCollisionMutants += 1;
    assert.ok(result.diagnostic?.fixtureId.startsWith(`${task.id}:`), `${task.id}: visible-data collision was not rejected by its own hidden contract`);
  }
}

const inputCollisionMutants = [
  ['task-121','WHERE ticket_id IN (SELECT ticket_id FROM update_target)','WHERE ticket_id = 101'],
  ['task-123','WHERE session_id IN (SELECT session_id FROM deletion_target)','WHERE session_id IN (302,304)'],
  ['task-125',"SET used_units = used_units + 2 WHERE service = 'VPN'","SET used_units = 6 WHERE service = 'VPN'"],
  ['task-129','WHERE session_id IN (SELECT session_id FROM session_audit)','WHERE session_id = 902'],
  ['task-130',' AND (SELECT COUNT(*) FROM revocation_target) = 2','']
] as const;
for (const [id,from,to] of inputCollisionMutants) {
  const task = tasks.find(item => item.id === id)!;
  assert.ok(task.solution.includes(from), `${id}: input-collision mutant target drifted`);
  const result = evaluateTaskSql(SQL,task,task.solution.replace(from,to),'practice');
  assert.equal(result.correct,false, `${id}: hardcoded DML passed changed inputs`);
  assert.ok(result.diagnostic?.fixtureId.startsWith(`${id}:`), `${id}: DML must pass public state and fail only when its input changes`);
}

const equivalentSolutions = [
  ['task-121','WHERE ticket_id IN (SELECT ticket_id FROM update_target)','WHERE EXISTS (SELECT 1 FROM update_target x WHERE x.ticket_id = incident_queue.ticket_id)'],
  ['task-141',"CASE WHEN result = 1 THEN 'TRUE' WHEN result = 0 THEN 'FALSE' ELSE 'UNKNOWN' END","IIF(result IS NULL, 'UNKNOWN', IIF(result = 1, 'TRUE', 'FALSE'))"],
  ['task-127','WHERE EXISTS (SELECT 1 FROM recalculated_load r WHERE r.engineer_id = engineer_load.engineer_id)','WHERE engineer_id IN (SELECT engineer_id FROM recalculated_load)'],
  ['task-133','CHECK (sla_minutes BETWEEN 1 AND 1440)','CHECK (sla_minutes >= 1 AND sla_minutes <= 1440)'],
  ['task-140',"CHECK (channel IN ('email','sms'))","CHECK (channel = 'email' OR channel = 'sms')"]
] as const;
for (const [id,from,to] of equivalentSolutions) {
  const task = tasks.find(item => item.id === id)!;
  assert.ok(task.solution.includes(from), `${id}: equivalent solution target drifted`);
  assert.equal(evaluateTaskSql(SQL,task,task.solution.replace(from,to),'practice').correct,true,`${id}: semantic alternative was rejected`);
}

const schemaConstraintMutants = [
  ['task-131'," CHECK (support_channel IN ('portal','email','phone'))",''],
  ['task-133',' CHECK (sla_minutes BETWEEN 1 AND 1440)',''],
  ['task-136','email_normalized TEXT NOT NULL UNIQUE','email_normalized TEXT NOT NULL'],
  ['task-140'," CHECK (channel IN ('email','sms'))",''],
  ['task-140'," CHECK (state IN ('active','revoked'))",''],
  ['task-140','destination_digest TEXT NOT NULL UNIQUE','destination_digest TEXT NOT NULL']
] as const;
for (const [id,from,to] of schemaConstraintMutants) {
  const task = tasks.find(item => item.id === id)!;
  assert.ok(task.solution.includes(from), `${id}: constraint mutant target drifted`);
  const result = evaluateTaskSql(SQL,task,task.solution.replace(from,to),'practice');
  assert.equal(result.correct,false,`${id}: missing schema constraint passed`);
  assert.equal(result.diagnostic?.fixtureId,'disposable-lab-constraints',`${id}: unchanged visible rows must fail the behavioral constraint check`);
}

assert.equal(splitSqlStatements("SELECT ';'; -- ; ignored\nSELECT 2 /* ; ignored */;").length,2,'Quoted/comment semicolons broke SQL splitting');
assert.equal(initialLabSetup(tasks.find(task=>task.id==='task-121')!.solution).count,2,'DML fixture must precede target-set computation');

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

process.stdout.write(`Advanced shared evaluator validated: ${advancedTasks.length}/120 canonical solutions, ${publicCollisionMutants} visible-result collisions, ${inputCollisionMutants.length} public-correct DML mutants, ${schemaConstraintMutants.length} schema-constraint mutants, ${equivalentSolutions.length} semantic alternatives, ${wrongAnswers.size} representative mutants, input isolation and SQL splitting.\n`);
