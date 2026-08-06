import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const contract = JSON.parse(readFileSync(resolve(root, 'config/staging-environment.json'), 'utf8'));

function optionPath(name, fallback = null) {
  const index = process.argv.indexOf(name);
  if (index < 0) return fallback ? resolve(root, fallback) : null;
  const value = process.argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a path`);
  return resolve(root, value);
}

const output = optionPath('--output', 'wrangler.staging.deploy.jsonc');
const metadataOutput = optionPath('--metadata-output');
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const KV_ID_PATTERN = /^[0-9a-f]{32}$/i;
const CRON_FIELD_PATTERN = /^[0-9A-Za-z*?,/\\#LWD-]+$/;
const HOSTNAME_PATTERN = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const USER_ID_PATTERN = /^[A-Za-z0-9_-]{8,80}$/;
const FLAG_NAMES = [
  'FEATURE_EMAIL_VERIFICATION',
  'FEATURE_SMS_VERIFICATION',
  'FEATURE_TURNSTILE',
  'FEATURE_ADMIN_CONSOLE',
  'FEATURE_ADMIN_ALERTS'
];

function required(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`${name} is required for staging deployment`);
  return value;
}

function publicOrigin(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`Invalid staging origin: ${value}`);
  }
  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const ipv4 = /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname) ? hostname.split('.').map(Number) : null;
  const privateIpv4 = ipv4 && (
    ipv4.some(octet => !Number.isInteger(octet) || octet < 0 || octet > 255)
    || ipv4[0] === 0
    || ipv4[0] === 10
    || ipv4[0] === 127
    || (ipv4[0] === 100 && ipv4[1] >= 64 && ipv4[1] <= 127)
    || (ipv4[0] === 169 && ipv4[1] === 254)
    || (ipv4[0] === 172 && ipv4[1] >= 16 && ipv4[1] <= 31)
    || (ipv4[0] === 192 && ipv4[1] === 168)
    || ipv4[0] >= 224
  );
  if (parsed.protocol !== 'https:'
    || parsed.origin !== value.replace(/\/$/, '')
    || parsed.username
    || parsed.password
    || parsed.pathname !== '/'
    || parsed.search
    || parsed.hash
    || !hostname
    || hostname === 'localhost'
    || hostname.endsWith('.localhost')
    || hostname.endsWith('.local')
    || hostname.endsWith('.internal')
    || hostname.includes(':')
    || privateIpv4) {
    throw new Error(`Staging origin must be a public HTTPS origin: ${value}`);
  }
  return parsed.origin;
}

function origins() {
  const values = required('STAGING_ALLOWED_ORIGINS')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean);
  if (!values.length || values.length > 24) throw new Error('STAGING_ALLOWED_ORIGINS must contain 1-24 origins');
  const normalized = [...new Set(values.map(publicOrigin))];
  const expected = publicOrigin(required('STAGING_EXPECTED_ORIGIN'));
  if (!normalized.includes(expected)) throw new Error('STAGING_EXPECTED_ORIGIN must be included in STAGING_ALLOWED_ORIGINS');
  return { normalized, expected };
}

function variable(name) {
  const stagingName = `STAGING_${name}`;
  const raw = process.env[stagingName];
  return raw === undefined || String(raw).trim() === ''
    ? String(contract.safeDefaults[name] ?? '')
    : String(raw).trim();
}

function reviewedInteger(name, minimum, maximum) {
  const value = variable(name);
  if (!/^\d+$/.test(value)) throw new Error(`STAGING_${name} must be an integer`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`STAGING_${name} must be within ${minimum}-${maximum}`);
  }
  return String(parsed);
}

function commaSeparated(name, maximum) {
  const values = variable(name).split(',').map(value => value.trim()).filter(Boolean);
  if (values.length > maximum) throw new Error(`STAGING_${name} contains too many values`);
  return [...new Set(values)];
}

if (contract.contract !== 'cloudflare-staging-environment-v1') {
  throw new Error('Unsupported staging environment contract');
}
if (contract.githubEnvironment !== 'staging') throw new Error('Staging GitHub Environment must remain named staging');

const d1Id = required('D1_ID');
const kvId = required('KV_ID');
if (!UUID_PATTERN.test(d1Id)) throw new Error('D1_ID must be a UUID');
if (!KV_ID_PATTERN.test(kvId)) throw new Error('KV_ID must be a 32-character hex identifier');
const { normalized: allowedOrigins, expected } = origins();

const flags = Object.fromEntries(FLAG_NAMES.map(name => {
  const value = variable(name).toLowerCase();
  if (value !== 'on' && value !== 'off') throw new Error(`STAGING_${name} must be on or off`);
  return [name, value];
}));
const contactPolicy = variable('CONTACT_REGISTRATION_POLICY').toLowerCase();
if (contactPolicy !== 'optional' && contactPolicy !== 'required-for-new-registration') {
  throw new Error('STAGING_CONTACT_REGISTRATION_POLICY is invalid');
}

const turnstileHostnames = commaSeparated('TURNSTILE_EXPECTED_HOSTNAMES', 30)
  .map(value => value.toLowerCase());
if (turnstileHostnames.some(value => !HOSTNAME_PATTERN.test(value))) {
  throw new Error('STAGING_TURNSTILE_EXPECTED_HOSTNAMES contains an invalid hostname');
}
if (flags.FEATURE_TURNSTILE === 'on' && !turnstileHostnames.length) {
  throw new Error('STAGING_TURNSTILE_EXPECTED_HOSTNAMES is required when Turnstile is enabled');
}

const adminAllowedUserIds = commaSeparated('ADMIN_ALLOWED_USER_IDS', 100);
if (adminAllowedUserIds.some(value => !USER_ID_PATTERN.test(value))) {
  throw new Error('STAGING_ADMIN_ALLOWED_USER_IDS contains an invalid user ID');
}
if (flags.FEATURE_ADMIN_CONSOLE === 'on' && !adminAllowedUserIds.length) {
  throw new Error('STAGING_ADMIN_ALLOWED_USER_IDS is required when the admin console is enabled');
}

if (contactPolicy === 'required-for-new-registration'
  && (flags.FEATURE_TURNSTILE !== 'on'
    || (flags.FEATURE_EMAIL_VERIFICATION !== 'on' && flags.FEATURE_SMS_VERIFICATION !== 'on'))) {
  throw new Error('Required-contact registration needs Turnstile and at least one enabled contact channel');
}

const alertCron = flags.FEATURE_ADMIN_ALERTS === 'on' ? variable('ADMIN_ALERT_CRON') : '';
if (flags.FEATURE_ADMIN_ALERTS === 'on') {
  const fields = alertCron.split(/\s+/);
  if (fields.length !== 5 || fields.some(field => !CRON_FIELD_PATTERN.test(field))) {
    throw new Error('STAGING_ADMIN_ALERT_CRON must be a five-field Cloudflare Cron expression');
  }
}

const requiredSecrets = new Set();
if (flags.FEATURE_EMAIL_VERIFICATION === 'on' || flags.FEATURE_SMS_VERIFICATION === 'on') {
  requiredSecrets.add('CONTACT_VERIFICATION_SIGNING_SECRET');
}
if (flags.FEATURE_EMAIL_VERIFICATION === 'on') {
  requiredSecrets.add('EMAIL_VERIFICATION_WEBHOOK_URL');
  requiredSecrets.add('EMAIL_VERIFICATION_WEBHOOK_SECRET');
  requiredSecrets.add('EMAIL_VERIFICATION_EVENT_SECRET');
}
if (flags.FEATURE_SMS_VERIFICATION === 'on') {
  requiredSecrets.add('SMS_VERIFICATION_WEBHOOK_URL');
  requiredSecrets.add('SMS_VERIFICATION_WEBHOOK_SECRET');
  requiredSecrets.add('SMS_VERIFICATION_EVENT_SECRET');
}
if (flags.FEATURE_TURNSTILE === 'on') requiredSecrets.add('TURNSTILE_SECRET_KEY');
if (flags.FEATURE_ADMIN_ALERTS === 'on') {
  requiredSecrets.add('ADMIN_ALERT_WEBHOOK_URL');
  requiredSecrets.add('ADMIN_ALERT_WEBHOOK_SECRET');
}
const secretNames = [...requiredSecrets].sort();

const config = {
  $schema: './node_modules/wrangler/config-schema.json',
  name: contract.resources.workerName,
  main: 'worker/entrypoint.ts',
  compatibility_date: '2026-07-27',
  compatibility_flags: ['nodejs_compat'],
  assets: {
    directory: './dist',
    binding: 'ASSETS',
    not_found_handling: 'single-page-application',
    run_worker_first: ['/api/*']
  },
  triggers: { crons: alertCron ? [alertCron] : [] },
  d1_databases: [{
    binding: 'DB',
    database_name: contract.resources.d1DatabaseName,
    database_id: d1Id,
    migrations_dir: 'migrations'
  }],
  kv_namespaces: [{ binding: 'SETTINGS', id: kvId }],
  ai: { binding: 'AI' },
  vars: {
    DIALECT_ENGINE_MODE: 'preview-only',
    ALLOWED_ORIGINS: allowedOrigins.join(','),
    ...flags,
    ADMIN_ALERT_CRON: alertCron,
    ADMIN_ALERT_COOLDOWN_MINUTES: reviewedInteger('ADMIN_ALERT_COOLDOWN_MINUTES', 5, 1_440),
    CONTACT_REGISTRATION_POLICY: contactPolicy,
    TURNSTILE_EXPECTED_HOSTNAMES: turnstileHostnames.join(','),
    ADMIN_ALLOWED_USER_IDS: adminAllowedUserIds.join(','),
    RETENTION_CONTACT_EVENTS_DAYS: reviewedInteger('RETENTION_CONTACT_EVENTS_DAYS', 1, 30),
    RETENTION_UNCONSUMED_CONTACT_HOURS: reviewedInteger('RETENTION_UNCONSUMED_CONTACT_HOURS', 1, 24),
    RETENTION_CONSUMED_CHALLENGE_HOURS: reviewedInteger('RETENTION_CONSUMED_CHALLENGE_HOURS', 1, 24),
    RETENTION_EXPIRED_SESSION_HOURS: reviewedInteger('RETENTION_EXPIRED_SESSION_HOURS', 0, 24),
    RETENTION_CLEANUP_BATCH_SIZE: reviewedInteger('RETENTION_CLEANUP_BATCH_SIZE', 25, 500)
  },
  observability: { enabled: true, head_sampling_rate: 1 }
};

const metadata = {
  contract: contract.contract,
  workerName: contract.resources.workerName,
  d1DatabaseName: contract.resources.d1DatabaseName,
  kvNamespaceTitle: contract.resources.kvNamespaceTitle,
  expectedOrigin: expected,
  enabledFeatures: FLAG_NAMES.filter(name => flags[name] === 'on'),
  requiredSecretNames: secretNames,
  output: output.replace(`${root}/`, '')
};

writeFileSync(output, `${JSON.stringify(config, null, 2)}\n`);
if (metadataOutput) writeFileSync(metadataOutput, `${JSON.stringify(metadata, null, 2)}\n`);
console.log(JSON.stringify(metadata));
