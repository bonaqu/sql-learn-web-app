import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

function source(path: string) {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

const attemptPolicy = source('../src/lib/checkpoint-attempt-policy.ts');
const checkpoints = source('../src/lib/checkpoints.ts');
const remediation = source('../src/lib/checkpoint-remediation.ts');
const journeyEvidence = source('../src/lib/journey-evidence.ts');
const skillEvidence = source('../src/lib/skill-evidence.ts');
const completeReadiness = source('../src/lib/complete-readiness.ts');
const curriculumAccess = source('../src/lib/curriculum-access.ts');
const learningJourney = source('../src/lib/learning-journey.ts');
const checkpointCenter = source('../src/components/CheckpointCenterPortal.tsx');
const checkpointWorker = source('../worker/checkpoints.ts');
const browserContract = source('../tests/e2e/checkpoint-current-attempt.spec.ts');
const policyDocument = source('../docs/checkpoint-attempt-policy.md');

for (const marker of [
  'normalizeCheckpointAttempt',
  'compareCheckpointAttempts',
  'checkpointAttemptSnapshotFromReports',
  'currentAttempt',
  'historicalBestScore',
  'attemptedCheckpointIds',
  'passedCheckpointIds'
]) {
  assert.ok(attemptPolicy.includes(marker),
    `Canonical checkpoint attempt policy is missing ${marker}.`);
}

for (const marker of [
  'currentCheckpointReport',
  'checkpointAttemptState',
  'return current?.passed === true',
  'compareCheckpointAttempts'
]) {
  assert.ok(checkpoints.includes(marker),
    `Checkpoint eligibility/storage integration is missing ${marker}.`);
}
assert.match(checkpoints, /export function bestCheckpointReport/,
  'Historical best report API must remain available for reporting.');
assert.doesNotMatch(checkpoints, /bestCheckpointReport\(checkpointId, reports\)\?\.passed/,
  'Historical best must not decide current checkpoint pass state.');
assert.doesNotMatch(checkpoints, /legacyCheckpointPassed|progress\.completed/,
  'Checkpoint pass state must never be inferred from mutable task progress.');

assert.match(remediation, /checkpointRemediationsFromAttemptSnapshot/,
  'Remediation must consume the canonical attempt snapshot.');
assert.doesNotMatch(
  remediation,
  /function normalizedReport|compareCheckpointAttempts|right\.completedAt\.localeCompare\(left\.completedAt\)/,
  'Remediation must not normalize or select the latest raw checkpoint attempt again.'
);

for (const marker of [
  'checkpointAttemptSnapshotFromReports',
  'attemptSnapshot.passedCheckpointIds',
  'checkpointRemediationsFromAttemptSnapshot'
]) {
  assert.ok(journeyEvidence.includes(marker),
    `Journey evidence is missing canonical attempt projection ${marker}.`);
}
assert.doesNotMatch(journeyEvidence, /latestByCheckpoint|bestCheckpointReport|completedAt\.localeCompare/,
  'Journey evidence must not calculate current checkpoint state independently.');

for (const marker of [
  'checkpointAttemptSnapshotFromReports',
  'checkpointCurrentScore',
  'checkpointHistoricalBestScore',
  'checkpointAttemptNumber',
  'currentAttempt.passed'
]) {
  assert.ok(skillEvidence.includes(marker),
    `Skill evidence current-attempt projection is missing ${marker}.`);
}
assert.doesNotMatch(skillEvidence, /bestCheckpointReport|bestCompletedModuleCheckpointScore/,
  'Skill evidence must not use historical best as current checkpoint state or score.');
assert.doesNotMatch(skillEvidence, /legacyCheckpointPassed|legacy-checkpoint-task|checkpointSource: 'legacy'/,
  'Skill evidence must not retain a task-completion checkpoint bypass.');

for (const marker of [
  'checkpointAttemptSnapshotFromReports',
  'state?.currentAttempt.passed',
  'reportedCheckpoints',
  'certificateEligible'
]) {
  assert.ok(completeReadiness.includes(marker),
    `Certificate readiness current-attempt projection is missing ${marker}.`);
}
assert.doesNotMatch(completeReadiness, /bestCheckpointReport/,
  'Certificate readiness must not use historical best to satisfy current checkpoint completion.');
assert.doesNotMatch(completeReadiness, /legacyCheckpointPassed|legacyCheckpoints|progress\.completed/,
  'Certificate readiness must not infer checkpoint completion from task history.');

assert.match(curriculumAccess, /currentCheckpointReport\(checkpoint\.id, checkpointReports\)\?\.passed === true/,
  'Curriculum access must use the current checkpoint report.');
assert.doesNotMatch(curriculumAccess, /bestCheckpointReport|legacyCheckpointPassed|checkpointLegacyPassed/,
  'Curriculum access must not use historical best or legacy task completion as a gate.');
assert.match(learningJourney, /return passed\.has\(checkpointId\)/,
  'Journey phase completion must consume only canonical passed checkpoint IDs.');
assert.doesNotMatch(learningJourney, /checkpoint\.taskIds\.every|legacyCheckpointPassed/,
  'Journey phase completion must not reconstruct checkpoint pass from task evidence.');

for (const marker of [
  'checkpointAttemptSnapshotFromReports',
  'checkpoint-current-pass-count',
  'checkpoint-current-score-',
  'checkpoint-historical-best-',
  'checkpoint-report-current-score',
  'checkpoint-report-historical-best'
]) {
  assert.ok(checkpointCenter.includes(marker),
    `Checkpoint Center current/historical UI is missing ${marker}.`);
}
assert.doesNotMatch(checkpointCenter, /history\.filter\(item => item\.passed\)|sort\(\(left, right\) => right\.bestScore/,
  'Checkpoint Center must not infer current pass state from historical passed reports or best-score sorting.');

for (const marker of [
  'LIMIT 50',
  "body.userId !== userId",
  'canonicalEvidenceJson',
  'payload_digest',
  'persisted_at',
  "code: 'CHECKPOINT_REPORT_CONFLICT'",
  'INSERT OR IGNORE INTO checkpoint_reports',
  'inserted.meta.changes !== 1',
  'storedReportResponse'
]) {
  assert.ok(checkpointWorker.includes(marker),
    `Checkpoint Worker deterministic append-only cloud contract is missing ${marker}.`);
}
assert.match(
  checkpointWorker,
  /ORDER BY (?:r\.)?completed_at DESC, (?:r\.)?attempt_number DESC, (?:r\.)?id DESC/,
  'Cloud checkpoint history must apply deterministic completed-at, attempt-number and ID tie-breaks before the bounded limit.'
);
assert.doesNotMatch(checkpointWorker, /ORDER BY (?:r\.)?completed_at DESC LIMIT 50/,
  'Cloud checkpoint history must apply canonical tie-breaks before the bounded limit.');
assert.doesNotMatch(
  checkpointWorker,
  /UPDATE checkpoint_reports[\s\S]{0,320}\b(?:status|started_at|completed_at|duration_seconds|attempt_number|score|best_score|passed|payload)\s*=/,
  'An accepted checkpoint report must never update immutable evidence fields; only receipt metadata may be backfilled.'
);

for (const marker of [
  'desktop checkpoint attempt',
  'mobile checkpoint attempt',
  'checkpoint-current-pass-count',
  'текущая попытка #2: 45%',
  'исторический максимум 91%',
  'checkpoint-report-current-score',
  'checkpoint-report-historical-best',
  'saveCloudReports',
  'loginPage',
  'secondContext',
  '/api/checkpoints/reports',
  'AxeBuilder',
  'expectNoOverflow'
]) {
  assert.ok(browserContract.includes(marker),
    `Checkpoint current-attempt browser contract is missing ${marker}.`);
}

for (const marker of [
  'current attempt state',
  'historical best',
  'latest `completedAt`',
  'Migration and integrity boundary',
  'There is no inferred checkpoint pass',
  'certificate eligibility',
  'ORDER BY completed_at DESC, attempt_number DESC, id DESC',
  'second authenticated browser'
]) {
  assert.ok(policyDocument.includes(marker),
    `Checkpoint attempt policy documentation is missing ${marker}.`);
}

console.log('Checkpoint attempt architecture validated: one current-state snapshot, historical best reporting only, concurrent-safe append-only cloud history, current eligibility/readiness/certificate gates and explicit desktop/mobile/second-device UI contracts.');
