import assert from 'node:assert/strict';
import {
  checkpointReceiptForReport,
  loadCheckpointReportReceipts,
  mergeCheckpointReportReceipts,
  saveCheckpointReportReceipt,
  saveCheckpointReportReceipts
} from '../src/lib/checkpoint-report-receipts';
import { CheckpointReportConflictError } from '../src/lib/checkpoint-report-integrity';

const storage = new Map<string, string>();
let writes = 0;
let events = 0;
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem(key: string) { return storage.get(key) ?? null; },
    setItem(key: string, value: string) { writes += 1; storage.set(key, value); },
    removeItem(key: string) { storage.delete(key); },
    clear() { storage.clear(); }
  }
});
Object.defineProperty(globalThis, 'window', {
  configurable: true,
  value: { dispatchEvent() { events += 1; return true; } }
});
Object.defineProperty(globalThis, 'CustomEvent', {
  configurable: true,
  value: class<T> {
    constructor(readonly type: string, readonly init?: { detail?: T }) {}
  }
});

const userId = 'checkpoint-receipt-validator';
const first = {
  version: 1 as const,
  reportId: 'a0000000-0000-0000-0000-000000000001',
  checkpointId: 'checkpoint-foundation',
  persistedAt: '2026-08-03T22:30:00.000Z',
  payloadDigest: 'a'.repeat(64)
};
const second = {
  version: 1 as const,
  reportId: 'b0000000-0000-0000-0000-000000000002',
  checkpointId: 'checkpoint-query-design',
  persistedAt: '2026-08-03T22:40:00.000Z',
  payloadDigest: 'b'.repeat(64)
};

assert.deepEqual(loadCheckpointReportReceipts(userId), []);
const saved = saveCheckpointReportReceipt(userId, first);
assert.deepEqual(saved, [first]);
assert.equal(writes, 1);
assert.equal(events, 1);
const rawAfterFirst = storage.get(`sql-academy-checkpoint-receipts-v1:${userId}`);

const replay = saveCheckpointReportReceipt(userId, { ...first });
assert.deepEqual(replay, [first]);
assert.equal(writes, 1, 'Exact receipt replay must not rewrite storage.');
assert.equal(events, 1, 'Exact receipt replay must not dispatch a duplicate event.');
assert.equal(storage.get(`sql-academy-checkpoint-receipts-v1:${userId}`), rawAfterFirst);

assert.throws(
  () => saveCheckpointReportReceipt(userId, { ...first, payloadDigest: 'c'.repeat(64) }),
  (error: unknown) => error instanceof CheckpointReportConflictError
    && error.location === 'receipt-storage'
    && error.reportId === first.reportId
);
assert.equal(writes, 1);
assert.equal(events, 1);
assert.equal(storage.get(`sql-academy-checkpoint-receipts-v1:${userId}`), rawAfterFirst);

const merged = saveCheckpointReportReceipts(userId, [second, { ...first }]);
assert.deepEqual(merged.map(item => item.reportId), [second.reportId, first.reportId]);
assert.equal(writes, 2);
assert.equal(events, 2);
assert.equal(checkpointReceiptForReport(first.reportId, merged)?.payloadDigest, first.payloadDigest);
assert.equal(checkpointReceiptForReport('missing', merged), null);

assert.throws(
  () => mergeCheckpointReportReceipts([first], [{ ...first, persistedAt: '2026-08-03T22:31:00.000Z' }]),
  (error: unknown) => error instanceof CheckpointReportConflictError
    && error.location === 'receipt-merge'
);
assert.throws(
  () => saveCheckpointReportReceipts(userId, [{ ...second, payloadDigest: 'd'.repeat(64) }]),
  (error: unknown) => error instanceof CheckpointReportConflictError
    && error.location === 'receipt-merge'
    && error.reportId === second.reportId
);
assert.equal(writes, 2);
assert.equal(events, 2);

console.log('Checkpoint receipt storage validated: immutable first receipt, exact replay no-op, typed digest/timestamp conflicts, deterministic merge and report lookup.');
