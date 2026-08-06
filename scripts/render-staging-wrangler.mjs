import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const contract = JSON.parse(readFileSync(resolve(root, 'config/staging-environment.json'), 'utf8'));
const outputArg = process.argv.indexOf('--output');
const output = resolve(root, outputArg >= 0 ? process.argv[outputArg + 1] : 'wrangler.staging.deploy.jsonc');
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const KV_ID_PATTERN = /^[0-9a-f]{32}$/i;
const CRON_FIELD_PATTERN = /^[0-9A-Za-z*?,/\\#LWD-]+$/;
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
const alertCron = flags.FEATURE_ADMIN_ALERTS === 'on' ? variable('ADMIN_ALERT_CRON') : '';
if (flags.FEATURE_ADMIN_ALERTS === 'on') {
  const fields = alertCron.split(/\s+/);
  if (fields.length !== 5 || fields.some(field => !CRON_FIELD_PATTERN.test(field))) {
    throw new Error('STAGING_ADMIN_ALERT_CRON must be a five-field Cloudflare Cron expression');
  }
}

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
    TURNSTILE_EXPECTED_HOSTNAMES: variable('TURNSTILE_EXPECTED_HOSTNAMES'),
    ADMIN_ALLOWED_USER_IDS: variable('ADMIN_ALLOWED_USER_IDS'),
    RETENTION_CONTACT_EVENTS_DAYS: reviewedInteger('RETENTION_CONTACT_EVENTS_DAYS', 1, 30),
    RETENTION_UNCONSUMED_CONTACT_HOURS: reviewedInteger('RETENTION_UNCONSUMED_CONTACT_HOURS', 1, 24),
    RETENTION_CONSUMED_CHALLENGE_HOURS: reviewedInteger('RETENTION_CONSUMED_CHALLENGE_HOURS', 1, 24),
    RETENTION_EXPIRED_SESSION_HOURS: reviewedInteger('RETENTION_EXPIRED_SESSION_HOURS', 0, 24),
    RETENTION_CLEANUP_BATCH_SIZE: reviewedInteger('RETENTION_CLEANUP_BATCH_SIZE', 25, 500)
  },
  observability: { enabled: true, head_sampling_rate: 1 }
};

writeFileSync(output, `${JSON.stringify(config, null, 2)}\n`);
console.log(JSON.stringify({
  contract: contract.contract,
  workerName: contract.resources.workerName,
  d1DatabaseName: contract.resources.d1DatabaseName,
  kvNamespaceTitle: contract.resources.kvNamespaceTitle,
  expectedOrigin: expected,
  enabledFeatures: FLAG_NAMES.filter(name => flags[name] === 'on'),
  output: output.replace(`${root}/`, '')
}));
