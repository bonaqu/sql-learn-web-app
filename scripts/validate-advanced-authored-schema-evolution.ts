import assert from 'node:assert/strict';
import {
  schemaEvolutionAuthoredTaskEvidence,
  schemaEvolutionAuthoredTaskIds
} from '../src/data/advanced-authored-schema-evolution';
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

const expectedIds = Array.from({ length: 10 }, (_, index) => `task-${131 + index}`);
const actualIds = [...schemaEvolutionAuthoredTaskIds]
  .sort((left, right) => taskNumber(left) - taskNumber(right));
assert.deepEqual(actualIds, expectedIds, 'Schema-evolution authored identity must remain task-131 through task-140');
assert.deepEqual(
  Object.keys(schemaEvolutionAuthoredTaskEvidence).sort((left, right) => taskNumber(left) - taskNumber(right)),
  expectedIds,
  'Every authored schema-evolution task needs explicit evidence tags'
);

const moduleTasks = tasks
  .filter(task => task.module === 'schema-evolution')
  .sort((left, right) => taskNumber(left.id) - taskNumber(right.id));
assert.deepEqual(moduleTasks.map(task => task.id), expectedIds, 'Schema-evolution persisted task identity drifted');
assert.deepEqual(
  moduleTasks.map(task => task.mode),
  [...advancedLessonTaskModePattern, ...advancedLessonTaskModePattern],
  'Schema-evolution must preserve two complete lesson/practice/transfer blocks'
);
assert.equal(
  new Set(moduleTasks.map(task => baseTransferTitle(task.title))).size,
  10,
  'Schema-evolution titles must describe ten distinct migration decisions'
);
assert.ok(
  moduleTasks.every(task => !/[·#]\s*\d+$/u.test(baseTransferTitle(task.title))),
  'Schema-evolution titles cannot use numeric suffixes as their primary distinction'
);
assert.equal(
  new Set(moduleTasks.map(task => normalizedSolutionFingerprint(task.solution))).size,
  10,
  'Schema-evolution tasks collapsed to repeated SQL skeletons after literal normalization'
);

const evidence = new Set(Object.values(schemaEvolutionAuthoredTaskEvidence).flat());
for (const required of [
  'preflight-validation',
  'expand-migration',
  'backfill',
  'check-constraint',
  'copy-and-swap',
  'compatibility-view',
  'view-stability',
  'contract-migration',
  'migration-ledger',
  'idempotent-migration',
  'batch-backfill',
  'transactional-ddl',
  'rollback-proof',
  'schema-metadata'
]) {
  assert.ok(evidence.has(required as never), `Schema-evolution authored ladder lost evidence: ${required}`);
}

for (const task of moduleTasks) {
  const taskEvidence = schemaEvolutionAuthoredTaskEvidence[task.id];
  assert.ok(taskEvidence && taskEvidence.length >= 3, `${task.id}: expected at least three evidence dimensions`);
  assert.ok(task.description.length >= 150, `${task.id}: migration contract is too thin`);
  assert.ok(task.solution.includes('SELECT'), `${task.id}: migration lacks an observable verification query`);
}

const requiredSqlMarkers: Readonly<Record<string, readonly string[]>> = {
  'task-131': ['IS NULL', 'NOT BETWEEN', 'violation'],
  'task-132': ['ALTER TABLE', 'lifecycle_state', 'remaining_nulls'],
  'task-133': ['CHECK (sla_minutes BETWEEN 1 AND 1440)', 'source_rows', 'migrated_rows', 'invariant_violations'],
  'task-134': ['CREATE TEMP VIEW tickets_legacy', 'service_code AS service'],
  'task-135': ["pragma_table_info('support_ticket_contract')", 'ALTER TABLE support_tickets ADD COLUMN internal_note'],
  'task-136': ['lower(trim(email))', 'email_normalized TEXT NOT NULL UNIQUE', 'ALTER TABLE users_new RENAME TO legacy_users'],
  'task-137': ['schema_migrations', 'ON CONFLICT(migration_id) DO NOTHING', 'ledger_rows'],
  'task-138': ['BETWEEN 1 AND 3', 'BETWEEN 4 AND 6', 'remaining_rows'],
  'task-139': ['BEGIN;', 'ROLLBACK;', "pragma_table_info('service_quota')"],
  'task-140': ["pragma_table_info('contact_points')", 'sqlite_temp_master', 'view:active_contacts']
};

for (const task of moduleTasks) {
  for (const marker of requiredSqlMarkers[task.id] || []) {
    assert.ok(task.solution.includes(marker), `${task.id}: missing schema-evolution proof marker ${marker}`);
  }
}

const transferTasks = moduleTasks.filter(task => task.mode === 'interview' || task.mode === 'puzzle');
assert.equal(transferTasks.length, 4, 'Schema-evolution must retain two Interview and two Puzzle transfer tasks');
for (const task of transferTasks) {
  assert.ok(task.starter.includes('--'), `${task.id}: transfer task lost its blank-editor reasoning contract`);
  assert.ok(!/\b(?:CREATE|ALTER|INSERT|UPDATE|DELETE|SELECT)\b(?![^\n]*--)/i.test(task.starter.replace(/^--.*$/gm, '')), `${task.id}: transfer starter exposes executable SQL`);
}

console.log('Authored schema evolution validated: ten distinct migration decisions, preserved IDs/modes, explicit evidence, verification SQL and blank-editor transfer contracts.');
