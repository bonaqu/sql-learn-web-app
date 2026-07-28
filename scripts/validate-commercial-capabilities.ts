import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  commercialCapabilities,
  handleCommercialCapabilitiesRequest
} from '../worker/commercial-capabilities';

const disabled = commercialCapabilities({} as Cloudflare.Env);
assert.equal(disabled.contract, 'commercial-capabilities-v1');
assert.equal(disabled.authentication.usernamePassword, true);
assert.equal(disabled.authentication.recoveryCodes, true);
assert.deepEqual(disabled.integrations, {
  emailVerification: { enabled: false },
  smsVerification: { enabled: false },
  turnstile: { enabled: false },
  adminConsole: { enabled: false }
});

const flagsWithoutAdapters = commercialCapabilities({
  FEATURE_EMAIL_VERIFICATION: 'on',
  FEATURE_SMS_VERIFICATION: 'ON',
  FEATURE_TURNSTILE: ' on ',
  FEATURE_ADMIN_CONSOLE: 'on'
} as Cloudflare.Env);
assert.deepEqual(flagsWithoutAdapters.integrations, disabled.integrations,
  'Feature flags must fail closed until the corresponding production adapter is implemented.');

const response = handleCommercialCapabilitiesRequest(
  new Request('https://academy.example.test/api/capabilities'),
  {} as Cloudflare.Env
);
assert.ok(response);
assert.equal(response.status, 200);
assert.equal(response.headers.get('x-commercial-capabilities-contract'), 'commercial-capabilities-v1');
assert.equal(response.headers.get('cache-control'), 'public, max-age=60, must-revalidate');
assert.deepEqual(await response.json(), disabled);

const rejectedMethod = handleCommercialCapabilitiesRequest(
  new Request('https://academy.example.test/api/capabilities', { method: 'POST' }),
  {} as Cloudflare.Env
);
assert.ok(rejectedMethod);
assert.equal(rejectedMethod.status, 405);
assert.equal(rejectedMethod.headers.get('allow'), 'GET, OPTIONS');

assert.equal(handleCommercialCapabilitiesRequest(
  new Request('https://academy.example.test/api/health'),
  {} as Cloudflare.Env
), null);

const workerSource = readFileSync(new URL('../worker/index.ts', import.meta.url), 'utf8');
assert.match(workerSource, /env\.ALLOWED_ORIGINS/);
assert.doesNotMatch(workerSource, /const\s+ALLOWED_ORIGINS\s*=\s*new Set/,
  'Owner-facing origins must come from deployment configuration, not source code.');
assert.match(workerSource, /x-commercial-capabilities-contract/);

const productionConfig = readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
const typegenConfig = readFileSync(new URL('../wrangler.typegen.jsonc', import.meta.url), 'utf8');
for (const config of [productionConfig, typegenConfig]) {
  assert.match(config, /"ALLOWED_ORIGINS"/);
  assert.match(config, /"FEATURE_EMAIL_VERIFICATION": "off"/);
  assert.match(config, /"FEATURE_SMS_VERIFICATION": "off"/);
  assert.match(config, /"FEATURE_TURNSTILE": "off"/);
  assert.match(config, /"FEATURE_ADMIN_CONSOLE": "off"/);
}

console.log('Commercial capability contract is fail-closed and origin configuration is environment-driven.');
