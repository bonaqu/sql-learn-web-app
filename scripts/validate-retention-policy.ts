import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  handleRetentionAdminRequest,
  retentionConfigurationErrors,
  retentionPolicy,
  runRetentionCleanup,
  type RetentionEnvironment
} from '../worker/retention-policy';

class FakeStatement {
  private bindings: unknown[] = [];

  constructor(
    private readonly sql: string,
    private readonly statements: Array<{ sql: string; bindings: unknown[]; kind: 'first' | 'run' }>
  ) {}

  bind(...bindings: unknown[]) {
    this.bindings = bindings;
    return this;
  }

  async first<T>() {
    this.statements.push({ sql: this.sql, bindings: this.bindings, kind: 'first' });
    return { count: 2 } as T;
  }

  async run() {
    this.statements.push({ sql: this.sql, bindings: this.bindings, kind: 'run' });
    return { meta: { changes: 2 } };
  }
}

function fakeEnvironment(overrides: Partial<RetentionEnvironment> = {}) {
  const statements: Array<{ sql: string; bindings: unknown[]; kind: 'first' | 'run' }> = [];
  const DB = {
    prepare(sql: string) {
      return new FakeStatement(sql, statements);
    }
  } as unknown as D1Database;
  return {
    statements,
    env: {
      DB,
      FEATURE_ADMIN_CONSOLE: 'on',
      ADMIN_ALLOWED_USER_IDS: 'operator_test_01',
      ...overrides
    } as RetentionEnvironment
  };
}

const defaults = retentionPolicy({} as RetentionEnvironment);
assert.equal(defaults.contract, 'technical-retention-policy-v1');
assert.equal(defaults.technicalDataOnly, true);
assert.equal(defaults.contactEvents.value, 30);
assert.equal(defaults.unconsumedConfirmedContacts.value, 24);
assert.equal(defaults.consumedChallenges.value, 24);
assert.equal(defaults.expiredSessions.value, 0);
assert.equal(defaults.cleanupBatch.value, 250);
assert.equal(defaults.fixed.expiredUnconfirmedChallenges, 'delete-after-expiry');
assert.deepEqual(defaults.preserved, [
  'users',
  'userProfiles',
  'recoveryCodes',
  'verifiedContacts',
  'contactTicketConsumptionReceipts',
  'learningProgress',
  'curriculumEvidence',
  'masteryEvidence',
  'checkpointReports',
  'assessmentReports',
  'capstoneReports'
]);

const configured = retentionPolicy({
  RETENTION_CONTACT_EVENTS_DAYS: '7',
  RETENTION_UNCONSUMED_CONTACT_HOURS: '6',
  RETENTION_CONSUMED_CHALLENGE_HOURS: '4',
  RETENTION_EXPIRED_SESSION_HOURS: '2',
  RETENTION_CLEANUP_BATCH_SIZE: '100'
} as RetentionEnvironment);
assert.equal(configured.contactEvents.value, 7);
assert.equal(configured.unconsumedConfirmedContacts.value, 6);
assert.equal(configured.consumedChallenges.value, 4);
assert.equal(configured.expiredSessions.value, 2);
assert.equal(configured.cleanupBatch.value, 100);
assert.equal(configured.contactEvents.configured, true);

const invalidEnv = {
  RETENTION_CONTACT_EVENTS_DAYS: '31',
  RETENTION_UNCONSUMED_CONTACT_HOURS: '0',
  RETENTION_CONSUMED_CHALLENGE_HOURS: '1.5',
  RETENTION_EXPIRED_SESSION_HOURS: '-1',
  RETENTION_CLEANUP_BATCH_SIZE: '501'
} as RetentionEnvironment;
const invalidPolicy = retentionPolicy(invalidEnv);
assert.equal(invalidPolicy.contactEvents.value, 30);
assert.equal(invalidPolicy.unconsumedConfirmedContacts.value, 24);
assert.equal(invalidPolicy.consumedChallenges.value, 24);
assert.equal(invalidPolicy.expiredSessions.value, 0);
assert.equal(invalidPolicy.cleanupBatch.value, 250);
assert.deepEqual(retentionConfigurationErrors(invalidEnv), [
  'RETENTION_CONTACT_EVENTS_DAYS_INVALID',
  'RETENTION_UNCONSUMED_CONTACT_HOURS_INVALID',
  'RETENTION_CONSUMED_CHALLENGE_HOURS_INVALID',
  'RETENTION_EXPIRED_SESSION_HOURS_INVALID',
  'RETENTION_CLEANUP_BATCH_SIZE_INVALID'
]);

const dryRun = fakeEnvironment();
const dryResult = await runRetentionCleanup(dryRun.env, {
  now: new Date('2026-08-05T10:00:00.000Z')
});
assert.equal(dryResult.mode, 'dry-run');
assert.equal(dryResult.results.length, 6);
assert.equal(dryResult.totals.eligible, 12);
assert.equal(dryResult.totals.deleted, 0);
assert.equal(dryRun.statements.filter(statement => statement.kind === 'run').length, 0);
assert.ok(dryRun.statements.every(statement => statement.bindings.at(-1) === 250));

const execute = fakeEnvironment({
  RETENTION_CONTACT_EVENTS_DAYS: '7',
  RETENTION_UNCONSUMED_CONTACT_HOURS: '6',
  RETENTION_CONSUMED_CHALLENGE_HOURS: '4',
  RETENTION_EXPIRED_SESSION_HOURS: '2',
  RETENTION_CLEANUP_BATCH_SIZE: '100'
});
const executeResult = await runRetentionCleanup(execute.env, {
  execute: true,
  now: new Date('2026-08-05T10:00:00.000Z')
});
assert.equal(executeResult.mode, 'execute');
assert.equal(executeResult.totals.eligible, 12);
assert.equal(executeResult.totals.deleted, 12);
const deleteStatements = execute.statements.filter(statement => statement.kind === 'run');
assert.equal(deleteStatements.length, 6);
assert.ok(deleteStatements.every(statement => /^DELETE FROM (?:auth_sessions|contact_)/.test(statement.sql.trim())));
assert.ok(deleteStatements.every(statement => statement.bindings.at(-1) === 100));

const disabled = fakeEnvironment({ FEATURE_ADMIN_CONSOLE: 'off' });
const hiddenResponse = await handleRetentionAdminRequest(
  new Request('https://academy.example/api/admin/retention'),
  disabled.env,
  'operator_test_01'
);
assert.equal(hiddenResponse?.status, 404);

const admin = fakeEnvironment();
const getResponse = await handleRetentionAdminRequest(
  new Request('https://academy.example/api/admin/retention'),
  admin.env,
  'operator_test_01'
);
assert.equal(getResponse?.status, 200);
assert.equal(getResponse?.headers.get('x-retention-contract'), 'technical-retention-policy-v1');
assert.equal((await getResponse?.json() as { mode: string }).mode, 'dry-run');

const missingConfirmation = await handleRetentionAdminRequest(
  new Request('https://academy.example/api/admin/retention', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mode: 'execute' })
  }),
  admin.env,
  'operator_test_01'
);
assert.equal(missingConfirmation?.status, 409);

const confirmedExecution = await handleRetentionAdminRequest(
  new Request('https://academy.example/api/admin/retention', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      mode: 'execute',
      confirmation: 'DELETE_EXPIRED_TECHNICAL_DATA',
      scopes: ['expiredSessions', 'contactSecurityEvents']
    })
  }),
  admin.env,
  'operator_test_01'
);
assert.equal(confirmedExecution?.status, 200);
const confirmedBody = await confirmedExecution?.json() as {
  mode: string;
  results: Array<{ scope: string }>;
};
assert.equal(confirmedBody.mode, 'execute');
assert.deepEqual(confirmedBody.results.map(result => result.scope), ['expiredSessions', 'contactSecurityEvents']);

const retentionSource = readFileSync(new URL('../worker/retention-policy.ts', import.meta.url), 'utf8');
for (const protectedTable of [
  'users',
  'user_profiles',
  'recovery_codes',
  'verified_contacts',
  'contact_ticket_consumptions',
  'progress',
  'curriculum_progress',
  'mastery_progress',
  'checkpoint_reports',
  'assessment_reports',
  'capstone_reports'
]) {
  assert.ok(
    !new RegExp(`DELETE\\s+FROM\\s+${protectedTable}\\b`, 'i').test(retentionSource),
    `Retention cleanup must not delete protected table ${protectedTable}`
  );
}
for (const allowedTable of [
  'auth_sessions',
  'contact_verification_challenges',
  'contact_security_events',
  'contact_delivery_events'
]) {
  assert.ok(retentionSource.includes(`table: '${allowedTable}'`), `Missing retention ownership for ${allowedTable}`);
}
assert.ok(retentionSource.includes("const EXECUTE_CONFIRMATION = 'DELETE_EXPIRED_TECHNICAL_DATA'"));
assert.ok(retentionSource.includes('ORDER BY ${spec.timestamp} ASC LIMIT ?'));
assert.ok(retentionSource.includes('adminConsoleReady(env)'));
assert.ok(retentionSource.includes('adminAllowedUserIds(env).has(userId)'));

const adminHealth = readFileSync(new URL('../worker/admin-health.ts', import.meta.url), 'utf8');
assert.ok(adminHealth.includes('handleRetentionAdminRequest(request, env, userId)'));
assert.ok(adminHealth.includes('retentionPolicy(env)'));
assert.ok(adminHealth.includes('retentionConfigurationErrors(env)'));

const securityEvents = readFileSync(new URL('../worker/contact-security-events.ts', import.meta.url), 'utf8');
const deliveryEvents = readFileSync(new URL('../worker/contact-delivery-events.ts', import.meta.url), 'utf8');
assert.ok(securityEvents.includes("from './retention-policy'"));
assert.ok(deliveryEvents.includes("from './retention-policy'"));
assert.ok(!securityEvents.includes('const RETENTION_MS'));
assert.ok(!deliveryEvents.includes('const RETENTION_MS'));
assert.ok(deliveryEvents.includes("console.error('contact_delivery_retention_failed'"));
const retentionCall = deliveryEvents.indexOf('await runRetentionCleanup(env');
const acknowledgement = deliveryEvents.indexOf('return json({\n    ok: true');
assert.ok(retentionCall >= 0 && acknowledgement > retentionCall);
assert.ok(deliveryEvents.slice(retentionCall, acknowledgement).includes('} catch (error) {'));

const cloudflareWorkflow = readFileSync(new URL('../.github/workflows/cloudflare.yml', import.meta.url), 'utf8');
assert.ok(cloudflareWorkflow.includes('npm ci --no-audit --no-fund'));
assert.ok(cloudflareWorkflow.includes("CONTACT_REGISTRATION_POLICY: ${{ vars.CONTACT_REGISTRATION_POLICY || 'optional' }}"));
assert.ok(cloudflareWorkflow.includes('CONTACT_REGISTRATION_POLICY: process.env.CONTACT_REGISTRATION_POLICY'));
for (const variable of [
  'RETENTION_CONTACT_EVENTS_DAYS',
  'RETENTION_UNCONSUMED_CONTACT_HOURS',
  'RETENTION_CONSUMED_CHALLENGE_HOURS',
  'RETENTION_EXPIRED_SESSION_HOURS',
  'RETENTION_CLEANUP_BATCH_SIZE'
]) {
  const repositoryVariablePrefix = `${variable}: ` + '${{ vars.' + variable;
  assert.ok(cloudflareWorkflow.includes(repositoryVariablePrefix), `Production workflow does not expose ${variable}`);
  assert.ok(cloudflareWorkflow.includes(`${variable}: process.env.${variable}`), `Generated production config omits ${variable}`);
}

console.log('Configurable technical retention validated: bounded privacy windows, protected admin dry-run/execute, isolated delivery acknowledgements, production deploy wiring, six technical scopes, deterministic batches and zero learning-evidence deletion.');
