import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

function source(path: string) {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

const attemptPolicy = source('../src/lib/checkpoint-attempt-policy.ts');
const remediation = source('../src/lib/checkpoint-remediation.ts');
const evidence = source('../src/lib/journey-evidence.ts');
const journey = source('../src/lib/learning-journey.ts');
const guidedHome = source('../src/components/GuidedHome.tsx');
const learningPath = source('../src/components/LearningPathPortal.tsx');
const goalSwitch = source('../src/lib/goal-switch.ts');
const workspace = source('../src/App.tsx');
const playwright = source('../playwright.config.ts');
const browserContract = source('../tests/e2e/checkpoint-remediation.spec.ts');
const journeyContract = source('../docs/learning-journey-contract.md');

for (const marker of [
  'normalizeCheckpointAttempt',
  "item.status !== 'completed'",
  'item.userId !== expectedUserId',
  'compareCheckpointAttempts',
  'checkpointAttemptSnapshotFromReports',
  'historicalBestScore',
  'currentAttempt',
  'attemptedCheckpointIds',
  'passedCheckpointIds'
]) {
  assert.ok(attemptPolicy.includes(marker),
    `Canonical checkpoint attempt policy is missing ${marker}.`);
}

for (const marker of [
  'checkpointRemediationsFromAttemptSnapshot',
  'attemptState.currentAttempt',
  'moduleScoreMap',
  'weakTaskMap',
  'checkpointRemediationsFromReports',
  'unresolvedCheckpointRemediationModules',
  'nextCheckpointRemediationStep',
  'discriminatingTaskId',
  'transferTaskId',
  'timestamp > Date.parse(after)'
]) {
  assert.ok(remediation.includes(marker),
    `Checkpoint remediation domain ownership is missing ${marker}.`);
}
assert.doesNotMatch(remediation, /function normalizedReport|\.sort\(compareCheckpointAttempts\)|item\.status !== 'completed'/,
  'Remediation must consume the canonical current attempt instead of normalizing or sorting reports again.');

for (const marker of [
  'checkpointAttemptSnapshotFromReports',
  'attemptSnapshot.passedCheckpointIds',
  'checkpointRemediationsFromAttemptSnapshot'
]) {
  assert.ok(evidence.includes(marker),
    `Lightweight checkpoint evidence is missing canonical snapshot projection ${marker}.`);
}
assert.doesNotMatch(evidence, /latestByCheckpoint|report\.passed !== true|completedAt\.localeCompare|checkpointRemediationsFromReports/,
  'Journey evidence must not duplicate latest-attempt sorting or remediation normalization.');

for (const marker of [
  "'checkpoint-remediation'",
  'passedCheckpointIds',
  'allCheckpointRemediations',
  'withRemediation',
  'checkpointRemediation',
  'unresolvedCheckpointRemediationModules'
]) {
  assert.ok(journey.includes(marker),
    `Canonical Journey remediation frontier is missing ${marker}.`);
}
assert.doesNotMatch(journey, /checkpoint\.taskIds\.every|legacyCheckpointPassed/,
  'Journey remediation and pass gates must not reconstruct checkpoint state from task progress.');

assert.match(guidedHome, /frontier\.checkpointRemediation/,
  'Today must consume normalized remediation from the Journey frontier.');
assert.match(guidedHome, /guided-checkpoint-remediation/,
  'Today must expose the failed checkpoint state to browser contracts.');
assert.doesNotMatch(guidedHome, /checkpointRemediationsFromReports|moduleScores|taskScores|remediationModules|completedAt\.localeCompare/,
  'Today must not interpret raw checkpoint reports.');

assert.match(learningPath, /checkpointRemediationsFromReports/,
  'Learning Path must delegate raw report normalization to the evidence domain until it consumes the shared attempt snapshot directly.');
assert.match(learningPath, /checkpoint-remediation-banner/,
  'Learning Path must expose normalized remediation state.');
assert.doesNotMatch(learningPath, /moduleScores|taskScores|remediationModules|completedAt\.localeCompare/,
  'Learning Path must not inspect raw checkpoint scoring or attempt ordering.');

assert.match(goalSwitch, /checkpointRemediations/,
  'Goal preview must receive active remediation evidence.');
assert.doesNotMatch(goalSwitch, /moduleScores|taskScores|remediationModules|completedAt\.localeCompare/,
  'Goal preview must not interpret raw checkpoint reports.');

assert.doesNotMatch(workspace, /checkpointRemediationsFromReports|moduleScores|taskScores|remediationModules/,
  'Workspace must consume Journey metadata instead of checkpoint report internals.');

assert.match(playwright, /desktop failed checkpoint/,
  'Desktop remediation browser contract must be included in a Playwright project.');
assert.match(playwright, /mobile failed checkpoint/,
  'Mobile remediation browser contract must be included in a Playwright project.');
for (const marker of [
  'guided-checkpoint-remediation',
  'checkpoint-remediation-banner',
  'goal-switch-proposed-action',
  "data-route-reason', 'checkpoint-remediation'",
  "data-stage', 'checkpoint'",
  "data-stage', 'practice'",
  'completeRemediationTask',
  'discriminatingTaskTitle',
  'transferTaskTitle',
  'outOfOrder',
  'appendPassedReport',
  'AxeBuilder',
  'expectNoOverflow'
]) {
  assert.ok(browserContract.includes(marker),
    `Checkpoint remediation browser contract is missing ${marker}.`);
}

for (const marker of [
  'latest completed attempt',
  'bestScore',
  'Raw checkpoint report fields',
  'failed→discriminate→transfer→retry→pass'
]) {
  assert.ok(journeyContract.includes(marker),
    `Learning journey contract is missing remediation rule ${marker}.`);
}

console.log('Checkpoint remediation architecture validated: one attempt normalizer, one remediation projection, one frontier and raw-report-free UI decisions.');
