import {
  mergeEvidenceReports,
  reportsToUpload,
  type SyncableEvidenceReport
} from '../src/lib/evidence-sync.ts';

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

if (failures.length) {
  console.error(`Evidence sync validation failed with ${failures.length} issue(s):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Evidence sync validated: ${merged.length} deterministic reports, ${upload.length} uploads and stable no-loop reconciliation.`);
