import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const read = path => readFileSync(resolve(root, path), 'utf8').replace(/\r\n/g, '\n');
const contract = JSON.parse(read('config/staging-environment.json'));
const template = JSON.parse(read('wrangler.staging.example.jsonc'));
const workflow = read('.github/workflows/cloudflare-staging.yml');
const deploymentGuide = read('docs/buyer-cloudflare-deployment.md');
const transferChecklist = read('docs/transfer-acceptance-checklist.md');
const productionHealth = read('.github/workflows/production-health.yml');

assert.equal(contract.contract, 'cloudflare-staging-environment-v1');
assert.equal(contract.githubEnvironment, 'staging');
assert.deepEqual(contract.resources, {
  workerName: 'sql-learn-web-app-staging',
  d1DatabaseName: 'sql-academy-staging',
  kvNamespaceTitle: 'sql-academy-settings-staging'
});
assert.notEqual(contract.resources.workerName, 'sql-learn-web-app');
assert.notEqual(contract.resources.d1DatabaseName, 'sql-academy');
assert.notEqual(contract.resources.kvNamespaceTitle, 'sql-academy-settings');
assert.deepEqual(contract.requiredGithubEnvironmentSecrets.sort(), [
  'CLOUDFLARE_ACCOUNT_ID',
  'CLOUDFLARE_API_TOKEN'
]);
assert.deepEqual(contract.requiredGithubEnvironmentVariables.sort(), [
  'STAGING_ALLOWED_ORIGINS',
  'STAGING_EXPECTED_ORIGIN'
]);
assert.equal(contract.externalProviderBoundaryIssue, 133);
for (const flag of [
  'FEATURE_EMAIL_VERIFICATION',
  'FEATURE_SMS_VERIFICATION',
  'FEATURE_TURNSTILE',
  'FEATURE_ADMIN_CONSOLE',
  'FEATURE_ADMIN_ALERTS'
]) assert.equal(contract.safeDefaults[flag], 'off', `${flag} must default off in app staging`);

assert.equal(template.name, contract.resources.workerName);
assert.equal(template.main, 'worker/entrypoint.ts');
assert.deepEqual(template.triggers?.crons, []);
assert.equal(template.d1_databases?.[0]?.database_name, contract.resources.d1DatabaseName);
assert.equal(template.d1_databases?.[0]?.database_id, '00000000-0000-0000-0000-000000000000');
assert.equal(template.kv_namespaces?.[0]?.id, '00000000000000000000000000000000');
assert.equal(template.vars?.ALLOWED_ORIGINS, 'https://staging.example.com');
for (const [name, value] of Object.entries(contract.safeDefaults)) {
  assert.equal(template.vars?.[name], value, `Staging example drifted from safe default ${name}`);
}
const templateText = read('wrangler.staging.example.jsonc');
for (const forbidden of [
  'API_TOKEN',
  'API_KEY',
  'WEBHOOK_SECRET',
  'SIGNING_SECRET',
  'TURNSTILE_SECRET',
  'RECOVERY_CODE',
  'PASSWORD'
]) assert.ok(!templateText.includes(forbidden), `Staging template contains secret-shaped field ${forbidden}`);

const temp = mkdtempSync(join(tmpdir(), 'sql-academy-staging-'));
try {
  const output = join(temp, 'wrangler.staging.deploy.jsonc');
  const sampleEnvironment = {
    ...process.env,
    D1_ID: '11111111-1111-4111-8111-111111111111',
    KV_ID: '0123456789abcdef0123456789abcdef',
    STAGING_ALLOWED_ORIGINS: 'https://staging.example.com,https://review.example.com',
    STAGING_EXPECTED_ORIGIN: 'https://staging.example.com'
  };
  const rendered = spawnSync(process.execPath, [
    resolve(root, 'scripts/render-staging-wrangler.mjs'),
    '--output',
    output
  ], { cwd: root, env: sampleEnvironment, encoding: 'utf8' });
  assert.equal(rendered.status, 0, rendered.stderr || rendered.stdout);
  const generated = JSON.parse(readFileSync(output, 'utf8'));
  assert.equal(generated.name, contract.resources.workerName);
  assert.equal(generated.main, 'worker/entrypoint.ts');
  assert.equal(generated.d1_databases[0].database_name, contract.resources.d1DatabaseName);
  assert.equal(generated.d1_databases[0].database_id, sampleEnvironment.D1_ID);
  assert.equal(generated.kv_namespaces[0].id, sampleEnvironment.KV_ID);
  assert.equal(generated.vars.ALLOWED_ORIGINS, 'https://staging.example.com,https://review.example.com');
  assert.deepEqual(generated.triggers.crons, []);
  for (const flag of [
    'FEATURE_EMAIL_VERIFICATION',
    'FEATURE_SMS_VERIFICATION',
    'FEATURE_TURNSTILE',
    'FEATURE_ADMIN_CONSOLE',
    'FEATURE_ADMIN_ALERTS'
  ]) assert.equal(generated.vars[flag], 'off');
  const generatedText = readFileSync(output, 'utf8');
  for (const forbidden of [
    'CLOUDFLARE_API_TOKEN',
    'CLOUDFLARE_ACCOUNT_ID',
    'WEBHOOK_SECRET',
    'API_KEY',
    'SIGNING_SECRET',
    'TURNSTILE_SECRET'
  ]) assert.ok(!generatedText.includes(forbidden), `Rendered config leaked ${forbidden}`);

  const invalidOrigin = spawnSync(process.execPath, [
    resolve(root, 'scripts/render-staging-wrangler.mjs'),
    '--output',
    join(temp, 'invalid-origin.jsonc')
  ], {
    cwd: root,
    env: {
      ...sampleEnvironment,
      STAGING_ALLOWED_ORIGINS: 'https://127.0.0.1',
      STAGING_EXPECTED_ORIGIN: 'https://127.0.0.1'
    },
    encoding: 'utf8'
  });
  assert.notEqual(invalidOrigin.status, 0);
  assert.match(`${invalidOrigin.stderr}\n${invalidOrigin.stdout}`, /public HTTPS origin/);

  const invalidDatabase = spawnSync(process.execPath, [
    resolve(root, 'scripts/render-staging-wrangler.mjs'),
    '--output',
    join(temp, 'invalid-d1.jsonc')
  ], {
    cwd: root,
    env: { ...sampleEnvironment, D1_ID: 'production-database' },
    encoding: 'utf8'
  });
  assert.notEqual(invalidDatabase.status, 0);
  assert.match(`${invalidDatabase.stderr}\n${invalidDatabase.stdout}`, /D1_ID must be a UUID/);
} finally {
  rmSync(temp, { recursive: true, force: true });
}

assert.match(workflow, /^name: Deploy Cloudflare Staging/m);
assert.match(workflow, /^on:\n  workflow_dispatch:\s*$/m);
assert.doesNotMatch(workflow, /^  (?:push|pull_request|schedule):/m);
assert.match(workflow, /^    environment: staging$/m);
assert.ok(workflow.includes('npm ci --no-audit --no-fund'));
assert.ok(workflow.includes('node scripts/render-staging-wrangler.mjs --output wrangler.staging.deploy.jsonc'));
assert.ok(workflow.includes('D1_DATABASE_NAME=$D1_NAME'));
assert.ok(workflow.includes('WRANGLER_CONFIG: wrangler.staging.deploy.jsonc'));
assert.ok(workflow.includes("contract: 'cloudflare-app-staging-acceptance-v1'"));
assert.ok(workflow.includes('retention-days: 30'));
assert.ok(workflow.includes('environment: staging'));
for (const smoke of [
  'commercial-runtime-production-smoke.mjs',
  'cloudflare-production-smoke.mjs',
  'concept-progress-production-smoke.mjs',
  'checkpoint-production-smoke.mjs',
  'checkpoint-reservation-production-smoke.mjs',
  'capstone-production-smoke.mjs',
  'assessment-calibration-production-smoke.mjs',
  'learning-analytics-production-smoke.mjs',
  'dialect-labs-free-production-smoke.ts',
  'mastery-progress-production-smoke.mjs',
  'onboarding-production-smoke.mjs'
]) assert.ok(workflow.includes(smoke), `Staging acceptance is missing ${smoke}`);
for (const forbidden of [
  'CONTACT_VERIFICATION_SIGNING_SECRET:',
  'EMAIL_VERIFICATION_WEBHOOK_SECRET:',
  'SMS_VERIFICATION_WEBHOOK_SECRET:',
  'ADMIN_ALERT_WEBHOOK_SECRET:',
  'TURNSTILE_SECRET_KEY:'
]) assert.ok(!workflow.includes(forbidden), `Staging workflow must not materialize Worker secret ${forbidden}`);
assert.ok(workflow.includes("! grep -Eq 'WEBHOOK_SECRET|API_KEY|TURNSTILE_SECRET|SIGNING_SECRET'"));

for (const marker of [
  'GitHub Environment named `staging`',
  '`sql-learn-web-app-staging`',
  '`sql-academy-staging`',
  '`sql-academy-settings-staging`',
  'Real provider credentials',
  'issue #133',
  'cloudflare-app-staging-acceptance-v1',
  'Production promotion',
  'Rollback',
  'two named operational owners'
]) assert.ok(deploymentGuide.includes(marker), `Buyer deployment guide is missing ${marker}`);

for (const section of [
  '## 1. Ownership and access',
  '## 2. Product identity and support',
  '## 3. Staging environment',
  '## 4. Production deployment',
  '## 5. Authentication and external providers',
  '## 6. Privacy, retention and account operations',
  '## 7. Backup, restore and rollback',
  '## 8. Monitoring and alerts',
  '## 9. Runbooks and support readiness',
  '## 10. Final sign-off'
]) assert.ok(transferChecklist.includes(section), `Transfer checklist is missing ${section}`);
assert.ok((transferChecklist.match(/Required evidence:/g) || []).length >= 9);
for (const marker of [
  'Original developer is not a single point of failure',
  'External provider boundary #133',
  'Accepted commit SHA',
  'Backup/restore evidence',
  'Product Identity Contract'
]) assert.ok(transferChecklist.includes(marker), `Transfer checklist is missing ${marker}`);

assert.ok(productionHealth.includes("PRODUCTION_HEALTH_URL: ${{ vars.PRODUCTION_HEALTH_URL }}"));
assert.ok(productionHealth.includes("if: env.PRODUCTION_HEALTH_URL != ''"));
assert.ok(productionHealth.includes('workflow_dispatch:'));

console.log('Cloudflare staging and buyer transfer validated: isolated resources, manual protected deployment, full smoke acceptance, redacted evidence, explicit provider boundary and owner-based sign-off.');
