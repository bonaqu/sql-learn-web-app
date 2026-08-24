import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  CLOUDFLARE_DEPLOYMENT_WORKFLOW_NAME,
  cloudflareFailureStatusForWorkflowRun
} from './cloudflare-failure-status-contract.mjs';

const deploymentWorkflow = readFileSync(new URL('../.github/workflows/cloudflare.yml', import.meta.url), 'utf8');
const compensationWorkflow = readFileSync(new URL('../.github/workflows/cloudflare-failure-status.yml', import.meta.url), 'utf8');
const deploymentName = deploymentWorkflow.match(/^name:\s*(.+)$/m)?.[1]?.trim();

assert.equal(deploymentName, CLOUDFLARE_DEPLOYMENT_WORKFLOW_NAME,
  'The compensation contract must track the actual production workflow name.');
assert.match(
  compensationWorkflow,
  new RegExp(`workflows:\\s*\\["${CLOUDFLARE_DEPLOYMENT_WORKFLOW_NAME}"\\]`),
  'workflow_run must watch the actual Cloudflare production workflow.'
);
assert.match(compensationWorkflow, /cloudflareFailureStatusForWorkflowRun/,
  'The workflow must execute the tested compensation contract.');
assert.match(compensationWorkflow, /actions\/checkout@v4/,
  'The workflow must check out the trusted contract before importing it.');

const failedRun = {
  name: CLOUDFLARE_DEPLOYMENT_WORKFLOW_NAME,
  event: 'push',
  conclusion: 'failure',
  headSha: 'a'.repeat(40),
  htmlUrl: 'https://github.com/bonaqu/sql-learn-web-app/actions/runs/123'
};
assert.deepEqual(cloudflareFailureStatusForWorkflowRun(failedRun), {
  sha: 'a'.repeat(40),
  state: 'failure',
  context: 'deployment/cloudflare',
  description: 'Cloudflare deployment failure — open diagnostics',
  target_url: failedRun.htmlUrl
});
assert.equal(cloudflareFailureStatusForWorkflowRun({ ...failedRun, conclusion: 'success' }), null,
  'Successful deployments must not receive compensating failure status.');
assert.equal(cloudflareFailureStatusForWorkflowRun({ ...failedRun, event: 'pull_request' }), null,
  'Non-push workflow runs must not mutate deployment status.');
assert.equal(cloudflareFailureStatusForWorkflowRun({
  ...failedRun,
  name: 'Deploy Cloudflare Full Stack'
}), null, 'The retired wrong workflow name must fail the matcher negative fixture.');
assert.equal(cloudflareFailureStatusForWorkflowRun({
  ...failedRun,
  name: 'Deploy GitHub Pages'
}), null, 'An unrelated deployment must not receive Cloudflare status.');
assert.equal(
  cloudflareFailureStatusForWorkflowRun({ ...failedRun, conclusion: 'timed_out' })?.state,
  'failure',
  'A timed-out production deploy must clear pending status with failure.'
);
assert.throws(
  () => cloudflareFailureStatusForWorkflowRun({ ...failedRun, headSha: 'short' }),
  /head_sha/,
  'Malformed commit identity must fail closed.'
);

process.stdout.write('Cloudflare deployment failure compensation validated: exact workflow watcher, executable failure status and success/wrong-workflow/non-push negative fixtures.\n');
