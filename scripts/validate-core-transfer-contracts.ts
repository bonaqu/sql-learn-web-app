import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import initSqlJs from 'sql.js';
import { modules as coreModules } from '../src/data/course';
import { checkpointTaskList } from '../src/data/checkpoint-task-bank';
import { tasks, type SqlTask } from '../src/data/course-catalog';
import { taskEvaluationContract } from '../src/data/foundation-evaluation-contracts';
import { classifySqlAttempt } from '../src/lib/attempt-diagnostics';
import { evaluateTaskSql } from '../src/lib/task-evaluation-contract';
import {
  defaultProgress,
  hasDurableTaskEvidence,
  hasIndependentTaskEvidence,
  recordAttempt,
  recordSolutionView,
  relatedRetrievalTask,
  reviewQueue,
  type Progress
} from '../src/lib/progress';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const coreModuleIds = new Set(coreModules.map(([id]) => id));
const coreTasks = tasks.filter(task => coreModuleIds.has(task.module));
const keywords = new Set(`select from where join inner left right full cross on as and or not null is in exists between like glob escape case when then else end distinct all union intersect except with recursive group by having order asc desc limit offset over partition rows range groups unbounded preceding following current row filter within cast collate count sum avg min max round coalesce nullif date time datetime julianday strftime lower upper trim substr replace length printf rank dense_rank row_number ntile lag lead first_value last_value explain query plan begin rollback insert into values update set delete create table index primary key unique references check pragma table_info sqlite_master`.split(/\s+/));

function structuralFingerprint(sql: string) {
  const stripped = sql
    .replace(/--[^\r\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/'(?:''|[^'])*'/g, '?')
    .replace(/\b\d+(?:\.\d+)?\b/g, '?')
    .toLowerCase();
  const tokens = stripped.match(/[a-z_][a-z0-9_]*|<=|>=|<>|!=|[-+*/%=(),.;?]/g) || [];
  return tokens.map(token => keywords.has(token) || /^[^a-z_]/.test(token) ? token : 'id').join(' ')
    .replace(/\bas id\b/g, 'as id')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizedSolution(sql: string) {
  let normalized = sql
    .replace(/--[^\r\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/'(?:''|[^'])*'/g, '?')
    .replace(/\b\d+(?:\.\d+)?\b/g, '?')
    .toLowerCase();
  const aliases: Array<[string, string]> = [];
  normalized.replace(/\b(?:from|join)\s+([a-z_][a-z0-9_]*)\s+([a-z_][a-z0-9_]*)\b/g, (_match, _table, alias) => {
    if (!keywords.has(alias) && !aliases.some(([source]) => source === alias)) aliases.push([alias, `a${aliases.length + 1}`]);
    return _match;
  });
  for (const [alias, canonical] of aliases) normalized = normalized.replace(new RegExp(`\\b${alias}\\.`, 'g'), `${canonical}.`);
  normalized = normalized.replace(/\bas\s+[a-z_][a-z0-9_]*/g, 'as alias');
  return normalized.replace(/\s+/g, ' ').trim();
}

assert.equal(
  structuralFingerprint(`SELECT t.ticket_id AS sample FROM tickets t WHERE t.status = 'Open' AND t.ticket_id > 10;`),
  structuralFingerprint(`SELECT x.ticket_id AS renamed FROM tickets x WHERE x.status = 'Closed' AND x.ticket_id > 999;`),
  'Fingerprint mutation control must reject literal and alias-only diversity'
);
assert.notEqual(
  structuralFingerprint(`SELECT ticket_id FROM tickets WHERE status = 'Open';`),
  structuralFingerprint(`SELECT service, COUNT(*) FROM tickets GROUP BY service;`),
  'Fingerprint must preserve structural SQL diversity'
);

for (const task of coreTasks) {
  const learning = task.learningContract;
  assert.ok(learning, `${task.id}: missing learning contract`);
  assert.ok(learning!.problemContract.length >= 30, `${task.id}: problem contract is too short`);
  assert.ok(learning!.expectedGrain.length >= 15, `${task.id}: result grain is not explicit`);
  assert.ok(learning!.stateRules.length >= 3 || Number(task.id.slice(5)) <= 18, `${task.id}: state rules are incomplete`);
  assert.ok(learning!.adversarialCases.length >= 2, `${task.id}: adversarial cases are incomplete`);
  assert.ok(learning!.remediationConcepts.length >= 2, `${task.id}: remediation concepts are incomplete`);
  assert.equal(task.hints.length, 3, `${task.id}: hints must progress concept → structure → verification`);
  assert.notEqual(task.hints[0].replace(/\s+/g, ' ').trim(), task.solution.replace(/\s+/g, ' ').trim(), `${task.id}: first hint exposes the solution`);
  const evaluation = task.evaluationContractId ? taskEvaluationContract(task.evaluationContractId) : null;
  assert.ok(evaluation, `${task.id}: missing semantic evaluation contract`);
  assert.equal(evaluation!.taskId, task.id, `${task.id}: evaluation contract points to another task`);
  assert.ok(evaluation!.columns.length > 0, `${task.id}: expected columns are not explicit`);
  assert.ok(evaluation!.fixtures.some(fixture => fixture.visibility === 'public'), `${task.id}: public fixture missing`);
  assert.ok(evaluation!.fixtures.some(fixture => fixture.visibility === 'hidden'), `${task.id}: hidden fixture missing`);
  assert.ok(evaluation!.fixtures.some(fixture => fixture.visibility === 'adversarial'), `${task.id}: adversarial fixture missing`);
}

for (const [moduleId] of coreModules) {
  const moduleTasks = coreTasks.filter(task => task.module === moduleId);
  const fingerprints = new Set(moduleTasks.map(task => structuralFingerprint(task.solution)));
  const families = new Set(moduleTasks.map(task => task.learningContract!.solutionFamily));
  const contexts = new Set(moduleTasks.map(task => task.learningContract!.contextId));
  const structuralFloor = ['sql-thinking', 'select', 'filtering'].includes(moduleId) ? 2 : 4;
  assert.ok(fingerprints.size >= structuralFloor, `${moduleId}: structural SQL family floor failed (${fingerprints.size}/${structuralFloor})`);
  assert.ok(families.size >= 4, `${moduleId}: solution-family floor failed`);
  assert.ok(contexts.size >= 3, `${moduleId}: context diversity floor failed`);

  const practiceFingerprints = new Set(moduleTasks.filter(task => task.mode === 'practice').map(task => normalizedSolution(task.solution)));
  for (const transfer of moduleTasks.filter(task => task.mode === 'interview' || task.mode === 'puzzle')) {
    assert.ok(!practiceFingerprints.has(normalizedSolution(transfer.solution)), `${transfer.id}: transfer reuses a normalized practice solution`);
    assert.equal(transfer.starter.replace(/--[^\r\n]*/g, '').trim(), '', `${transfer.id}: transfer exposes executable scaffold`);
    assert.deepEqual(transfer.learningContract!.transferFromTaskIds, moduleTasks.slice(1, 4).map(task => task.id), `${transfer.id}: transfer prerequisites drifted`);
  }

  const checkpoint = checkpointTaskList().find(task => task.module === moduleId);
  assert.ok(checkpoint, `${moduleId}: unseen checkpoint missing`);
  assert.ok(!moduleTasks.some(task => task.id === checkpoint!.id), `${moduleId}: checkpoint reuses a practice ID`);
  assert.ok(!new Set(moduleTasks.map(task => normalizedSolution(task.solution))).has(normalizedSolution(checkpoint!.solution)), `${moduleId}: checkpoint reuses a normalized course solution`);
  assert.ok(checkpoint!.learningContract?.contextId.startsWith('unseen-') || checkpoint!.id.startsWith('checkpoint-foundation-'), `${moduleId}: checkpoint context is not declared unseen`);
}

const SQL = await initSqlJs({ locateFile: file => path.join(projectRoot, 'node_modules', 'sql.js', 'dist', file) });
for (const task of [...coreTasks, ...checkpointTaskList()]) {
  const evaluation = evaluateTaskSql(SQL, task, task.solution, task.id.startsWith('checkpoint-') ? 'checkpoint' : 'practice');
  assert.equal(evaluation.correct, true, `${task.id}: reference SQL fails its own semantic/adversarial contract (${evaluation.diagnostic?.explanation || 'no diagnostic'})`);
  assert.ok(evaluation.evidence, `${task.id}: semantic evidence receipt missing`);
  assert.ok((evaluation.evidence?.hiddenFixtureIds.length || 0) >= 2, `${task.id}: hidden/adversarial evidence is incomplete`);
}

const heuristicTask = coreTasks.find(task => task.module === 'joins')!;
const uncertain = classifySqlAttempt({
  task: heuristicTask,
  sql: 'SELECT * FROM tickets JOIN ticket_events USING(ticket_id)',
  actual: [{ columns: ['x'], values: [[1]] }],
  expected: [{ columns: ['x'], values: [[2]] }]
});
assert.equal(uncertain.confidence, 'possible', 'Heuristic diagnostic must not claim certainty');
assert.ok((uncertain.alternatives?.length || 0) > 0, 'Heuristic diagnostic must expose plausible alternatives');

const retrievalTask = coreTasks.find(task => task.id === 'task-019')!;
const completed: Progress = {
  ...defaultProgress,
  completed: [retrievalTask.id],
  taskStats: { [retrievalTask.id]: { attempts: 1, incorrect: 0, hintsUsed: 0, independentPasses: 1 } }
};
const exposed = recordSolutionView(completed, retrievalTask.id);
assert.equal(hasIndependentTaskEvidence(exposed, retrievalTask.id), false, 'Viewing a solution must revoke independent mastery until clean retrieval');
const retrievalTarget = relatedRetrievalTask(retrievalTask, exposed)!;
assert.ok(retrievalTarget && retrievalTarget.id !== retrievalTask.id, 'Viewing a solution must schedule a related non-identical retrieval');
assert.ok(exposed.taskStats[retrievalTarget.id].retrievalDueAt, 'Viewing a solution must schedule retrieval');
assert.ok(!reviewQueue(exposed).some(task => task.id === retrievalTarget.id), 'Retrieval must wait until its due time');
const due = structuredClone(exposed);
due.taskStats[retrievalTarget.id].retrievalDueAt = '2000-01-01T00:00:00.000Z';
assert.equal(reviewQueue(due, 1)[0]?.id, retrievalTarget.id, 'Due solution retrieval must enter the no-hint review queue');
const recovered = recordAttempt(due, retrievalTarget, true, { independent: true, contractEvidence: evaluateTaskSql(SQL, retrievalTarget, retrievalTarget.solution, 'practice').evidence || undefined });
assert.equal(recovered.taskStats[retrievalTarget.id].lastRetrievalPassed, true, 'Clean independent retrieval must record executable transfer success');
assert.equal(hasDurableTaskEvidence(recovered, retrievalTask.id), true, 'Clean independent transfer must establish durable evidence');
assert.equal(hasIndependentTaskEvidence(recovered, retrievalTask.id), true, 'Clean independent retrieval must restore mastery evidence');

process.stdout.write(`Core contracts validated: ${coreTasks.length} authored tasks, ${checkpointTaskList().length} unseen checkpoints, structural mutation controls, semantic fixtures, cautious diagnostics and solution-retrieval remediation.\n`);
