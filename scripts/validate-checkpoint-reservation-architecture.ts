import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

function source(path: string) {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

const contract = source('../src/lib/checkpoint-attempt-reservation-contract.ts');
const client = source('../src/lib/checkpoint-attempt-reservations.ts');
const coordinatedDomain = source('../src/lib/coordinated-checkpoints.ts');
const reservationWorker = source('../worker/checkpoint-attempt-reservations.ts');
const reportWorker = source('../worker/coordinated-checkpoint-reports.ts');
const workerIndex = source('../worker/index.ts');
const center = source('../src/components/CheckpointCenterPortal.tsx');
const browserContract = source('../tests/e2e/checkpoint-attempt-reservations.spec.ts');
const playwright = source('../playwright.config.ts');
const migration = source('../migrations/0022_checkpoint_attempt_reservations.sql');

for (const marker of [
  'CHECKPOINT_ATTEMPT_GRACE_MINUTES',
  'CHECKPOINT_DURATION_MINUTES',
  'CheckpointAttemptReservation',
  'ownedByCurrentSession',
  'validCheckpointAttemptReservationResponse'
]) {
  assert.ok(contract.includes(marker), `Checkpoint reservation contract is missing ${marker}.`);
}

for (const marker of [
  'checkpointReservationClientRequestId',
  'clearCheckpointReservationClientRequest',
  'crypto.randomUUID()',
  "request('/api/checkpoints/reservations'",
  'CheckpointAttemptReservationUnavailableError',
  'validCheckpointAttemptReservationResponse'
]) {
  assert.ok(client.includes(marker), `Checkpoint reservation client is missing ${marker}.`);
}
assert.match(client, /async function request\([\s\S]*throw new CheckpointAttemptReservationUnavailableError/,
  'Reservation network failures must become an explicit unavailable signal for provisional fallback.');
assert.doesNotMatch(client, /attemptNumber\s*=|Math\.max\([^\n]*attempt/i,
  'Client reservation code must not allocate attempt numbers.');
assert.match(client, /localStorage\.setItem\(pendingKey/,
  'Client request identity must persist before the network request for safe retries.');

for (const marker of [
  'createCheckpointSessionWithCoordination',
  'finishCheckpointSessionWithCoordination',
  "coordination: 'cloud'",
  "coordination: 'provisional'",
  'coordinatedAttemptNumber',
  'reservationId',
  'CheckpointAttemptReservationUnavailableError'
]) {
  assert.ok(coordinatedDomain.includes(marker), `Coordinated checkpoint domain is missing ${marker}.`);
}
assert.match(coordinatedDomain, /const coordinatedSession:[\s\S]*saveCheckpointSession\(coordinatedSession\)/,
  'Cloud reservation metadata must be applied before the local session is persisted.');
assert.match(coordinatedDomain, /const report: CoordinatedCheckpointReport[\s\S]*saveLocalCheckpointReport\(report\)/,
  'Reservation/report identity must be applied before immutable local report save.');
assert.doesNotMatch(coordinatedDomain, /catch[\s\S]{0,500}coordination: 'provisional'[\s\S]{0,250}(?:TypeError|CHECKPOINT_ATTEMPT_BINDING_MISMATCH)/,
  'Malformed or binding-invalid reservation responses must fail closed rather than becoming provisional sessions.');

for (const marker of [
  'await env.DB.batch',
  "SET status = 'expired'",
  'INSERT OR IGNORE INTO checkpoint_attempt_reservations',
  'SELECT MAX(attempt_number)',
  'UNION ALL',
  "code: 'CHECKPOINT_ATTEMPT_ACTIVE'",
  'inserted.meta.changes === 1',
  'ownedByCurrentSession'
]) {
  assert.ok(reservationWorker.includes(marker), `Reservation Worker is missing ${marker}.`);
}
assert.doesNotMatch(reservationWorker, /Math\.max\([^\n]*attempt|attemptNumber\s*=\s*[^\n]*\+\s*1/,
  'Reservation allocation must remain inside D1, never JavaScript read-modify-write.');

for (const marker of [
  "coordination: 'cloud'",
  'reservationId',
  'await env.DB.batch',
  'INSERT OR IGNORE INTO checkpoint_reports',
  'FROM checkpoint_attempt_reservations',
  'completed_report_id = ?',
  'payload_digest = ?',
  "code: 'CHECKPOINT_ATTEMPT_BINDING_MISMATCH'",
  "code: 'CHECKPOINT_ATTEMPT_EXPIRED'",
  'immutableResponse'
]) {
  assert.ok(reportWorker.includes(marker), `Coordinated report Worker is missing ${marker}.`);
}
assert.match(reportWorker, /EXISTS \([\s\S]*FROM checkpoint_reports[\s\S]*payload_digest = \?/,
  'Reservation completion must be guarded by the exact persisted report digest.');
assert.doesNotMatch(reportWorker, /UPDATE checkpoint_reports[\s\S]{0,300}\b(?:status|attempt_number|score|passed|payload)\s*=/,
  'Coordinated completion must preserve append-only report evidence.');

const reservationRoute = workerIndex.indexOf('handleCheckpointAttemptReservationRequest(request');
const coordinatedRoute = workerIndex.indexOf('handleCoordinatedCheckpointReportRequest(request');
const legacyRoute = workerIndex.indexOf('handleCheckpointRequest(request');
assert.ok(reservationRoute >= 0 && coordinatedRoute > reservationRoute && legacyRoute > coordinatedRoute,
  'Authenticated reservation and coordinated report routes must run before the legacy checkpoint endpoint.');
assert.match(workerIndex, /sessionId: auth\.sessionId/,
  'Reservation ownership must bind to the authenticated session.');
assert.match(workerIndex, /deviceName: auth\.deviceName/,
  'Second-device notices must use the authenticated device label.');

for (const marker of [
  'createCheckpointSessionWithCoordination',
  'finishCheckpointSessionWithCoordination',
  'checkpoint-active-reservation-banner',
  'checkpoint-session-coordination',
  'checkpoint-report-coordination',
  'Cloud-coordinated',
  'Provisional offline'
]) {
  assert.ok(center.includes(marker), `Checkpoint Center reservation UI is missing ${marker}.`);
}
assert.doesNotMatch(center, /\/api\/checkpoints\/reservations|MAX\(attempt_number\)|attemptNumber\s*\+\s*1/,
  'React must consume the reservation domain instead of calling or calculating reservation state directly.');

for (const marker of [
  'desktop checkpoint reservation race',
  'mobile checkpoint reservation outage',
  'Promise.all',
  "CHECKPOINT_ATTEMPT_ACTIVE",
  'checkpoint-active-reservation-banner',
  'checkpoint-session-coordination',
  'checkpoint-report-coordination',
  'attemptNumber).toBe(2)',
  'connectionfailed',
  'Provisional offline',
  'AxeBuilder',
  'expectNoOverflow'
]) {
  assert.ok(browserContract.includes(marker), `Checkpoint reservation browser contract is missing ${marker}.`);
}
assert.match(playwright, /desktop checkpoint/,
  'Desktop reservation contract must be selected by Playwright.');
assert.match(playwright, /mobile checkpoint/,
  'Mobile reservation contract must be selected by Playwright.');

for (const marker of [
  'CREATE TABLE IF NOT EXISTS checkpoint_attempt_reservations',
  'UNIQUE(user_id, checkpoint_id, client_request_id)',
  'UNIQUE(user_id, checkpoint_id, attempt_number)',
  'idx_checkpoint_attempt_one_active',
  "WHERE status = 'active'",
  'completed_report_id TEXT UNIQUE REFERENCES checkpoint_reports(id)'
]) {
  assert.ok(migration.includes(marker), `Checkpoint reservation migration is missing ${marker}.`);
}
assert.doesNotMatch(migration, /DELETE FROM checkpoint_reports|UPDATE checkpoint_reports\s+SET attempt_number/i,
  'Reservation migration must not delete or renumber immutable report history.');

console.log('Checkpoint reservation architecture validated: persisted retry identity, D1-owned monotonic allocation, one active attempt, atomic digest-bound completion, explicit provisional mode and raw-API-free React UI.');
