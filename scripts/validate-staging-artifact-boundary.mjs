import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workflow = readFileSync(new URL('../.github/workflows/cloudflare-staging.yml', import.meta.url), 'utf8')
  .replace(/\r\n/g, '\n');

for (const temporaryPath of [
  'D1_LIST_PATH="$RUNNER_TEMP/sql-academy-staging-d1-list.json"',
  'KV_LIST_PATH="$RUNNER_TEMP/sql-academy-staging-kv-list.json"',
  'SECRET_LIST_PATH="$RUNNER_TEMP/sql-academy-staging-secret-list.json"'
]) {
  assert.ok(workflow.includes(temporaryPath), `Sensitive staging inventory must use RUNNER_TEMP: ${temporaryPath}`);
}
for (const cleanup of [
  `trap 'rm -f "$D1_LIST_PATH" "$KV_LIST_PATH"' EXIT`,
  `trap 'rm -f "$SECRET_LIST_PATH"' EXIT`
]) {
  assert.ok(workflow.includes(cleanup), `Sensitive staging inventory cleanup is missing: ${cleanup}`);
}

const failureUploadStart = workflow.indexOf('- name: Upload staging failure diagnostics');
assert.ok(failureUploadStart >= 0, 'Staging failure diagnostics step is missing');
const failureUpload = workflow.slice(failureUploadStart);
for (const forbiddenPath of [
  'sql-academy-staging-d1-list.json',
  'sql-academy-staging-kv-list.json',
  'sql-academy-staging-secret-list.json',
  'wrangler.staging.deploy.jsonc'
]) {
  assert.ok(!failureUpload.includes(forbiddenPath), `Failure artifacts must not include ${forbiddenPath}`);
}
assert.ok(failureUpload.includes('staging-render-metadata.json') || failureUpload.includes('staging-*.json'));
assert.ok(workflow.includes('resourceIsolation: { d1: true, kv: true }'));
assert.ok(workflow.includes('rm -f "$D1_LIST_PATH" "$KV_LIST_PATH"'));
assert.ok(workflow.includes('rm -f "$SECRET_LIST_PATH"'));

console.log('Staging artifact boundary validated: Cloudflare resource IDs and full Worker secret inventories stay in RUNNER_TEMP and out of success/failure artifacts.');
