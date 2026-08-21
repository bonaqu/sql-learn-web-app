import {
  mergeEvidenceReports,
  reportsToUpload,
  type SyncableEvidenceReport
} from '../src/lib/evidence-sync.ts';
import { mergeProgress, reconcileProgress, taskXp, type ProgressSyncApi } from '../src/lib/auth.ts';
import { tasks } from '../src/data/course-catalog.ts';
import {
  defaultProgress,
  DURABLE_MASTERY_EVIDENCE_VERSION,
  hasDurableTaskEvidence,
  migrateProgress,
  type Progress
} from '../src/lib/progress.ts';
import core from '../worker/core.ts';
import { validMasteryProgressPayload } from '../worker/mastery-progress.ts';

const failures: string[] = [];
const assert = (condition: unknown, message: string) => { if (!condition) failures.push(message); };

for (const task of tasks) {
  assert(taskXp(task.id) === task.xp, `Lightweight auth XP contract differs for ${task.id}: ${taskXp(task.id)} !== ${task.xp}`);
}

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

const oldProgress = migrateProgress({
  version: 3,
  completed: ['task-001'],
  taskStats: { 'task-001': { attempts: 1, incorrect: 0, hintsUsed: 0, completedAt: '2026-07-20T10:00:00.000Z' } },
  xp: 10,
  streak: 1,
  history: defaultProgress.history
});
assert(oldProgress.completed.includes('task-001'), 'Old progress migration must preserve completion history');
assert(!hasDurableTaskEvidence(oldProgress, 'task-001', Date.parse('2026-08-11T10:00:00.000Z')),
  'Old progress migration must not fabricate durable evidence');
assert(validMasteryProgressPayload(oldProgress), 'D1 progress contract must continue accepting migrated old-client payloads');

const durableLocal = structuredClone(defaultProgress);
durableLocal.completed = ['task-001', 'task-002', 'task-004', 'task-005'];
durableLocal.taskStats = {
  'task-001': { attempts: 1, incorrect: 0, hintsUsed: 0, independentPasses: 1, lastIndependentAt: '2026-08-10T09:00:00.000Z' },
  'task-002': {
    attempts: 1, incorrect: 0, hintsUsed: 0,
    retrievalEvidenceVersion: DURABLE_MASTERY_EVIDENCE_VERSION,
    retrievalSourceTaskId: 'task-001', retrievalScheduledAt: '2026-08-10T09:00:00.000Z',
    retrievalDueAt: '2026-08-12T09:10:00.000Z', retrievalIntervalDays: 1,
    retrievalSuccesses: 1, retrievalLapses: 0, lastRetrievalAt: '2026-08-11T09:10:00.000Z',
    lastRetrievalPassed: true, durableEvidenceAt: '2026-08-11T09:10:00.000Z', durableUntil: '2026-08-12T09:10:00.000Z'
  },
  'task-004': { attempts: 1, incorrect: 0, hintsUsed: 0, independentPasses: 1, lastIndependentAt: '2026-08-10T08:00:00.000Z' },
  'task-005': {
    attempts: 1, incorrect: 0, hintsUsed: 0,
    retrievalEvidenceVersion: DURABLE_MASTERY_EVIDENCE_VERSION,
    retrievalSourceTaskId: 'task-004', retrievalScheduledAt: '2026-08-10T08:00:00.000Z',
    retrievalDueAt: '2026-08-12T08:10:00.000Z', retrievalIntervalDays: 1,
    retrievalSuccesses: 1, lastRetrievalAt: '2026-08-11T08:10:00.000Z', lastRetrievalPassed: true,
    durableEvidenceAt: '2026-08-11T08:10:00.000Z', durableUntil: '2026-08-12T08:10:00.000Z'
  }
};
const failedRemote = structuredClone(durableLocal);
failedRemote.taskStats['task-002'] = {
  ...failedRemote.taskStats['task-002'],
  incorrect: 1,
  retrievalDueAt: '2026-08-11T10:10:00.000Z',
  retrievalIntervalDays: 0,
  retrievalLapses: 1,
  lastRetrievalAt: '2026-08-11T10:00:00.000Z',
  lastRetrievalPassed: false,
  durableEvidenceAt: undefined,
  durableUntil: undefined
};
const conservativeMerge = mergeProgress(durableLocal, failedRemote);
assert(conservativeMerge.taskStats['task-002'].lastRetrievalPassed === false
    && conservativeMerge.taskStats['task-002'].durableEvidenceAt === undefined,
  'Multi-device merge must not let stale success overwrite a newer retrieval failure');
assert(conservativeMerge.taskStats['task-005'].lastRetrievalPassed === true,
  'Relevant failure must not erase unrelated concept evidence');
assert(validMasteryProgressPayload(conservativeMerge),
  'D1 progress contract must accept the new evidence-versioned retrieval payload');
const forgedDurable = structuredClone(conservativeMerge);
forgedDurable.taskStats['task-002'] = {
  ...forgedDurable.taskStats['task-002'],
  retrievalSourceTaskId: 'task-002',
  lastRetrievalPassed: true,
  durableEvidenceAt: '2026-08-11T11:00:00.000Z',
  durableUntil: '2026-08-11T10:00:00.000Z'
};
assert(!validMasteryProgressPayload(forgedDurable),
  'D1 progress contract must reject self-referential or backward durable evidence');
const stretchedDurable = structuredClone(durableLocal);
stretchedDurable.taskStats['task-002'].retrievalDueAt = '2026-09-11T09:10:00.000Z';
stretchedDurable.taskStats['task-002'].durableUntil = '2026-09-11T09:10:00.000Z';
assert(!validMasteryProgressPayload(stretchedDurable),
  'D1 progress contract must reject durable windows outside the deterministic interval ladder');
const arbitraryRetry = structuredClone(failedRemote);
arbitraryRetry.taskStats['task-002'].retrievalDueAt = '2026-08-11T10:11:00.000Z';
assert(!validMasteryProgressPayload(arbitraryRetry),
  'D1 progress contract must reject retry delays outside the deterministic bounded ladder');

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

process.stdout.write(`Evidence sync validated: ${tasks.length} task XP values, ${merged.length} deterministic reports, ${upload.length} uploads, CAS timeline ${timeline.join(' | ')}, fail-closed legacy PUT and stable offline evidence.\n`);
