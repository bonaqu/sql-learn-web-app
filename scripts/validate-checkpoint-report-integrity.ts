import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  canonicalEvidenceJson,
  checkpointConflictMessage,
  CheckpointReportConflictError,
  sameImmutableCheckpointReport,
  validCheckpointReportReceipt
} from '../src/lib/checkpoint-report-integrity';

const first = {
  version: 1,
  id: 'a0000000-0000-0000-0000-000000000001',
  checkpointId: 'checkpoint-foundation',
  score: 91,
  passed: true,
  nested: { b: 2, a: 1 },
  values: [{ z: false, a: null }, 0]
};
const reordered = {
  values: [{ a: null, z: false }, -0],
  nested: { a: 1, b: 2 },
  passed: true,
  score: 91,
  checkpointId: 'checkpoint-foundation',
  id: 'a0000000-0000-0000-0000-000000000001',
  version: 1
};
assert.equal(canonicalEvidenceJson(first), canonicalEvidenceJson(reordered),
  'Canonical evidence JSON must ignore object key insertion order and normalize negative zero.');
assert.equal(sameImmutableCheckpointReport(first, reordered), true);
assert.equal(sameImmutableCheckpointReport(first, { ...reordered, score: 90 }), false,
  'Changing score must create an immutable report conflict.');
assert.equal(sameImmutableCheckpointReport(first, { ...reordered, passed: false }), false,
  'Changing pass state must create an immutable report conflict.');
assert.equal(sameImmutableCheckpointReport(first, { ...reordered, id: 'b0000000-0000-0000-0000-000000000002' }), false);
assert.throws(() => canonicalEvidenceJson({ invalid: Number.NaN }), /non-finite number/);
assert.throws(() => canonicalEvidenceJson({ invalid: BigInt(1) }), /unsupported bigint/);

const conflict = new CheckpointReportConflictError(first.id, 'local-cloud-merge');
assert.equal(conflict.code, 'CHECKPOINT_REPORT_CONFLICT');
assert.equal(conflict.reportId, first.id);
assert.match(checkpointConflictMessage(conflict) || '', /immutable checkpoint report/);
assert.equal(checkpointConflictMessage(new Error('other')), null);

const receipt = {
  version: 1,
  reportId: first.id,
  checkpointId: first.checkpointId,
  persistedAt: '2026-08-03T22:30:00.000Z',
  payloadDigest: 'a'.repeat(64)
};
assert.equal(validCheckpointReportReceipt(receipt), true);
assert.equal(validCheckpointReportReceipt({ ...receipt, payloadDigest: 'not-a-digest' }), false);
assert.equal(validCheckpointReportReceipt({ ...receipt, persistedAt: 'invalid' }), false);

const worker = readFileSync(new URL('../worker/checkpoints.ts', import.meta.url), 'utf8');
for (const marker of [
  'canonicalEvidenceJson',
  "crypto.subtle.digest('SHA-256'",
  'CHECKPOINT_REPORT_CONFLICT',
  'CHECKPOINT_REPORT_STORED_INVALID',
  'CHECKPOINT_REPORT_PERSISTENCE_FAILED',
  'payload_digest',
  'persisted_at',
  'receipts',
  'INSERT OR IGNORE INTO checkpoint_reports',
  'inserted.meta.changes !== 1',
  'storedReportResponse',
  'const persisted = await storedReport(env, body.id)'
]) {
  assert.ok(worker.includes(marker), `Checkpoint Worker immutable report contract is missing ${marker}.`);
}
assert.match(
  worker,
  /ORDER BY (?:r\.)?completed_at DESC, (?:r\.)?attempt_number DESC, (?:r\.)?id DESC/,
  'Checkpoint Worker immutable report contract must preserve deterministic canonical history ordering.'
);
assert.doesNotMatch(worker, /UPDATE checkpoint_reports SET\s*checkpoint_id|SET\s+checkpoint_id = \?/,
  'Completed checkpoint evidence columns must never be updated after the first accepted report ID.');
assert.match(worker, /SET payload_digest = \?, persisted_at = COALESCE\(persisted_at, \?\)/,
  'Legacy replay may backfill receipt metadata without rewriting evidence.');
assert.match(worker, /storedDigest !== incomingDigest/,
  'Same-ID replay must compare canonical payload digests.');
assert.doesNotMatch(worker, /error:[^\n]*existing\.payload|JSON\.stringify\(existing/,
  'Conflict responses must not expose stored payloads.');
assert.doesNotMatch(worker, /INSERT INTO checkpoint_reports\(/,
  'Checkpoint report creation must use INSERT OR IGNORE so concurrent exact requests become idempotent replays.');

const migration = readFileSync(new URL('../migrations/0021_checkpoint_report_receipts.sql', import.meta.url), 'utf8');
for (const marker of [
  'ADD COLUMN payload_digest TEXT',
  'ADD COLUMN persisted_at TEXT',
  'COALESCE(persisted_at, created_at, updated_at, completed_at)',
  'idx_checkpoint_reports_canonical_history'
]) {
  assert.ok(migration.includes(marker), `Checkpoint receipt migration is missing ${marker}.`);
}
assert.doesNotMatch(migration, /DELETE FROM checkpoint_reports|UPDATE checkpoint_reports\s+SET attempt_number|UNIQUE\s*\(user_id, checkpoint_id, attempt_number\)/i,
  'Receipt migration must not delete or destructively renumber legacy checkpoint evidence.');

const productionSmoke = readFileSync(new URL('./checkpoint-production-smoke.mjs', import.meta.url), 'utf8');
for (const marker of [
  'checkpoint-report-exact-replay',
  'checkpoint-report-mutation-conflict',
  "savedPayload.replayed !== false",
  "replayPayload.replayed !== true",
  "conflictPayload.code !== 'CHECKPOINT_REPORT_CONFLICT'",
  "stored.score !== 92",
  'JSON.stringify(storedReceipt) !== JSON.stringify(originalReceipt)',
  'immutableReceiptVerified: true',
  'exactReplayVerified: true',
  'mutationConflictVerified: true'
]) {
  assert.ok(productionSmoke.includes(marker), `Checkpoint production immutable lifecycle is missing ${marker}.`);
}
assert.doesNotMatch(productionSmoke, /writeJson\([^\n]*(?:taskScores|moduleScores|payloadDigest)(?!Prefix)/,
  'Production smoke artifacts must not write complete checkpoint evidence or receipt digests.');

console.log('Checkpoint report integrity validated: canonical equality, typed conflicts, stable receipts, concurrent-safe append-only Worker semantics, non-destructive legacy migration and deployed replay/conflict smoke coverage.');
