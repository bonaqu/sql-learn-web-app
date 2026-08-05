import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const paths = {
  index: 'docs/operations/README.md',
  incident: 'docs/operations/incident-response.md',
  support: 'docs/operations/support-triage.md',
  recovery: 'docs/operations/account-recovery.md',
  package: 'package.json',
  healthProbe: 'scripts/production-health-probe.mjs',
  backup: 'scripts/d1-backup.mjs',
  backupVerify: 'scripts/verify-d1-backup.mjs',
  restore: 'scripts/d1-restore-rehearsal.mjs'
};

function read(relativePath) {
  const path = join(root, relativePath);
  assert.ok(existsSync(path), `${relativePath} is missing`);
  return readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
}

function requireMarkers(name, source, markers) {
  for (const marker of markers) {
    assert.ok(source.includes(marker), `${name} lost required contract marker: ${marker}`);
  }
}

const index = read(paths.index);
const incident = read(paths.incident);
const support = read(paths.support);
const recovery = read(paths.recovery);
const packageJson = JSON.parse(read(paths.package));
const healthProbe = read(paths.healthProbe);
const backup = read(paths.backup);
const backupVerify = read(paths.backupVerify);
const restore = read(paths.restore);
const docs = [index, incident, support, recovery].join('\n');

requireMarkers('operations index', index, [
  '[Incident response](incident-response.md)',
  '[Support triage](support-triage.md)',
  '[Account recovery](account-recovery.md)',
  'Never request or store passwords, recovery codes, one-time verification codes, session tokens'
]);

requireMarkers('incident response', incident, [
  '## Roles',
  '**Incident commander (IC):**',
  '**Security/privacy lead:**',
  '## Severity',
  '**SEV-1 — critical:**',
  '**SEV-2 — major:**',
  '**SEV-3 — limited:**',
  '**SEV-4 — minor:**',
  'PRODUCTION_HEALTH_URL=https://your-production-origin.example/ npm run probe:production',
  '/api/health',
  '/api/capabilities',
  'npm run backup:d1',
  'npm run backup:d1:verify',
  'D1_RESTORE_TARGET=sql-academy-restore-rehearsal',
  'ALLOW_D1_RESTORE=RESTORE_TO_NON_PRODUCTION',
  'There is no repository command for blind production restore.',
  'Do not close on “deployment succeeded” alone.',
  '## Prohibited shortcuts',
  '[Account recovery](account-recovery.md)'
]);

requireMarkers('support triage', support, [
  '## Intake contract',
  'Never ask for or store:',
  '## Initial classification',
  '## Severity and escalation',
  'Never log in as the learner, request their password or copy their session.',
  'Do not instruct learners to delete all browser data before preserving local-only progress.',
  'Never manually mark a task, checkpoint, assessment or capstone passed to close a ticket.',
  '[Production incident response](incident-response.md)',
  '[Account recovery](account-recovery.md)',
  '## Closure criteria'
]);

requireMarkers('account recovery', recovery, [
  'Support staff have no password-reset or identity-proof override.',
  '## Security boundary',
  'Verified-contact password login still requires the account password; contact verification is not passwordless login.',
  'A successful password reset revokes every active session.',
  '## Supported flow A — recovery code',
  '## Supported flow B — already bound verified contact',
  '## Suspected account takeover',
  '## No available recovery evidence',
  'the repository provides no safe self-service or operator bypass.',
  'A support operator\'s belief that the requester is genuine is not sufficient authentication.',
  '## Session-revocation verification',
  '[Production incident response](incident-response.md)'
]);

const requiredScripts = {
  'probe:production': 'node scripts/production-health-probe.mjs',
  'backup:d1': 'node scripts/d1-backup.mjs',
  'backup:d1:verify': 'node scripts/verify-d1-backup.mjs',
  'restore:d1:rehearsal': 'node scripts/d1-restore-rehearsal.mjs'
};
for (const [name, command] of Object.entries(requiredScripts)) {
  assert.equal(packageJson.scripts?.[name], command, `Runbook command npm run ${name} drifted from package.json`);
}

requireMarkers('production health probe', healthProbe, [
  "getJson('/api/health')",
  "getJson('/api/capabilities')",
  "health.progressVersion !== 4",
  "health.curriculumVersion !== 1",
  "contract !== 'commercial-capabilities-v1'"
]);
requireMarkers('D1 backup', backup, [
  "format: 'sql-academy-d1-backup-v1'",
  'createHash(\'sha256\')',
  "requiredSchemaMarkers: ['users', 'user_profiles', 'auth_sessions', 'progress']"
]);
requireMarkers('D1 backup verification', backupVerify, [
  "manifest.sha256 !== sha256",
  "manifest.bytes",
  "Backup is missing required schema markers"
]);
requireMarkers('D1 restore rehearsal', restore, [
  "if (target === source)",
  "(?:rehearsal|restore|staging|test)",
  "confirmation !== 'RESTORE_TO_NON_PRODUCTION'",
  "Run the full application lifecycle smoke against the rehearsal Worker next."
]);

const forbiddenPatterns = [
  { pattern: /ALLOW_D1_RESTORE\s*=\s*RESTORE_TO_PRODUCTION/i, message: 'Runbooks must not invent a production restore override' },
  { pattern: /wrangler\s+d1\s+execute\s+sql-academy\b[^\n]*--remote/i, message: 'Runbooks must not prescribe direct production D1 execution' },
  { pattern: /UPDATE\s+users\s+SET\s+(?:password|password_hash)/i, message: 'Runbooks must not prescribe direct credential mutation' },
  { pattern: /DELETE\s+FROM\s+auth_sessions/i, message: 'Runbooks must not prescribe ad-hoc session deletion' },
  { pattern: /send\s+(?:us|support)\s+your\s+(?:password|recovery code|one-time code|session token)/i, message: 'Runbooks must not request authentication secrets' },
  { pattern: /paste\s+(?:the\s+)?(?:contents\s+of\s+)?localStorage/i, message: 'Runbooks must not request raw browser storage' },
  { pattern: /manually\s+(?:set|mark)\s+.*(?:passed|mastery)/i, message: 'Runbooks must not permit manual learning evidence fabrication' }
];
for (const { pattern, message } of forbiddenPatterns) assert.ok(!pattern.test(docs), message);

for (const [sourcePath, source] of Object.entries({
  [paths.index]: index,
  [paths.incident]: incident,
  [paths.support]: support,
  [paths.recovery]: recovery
})) {
  const links = [...source.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)].map(match => match[1]);
  for (const link of links) {
    if (/^(?:https?:|mailto:|#)/i.test(link)) continue;
    const target = join(root, dirname(sourcePath), link.split('#')[0]);
    assert.ok(existsSync(target), `${sourcePath} contains a broken relative link: ${link}`);
  }
}

console.log('Operational runbooks validated: incident response, privacy-safe support triage, no-bypass account recovery, live command alignment and non-production-only restore controls.');
