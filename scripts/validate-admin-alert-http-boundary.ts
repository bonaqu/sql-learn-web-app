import assert from 'node:assert/strict';
import { handleAdminAlertRequest } from '../worker/admin-alert-routing';

const env = {
  FEATURE_ADMIN_CONSOLE: 'on',
  ADMIN_ALLOWED_USER_IDS: 'operator_test_01',
  FEATURE_ADMIN_ALERTS: 'off'
} as unknown as Cloudflare.Env;

const wrongMethod = await handleAdminAlertRequest(
  new Request('https://academy.example/api/admin/alerts', { method: 'DELETE' }),
  env,
  'operator_test_01'
);
assert.equal(wrongMethod?.status, 405);
assert.equal(wrongMethod?.headers.get('allow'), 'GET, POST');

const oversized = await handleAdminAlertRequest(
  new Request('https://academy.example/api/admin/alerts', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mode: 'test', padding: 'x'.repeat(4_096) })
  }),
  env,
  'operator_test_01'
);
assert.equal(oversized?.status, 400);
assert.equal((await oversized?.json() as { code: string }).code, 'ADMIN_ALERT_OPERATION_INVALID');

const malformed = await handleAdminAlertRequest(
  new Request('https://academy.example/api/admin/alerts', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{'
  }),
  env,
  'operator_test_01'
);
assert.equal(malformed?.status, 400);

const brokenStateEnv = {
  ...env,
  SETTINGS: {
    async get() {
      throw new SyntaxError('Malformed JSON in KV state');
    }
  }
} as unknown as Cloudflare.Env;
const brokenStateResponse = await handleAdminAlertRequest(
  new Request('https://academy.example/api/admin/alerts'),
  brokenStateEnv,
  'operator_test_01'
);
assert.equal(brokenStateResponse?.status, 200);
const brokenStateBody = await brokenStateResponse?.json() as {
  contract: string;
  lastDelivery: unknown;
};
assert.equal(brokenStateBody.contract, 'admin-alert-routing-v1');
assert.equal(brokenStateBody.lastDelivery, null,
  'Malformed KV delivery state must not make the protected status endpoint unavailable.');

const hidden = await handleAdminAlertRequest(
  new Request('https://academy.example/api/admin/alerts'),
  { ...env, FEATURE_ADMIN_CONSOLE: 'off' } as Cloudflare.Env,
  'operator_test_01'
);
assert.equal(hidden?.status, 404);

const otherPath = await handleAdminAlertRequest(
  new Request('https://academy.example/api/admin/health'),
  env,
  'operator_test_01'
);
assert.equal(otherPath, null);

console.log('Admin alert HTTP boundary validated: protected route, strict methods, malformed JSON rejection, streaming 2 KiB ceiling and safe malformed-KV recovery.');
