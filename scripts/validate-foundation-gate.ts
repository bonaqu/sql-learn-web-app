import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import initSqlJs from 'sql.js';
import { checkpointTaskList, foundationCheckpointTaskIds } from '../src/data/checkpoint-task-bank';
import {
  evaluationContractForTask,
  foundationCorridorTaskIds,
  taskEvaluationContracts
} from '../src/data/foundation-evaluation-contracts';
import {
  foundationFrontierViolations,
  foundationIntroducedConcepts,
  foundationModuleOrder
} from '../src/data/foundation-concept-frontier';
import { curriculumCheckpoints, curriculumLessons } from '../src/data/complete-curriculum';
import { phaseDefinitions } from '../src/data/learning-structure';
import { tasks } from '../src/data/course-catalog';
import { emptyCurriculumProgress } from '../src/lib/curriculum-progress';
import { lessonAccess } from '../src/lib/curriculum-access';
import { moduleFoundationComplete } from '../src/lib/learning-journey';
import {
  defaultProgress,
  hasIndependentTaskEvidence,
  migrateProgress,
  recordAttempt,
  type Progress
} from '../src/lib/progress';
import {
  evaluateTaskSql,
  FOUNDATION_EVIDENCE_CONTRACT_VERSION,
  TASK_EVALUATION_CONTRACT_VERSION,
  type FoundationConcept
} from '../src/lib/task-evaluation-contract';

const require = createRequire(import.meta.url);
const wasmPath = require.resolve('sql.js/dist/sql-wasm.wasm');
const SQL = await initSqlJs({ locateFile: () => wasmPath });
const corridorTasks = foundationCorridorTaskIds.map(taskId => tasks.find(task => task.id === taskId)!);
const checkpointTasks = checkpointTaskList();

assert.equal(corridorTasks.length, 18, 'Foundation corridor must contain exactly 18 tasks');
assert.ok(corridorTasks.every(Boolean), 'Foundation corridor references unknown tasks');
assert.deepEqual(phaseDefinitions[0].moduleIds.slice(0, 3), foundationModuleOrder, 'Foundation module order drifted');
assert.deepEqual(curriculumLessons.find(item => item.module === 'filtering')?.prerequisites, ['sql-thinking']);
assert.deepEqual(curriculumLessons.find(item => item.module === 'select')?.prerequisites, ['filtering']);

for (const task of corridorTasks) {
  const contract = evaluationContractForTask(task.id);
  assert.ok(contract, `${task.id}: missing evaluation contract`);
  assert.equal(task.evaluationContractId, contract?.id, `${task.id}: task/contract link drifted`);
  assert.ok(contract!.columns.length >= 2, `${task.id}: explicit projected columns missing`);
  assert.equal(contract!.nullPolicy, 'preserve', `${task.id}: NULL policy must be explicit`);
  assert.ok(contract!.duplicatePolicy === 'preserve' || contract!.duplicatePolicy === 'distinct', `${task.id}: duplicate policy missing`);
  assert.ok(contract!.order.kind === 'unordered' || contract!.order.completeTieBreak, `${task.id}: incomplete order policy`);
  assert.ok(contract!.fixtures.length >= 3, `${task.id}: at least three deterministic fixtures required`);
  assert.ok(contract!.fixtures.some(fixture => fixture.visibility === 'hidden'), `${task.id}: hidden fixture missing`);
  assert.ok(contract!.fixtures.some(fixture => fixture.visibility === 'adversarial'), `${task.id}: adversarial fixture missing`);
  assert.equal(new Set(contract!.fixtures.map(fixture => fixture.id)).size, contract!.fixtures.length, `${task.id}: duplicate fixture IDs`);
  assert.ok(contract!.statementPolicy.readOnly && contract!.statementPolicy.singleStatement, `${task.id}: safe statement policy missing`);
  assert.deepEqual(contract!.postState.tablesUnchanged, ['tickets'], `${task.id}: post-state invariant missing`);
  const result = evaluateTaskSql(SQL, task, task.solution, 'practice');
  assert.equal(result.correct, true, `${task.id}: reviewed reference query does not pass all fixtures (${result.diagnostic?.contractCode})`);
  assert.equal(result.evidence?.fixtureIds.length, 3, `${task.id}: fixture evidence is incomplete`);
}

assert.deepEqual(foundationFrontierViolations(taskEvaluationContracts), [], 'Canonical foundation concept frontier is invalid');
let frontierMutationCount = 0;
for (const moduleId of foundationModuleOrder) {
  for (const concept of foundationIntroducedConcepts[moduleId]) {
    const mutated = Object.fromEntries(Object.entries(foundationIntroducedConcepts).map(([id, concepts]) => [
      id,
      id === moduleId ? concepts.filter(candidate => candidate !== concept) : [...concepts]
    ])) as Record<string, FoundationConcept[]>;
    assert.ok(foundationFrontierViolations(taskEvaluationContracts, foundationModuleOrder, mutated).length > 0, `Removing ${concept} must break the frontier`);
    frontierMutationCount += 1;
  }
}

const mutations = [
  ['task-001', "SELECT CAST(ticket_id AS TEXT) AS ticket_id, service FROM tickets;", 'wrong-types'],
  ['task-003', 'SELECT DISTINCT service, status FROM tickets;', 'wrong-row-count'],
  ['task-004', 'SELECT ticket_id, COALESCE(resolution_minutes, 0) AS resolution_minutes FROM tickets;', 'wrong-null-semantics'],
  ['task-007', 'SELECT ticket_id, resolution_minutes, sla_minutes, resolution_minutes - sla_minutes AS delta_minutes FROM tickets WHERE resolution_minutes IS NOT NULL;', 'wrong-null-semantics'],
  ['task-013', 'SELECT ticket_id, status FROM tickets WHERE resolution_minutes IS NOT NULL;', 'wrong-values'],
  ['task-014', "SELECT ticket_id, priority, status FROM tickets WHERE priority = 'Critical';", 'wrong-row-count'],
  ['task-015', "SELECT ticket_id, service FROM tickets WHERE service = 'VPN' AND service = 'LMS';", 'wrong-row-count'],
  ['task-016', 'SELECT ticket_id, resolution_minutes FROM tickets WHERE resolution_minutes = NULL;', 'wrong-row-count'],
  ['task-017', 'SELECT ticket_id, status, resolution_minutes FROM tickets WHERE resolution_minutes IS NOT NULL;', 'wrong-row-count'],
  ['task-018', "SELECT ticket_id, service, priority FROM tickets WHERE priority = 'High' OR priority = 'Critical' AND service = 'VPN' OR service = 'VDI';", 'wrong-row-count']
] as const;

for (const [taskId, sql, expectedCode] of mutations) {
  const task = tasks.find(item => item.id === taskId)!;
  const result = evaluateTaskSql(SQL, task, sql, 'practice');
  assert.equal(result.correct, false, `${taskId}: shortcut mutation unexpectedly passed`);
  assert.equal(result.diagnostic?.contractCode, expectedCode, `${taskId}: mutation diagnostic drifted`);
}

const unorderedTask = tasks.find(task => task.id === 'task-001')!;
assert.equal(evaluateTaskSql(SQL, unorderedTask, 'SELECT ticket_id, service FROM tickets ORDER BY ticket_id DESC;', 'practice').correct, true, 'Equivalent unordered result must pass');
const unsafe = evaluateTaskSql(SQL, unorderedTask, 'DELETE FROM tickets;', 'practice');
assert.equal(unsafe.diagnostic?.contractCode, 'unsafe-mutation', 'Mutation policy must reject DELETE');

const orderedTask = checkpointTasks.find(task => task.id === 'checkpoint-foundation-sorting')!;
const wrongOrder = evaluateTaskSql(SQL, orderedTask, 'SELECT ticket_id, sla_minutes FROM tickets ORDER BY sla_minutes DESC, ticket_id ASC LIMIT 3;', 'checkpoint');
assert.equal(wrongOrder.diagnostic?.contractCode, 'wrong-values', 'Wrong top-N semantics must fail before an order-only diagnostic');
const incompleteTie = evaluateTaskSql(SQL, orderedTask, 'SELECT ticket_id, sla_minutes FROM tickets ORDER BY sla_minutes ASC, ticket_id DESC LIMIT 3;', 'checkpoint');
assert.equal(incompleteTie.diagnostic?.contractCode, 'wrong-order', 'Wrong tie-breaker must produce an ordering diagnostic');

const parityTask = tasks.find(task => task.id === 'task-007')!;
const oldClosedShortcut = 'SELECT ticket_id, resolution_minutes, sla_minutes, resolution_minutes - sla_minutes AS delta_minutes FROM tickets WHERE resolution_minutes IS NOT NULL;';
const parity = (['practice', 'checkpoint', 'placement', 'assessment'] as const).map(surface => {
  const result = evaluateTaskSql(SQL, parityTask, oldClosedShortcut, surface);
  return { correct: result.correct, code: result.diagnostic?.contractCode, fixture: result.diagnostic?.fixtureId };
});
assert.ok(parity.every(item => JSON.stringify(item) === JSON.stringify(parity[0])), 'Cross-surface verdict/diagnostic parity failed');

const checkpoint = curriculumCheckpoints.find(item => item.id === 'checkpoint-foundation')!;
assert.deepEqual(checkpoint.taskIds, foundationCheckpointTaskIds, 'Foundation checkpoint task bank drifted');
const normalized = (sql: string) => sql.toLowerCase().replace(/\s+/g, ' ').replace(/;$/, '').trim();
const practiceIds = new Set(tasks.map(task => task.id));
const practiceSolutions = new Set(tasks.map(task => normalized(task.solution)));
for (const task of checkpointTasks) {
  assert.ok(!practiceIds.has(task.id), `${task.id}: checkpoint reuses a practice task ID`);
  assert.ok(!practiceSolutions.has(normalized(task.solution)), `${task.id}: checkpoint reuses a normalized practice solution`);
  const contract = evaluationContractForTask(task.id);
  assert.ok(contract && contract.fixtures.some(fixture => fixture.visibility === 'adversarial'), `${task.id}: unseen adversarial context missing`);
  assert.equal(evaluateTaskSql(SQL, task, task.solution, 'checkpoint').correct, true, `${task.id}: checkpoint reference fails`);
}

const legacy: Progress = {
  version: 4,
  completed: ['task-001', 'task-100'],
  taskStats: {
    'task-001': { attempts: 1, incorrect: 0, hintsUsed: 0, independentPasses: 1, completedAt: '2026-01-01T00:00:00.000Z' },
    'task-100': { attempts: 3, incorrect: 2, hintsUsed: 1, independentPasses: 1, errorKinds: { values: 2 }, completedAt: '2026-01-02T00:00:00.000Z' }
  },
  xp: 777,
  streak: 9,
  history: defaultProgress.history.map((point, index) => ({ ...point, solved: index })),
  lastTask: 'task-100',
  lastStudyDate: '2026-01-02'
};
const migratedA = migrateProgress(legacy);
const migratedB = migrateProgress(JSON.parse(JSON.stringify(legacy)));
assert.deepEqual(migratedA, migratedB, 'Saved-state migration must be deterministic');
assert.equal(hasIndependentTaskEvidence(migratedA, 'task-001'), false, 'Legacy single-seed evidence must not unlock the versioned corridor');
assert.equal(hasIndependentTaskEvidence(migratedA, 'task-100'), true, 'Unrelated valid progress must remain usable');
assert.deepEqual(
  JSON.parse(JSON.stringify(migratedA.taskStats['task-100'])),
  legacy.taskStats['task-100'],
  'Unrelated task evidence changed during migration'
);
const exported = JSON.stringify(migratedA);
const restored = migrateProgress(JSON.parse(exported));
assert.deepEqual(restored, migratedA, 'Export/restore changed migrated progress');
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
assert.equal(hash(JSON.stringify(migratedA)), hash(JSON.stringify(restored)), 'Export/restore hash mismatch');

function emptyProgress(): Progress {
  return { ...defaultProgress, history: defaultProgress.history.map(point => ({ ...point })), completed: [], taskStats: {} };
}

const thinkingTasks = tasks.filter(task => task.module === 'sql-thinking' && (task.mode === 'lesson' || task.mode === 'practice'));
let guided = emptyProgress();
for (const task of thinkingTasks) guided = recordAttempt(guided, task, true, { independent: false });
assert.equal(moduleFoundationComplete('sql-thinking', guided, emptyCurriculumProgress()), false, 'Guided/solution-assisted correctness must not complete a module');
const lessonOnlyCurriculum = { ...emptyCurriculumProgress(), completedLessons: ['lesson-sql-thinking'] };
const filteringLesson = curriculumLessons.find(item => item.module === 'filtering')!;
assert.equal(lessonAccess(filteringLesson, guided, lessonOnlyCurriculum, [], []).unlocked, false, 'Theory/MCQ completion must not unlock the next module');

let independent = emptyProgress();
for (const task of thinkingTasks) {
  const evaluation = evaluateTaskSql(SQL, task, task.solution, 'practice');
  independent = recordAttempt(independent, task, true, { independent: true, contractEvidence: evaluation.evidence || undefined });
  assert.equal(evaluation.evidence?.evidenceContractVersion, FOUNDATION_EVIDENCE_CONTRACT_VERSION);
  assert.equal(evaluation.evidence?.contractVersion, TASK_EVALUATION_CONTRACT_VERSION);
}
assert.equal(new Set(thinkingTasks.map(task => independent.taskStats[task.id]?.evaluationContractId)).size, thinkingTasks.length, 'Unlock evidence must use distinct contracts');
assert.equal(moduleFoundationComplete('sql-thinking', independent, lessonOnlyCurriculum), true, 'Distinct hidden-fixture passes must complete the module');
assert.equal(lessonAccess(filteringLesson, independent, lessonOnlyCurriculum, [], []).unlocked, true, 'Independent contracts must unlock the next module');

process.stdout.write(`Foundation Gate v1 validated: 18 corridor contracts / ${taskEvaluationContracts.length} total contracts; 3 fixtures each; ${mutations.length} SQL mutations rejected; ${frontierMutationCount} frontier mutations rejected; cross-surface parity ${parity.map(item => item.code).join('/')}; checkpoint bank ${checkpointTasks.length} unseen tasks; migration sha256 ${hash(exported)}; evidence ${FOUNDATION_EVIDENCE_CONTRACT_VERSION}.\n`);
