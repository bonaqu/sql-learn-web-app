import {
  mergeEvidenceReports,
  reportsToUpload,
  type SyncableEvidenceReport
} from '../src/lib/evidence-sync.ts';
import { reconcileProgress, type ProgressSyncApi } from '../src/lib/auth.ts';
import { defaultProgress, type Progress } from '../src/lib/progress.ts';
import core from '../worker/core.ts';

const failures: string[] = [];
const assert = (condition: unknown, message: string) => { if (!condition) failures.push(message); };

type Fixture = SyncableEvidenceReport & {
  score: number;
  detail?: string;
};

const local: Fixture[] = [
  { id: 'local-only', completedAt: '2026-07-25T10:00:00.000Z', score: 70 },
  { id: 'remote-newer', completedAt: '2026-07-25T10:00:00.000Z', score: 60 },
  { id: 'local-newer', completedAt: '2026-07-25T12:00:00.000Z', score: 90 },
  { id: 'same-time-richer', completedAt: '2026-07-25T11:00:00.000Z', score: 80, detail: 'AI debrief retained' }
];
const remote: Fixture[] = [
  { id: 'remote-only', completedAt: '2026-07-25T09:00:00.000Z', score: 50 },
  { id: 'remote-newer', completedAt: '2026-07-25T11:00:00.000Z', score: 75 },
  { id: 'local-newer', completedAt: '2026-07-25T11:00:00.000Z', score: 65 },
  { id: 'same-time-richer', completedAt: '2026-07-25T11:00:00.000Z', score: 80 }
];

const merged = mergeEvidenceReports(local, remote, 20);
assert(merged.length === 5, `Expected 5 merged reports, got ${merged.length}`);
assert(merged[0]?.id === 'local-newer', 'Merged reports must use deterministic descending completedAt order');
assert(merged.find(report => report.id === 'remote-newer')?.score === 75, 'Newer remote report must win');
assert(merged.find(report => report.id === 'local-newer')?.score === 90, 'Newer local report must win');
assert(merged.find(report => report.id === 'same-time-richer')?.detail === 'AI debrief retained', 'Richer same-time report must win deterministically');

const upload = reportsToUpload(local, remote).map(report => report.id).sort();
assert(JSON.stringify(upload) === JSON.stringify(['local-newer', 'local-only', 'same-time-richer']), `Unexpected upload set: ${upload.join(', ')}`);

const stableLocal = mergeEvidenceReports(local, remote, 20);
const stableRemote = mergeEvidenceReports(local, remote, 20);
assert(reportsToUpload(stableLocal, stableRemote).length === 0, 'Reconciled evidence must not create an upload loop');
assert(mergeEvidenceReports(merged, merged, 3).length === 3, 'Evidence history limit must be enforced');
assert(new Set(merged.map(report => report.id)).size === merged.length, 'Merged evidence IDs must be unique');

function progressFor(taskId: string, completedAt: string): Progress {
  return {
    ...defaultProgress,
    completed: [taskId],
    taskStats: {
      [taskId]: {
        attempts: 1,
        incorrect: 0,
        hintsUsed: 0,
        independentPasses: 1,
        lastIndependentAt: completedAt,
        lastAttemptAt: completedAt,
        completedAt
      }
    },
    history: defaultProgress.history.map(point => ({ ...point })),
    lastTask: taskId,
    lastStudyDate: completedAt.slice(0, 10)
  };
}

const deviceA = progressFor('task-001', '2026-07-25T10:00:00.000Z');
const deviceB = progressFor('task-002', '2026-07-25T11:00:00.000Z');
let cloudProgress: Progress | null = null;
let cloudRevision = 0;
let injectedConcurrentWrite = false;
const timeline: string[] = [];
const api: ProgressSyncApi = {
  async read() {
    timeline.push(`GET r${cloudRevision}`);
    return {
      progress: cloudProgress ? structuredClone(cloudProgress) : null,
      revision: cloudRevision,
      updatedAt: cloudRevision ? `2026-07-25T1${cloudRevision}:00:00.000Z` : null
    };
  },
  async write(progress, baseRevision) {
    if (!injectedConcurrentWrite) {
      injectedConcurrentWrite = true;
      cloudProgress = structuredClone(deviceA);
      cloudRevision = 1;
      timeline.push(`PUT base=${baseRevision} -> 409/r${cloudRevision}`);
      const conflict = new Error('Progress conflict') as Error & { status?: number };
      conflict.status = 409;
      throw conflict;
    }
    if (baseRevision !== cloudRevision) throw new Error(`Unexpected base revision ${baseRevision}, expected ${cloudRevision}`);
    cloudProgress = structuredClone(progress);
    cloudRevision += 1;
    timeline.push(`PUT base=${baseRevision} -> 200/r${cloudRevision}`);
    return {
      ok: true,
      progress: structuredClone(progress),
      revision: cloudRevision,
      updatedAt: '2026-07-25T12:00:00.000Z'
    };
  }
};

const deviceBBefore = JSON.stringify(deviceB);
const reconciled = await reconcileProgress(deviceB, api);
assert(timeline.join(' | ') === 'GET r0 | PUT base=0 -> 409/r1 | GET r1 | PUT base=1 -> 200/r2',
  `Unexpected two-device CAS timeline: ${timeline.join(' | ')}`);
assert(reconciled.revision === 2 && reconciled.wrote, 'Conflict recovery must write one new canonical revision');
assert(JSON.stringify(reconciled.progress.completed) === JSON.stringify(['task-001', 'task-002']),
  'Conflict recovery must preserve the union of device evidence');
assert(JSON.stringify(deviceB) === deviceBBefore, 'Reconciliation must not mutate local evidence in place');

let noOpWrites = 0;
const noOp = await reconcileProgress(reconciled.progress, {
  async read() {
    return { progress: structuredClone(reconciled.progress), revision: 7, updatedAt: '2026-07-25T13:00:00.000Z' };
  },
  async write() {
    noOpWrites += 1;
    throw new Error('No-op reconciliation must not write');
  }
});
assert(noOp.revision === 7 && !noOp.wrote && noOpWrites === 0,
  'Already-canonical evidence must not increment the revision');

const networkFailureBefore = JSON.stringify(deviceB);
let networkFailureObserved = false;
try {
  await reconcileProgress(deviceB, {
    async read() { throw new Error('network unavailable'); },
    async write() { throw new Error('unreachable'); }
  });
} catch {
  networkFailureObserved = true;
}
assert(networkFailureObserved && JSON.stringify(deviceB) === networkFailureBefore,
  'Network failure must leave local evidence unchanged and unsynced');

let legacyDatabaseCalls = 0;
const legacyResponse = await core.fetch(new Request('https://academy.test/api/progress', {
  method: 'PUT',
  headers: { 'content-type': 'application/json', 'x-profile-id': 'cached_client_123' },
  body: JSON.stringify(defaultProgress)
}), {
  DB: {
    prepare() {
      legacyDatabaseCalls += 1;
      throw new Error('Legacy PUT must fail before D1 mutation');
    }
  }
} as unknown as Cloudflare.Env);
const legacyPayload = await legacyResponse.json() as { code?: string };
assert(legacyResponse.status === 428 && legacyPayload.code === 'PROGRESS_REVISION_REQUIRED',
  `Legacy direct PUT must require a revision, got HTTP ${legacyResponse.status}`);
assert(legacyDatabaseCalls === 0, 'Rejected legacy PUT must not read or mutate D1');

if (failures.length) {
  console.error(`Evidence sync validation failed with ${failures.length} issue(s):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Evidence sync validated: ${merged.length} deterministic reports, ${upload.length} uploads, CAS timeline ${timeline.join(' | ')}, fail-closed legacy PUT and stable offline evidence.`);
