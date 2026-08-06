import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

for (const path of [
  '../wrangler.jsonc',
  '../wrangler.typegen.jsonc',
  '../wrangler.real-engines.jsonc'
]) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8');
  const config = JSON.parse(source) as {
    main?: unknown;
    triggers?: { crons?: unknown };
    vars?: Record<string, unknown>;
  };
  assert.equal(config.main, 'worker/entrypoint.ts', `${path} must use the scheduled production entrypoint`);
  assert.deepEqual(config.triggers?.crons, [], `${path} must remain default-off without a Cron trigger`);
  assert.equal(config.vars?.FEATURE_ADMIN_ALERTS, 'off', `${path} must default alert routing off`);
  assert.equal(config.vars?.ADMIN_ALERT_CRON, '', `${path} must not invent a schedule`);
  assert.equal(config.vars?.ADMIN_ALERT_COOLDOWN_MINUTES, '60', `${path} must use the reviewed cooldown`);
  assert.ok(!source.includes('ADMIN_ALERT_WEBHOOK_URL'), `${path} must not contain the buyer webhook URL`);
  assert.ok(!source.includes('ADMIN_ALERT_WEBHOOK_SECRET'), `${path} must not contain the buyer HMAC secret`);
}

const workerIndex = readFileSync(new URL('../worker/index.ts', import.meta.url), 'utf8');
const exposeHeaders = workerIndex.match(/'access-control-expose-headers':\s*'([^']+)'/)?.[1] || '';
assert.ok(exposeHeaders.split(',').map(value => value.trim()).includes('x-admin-alert-contract'),
  'The authenticated browser operator must be able to read x-admin-alert-contract.');
assert.ok(!workerIndex.includes('x-admin-alert-signature'),
  'Outbound webhook signature headers must never be accepted or exposed by the browser API CORS contract.');

const routing = readFileSync(new URL('../worker/admin-alert-routing.ts', import.meta.url), 'utf8');
assert.ok(routing.includes('const timestamp = String(Math.floor(Date.now() / 1_000));'),
  'Webhook signature freshness must use delivery time rather than nominal Cron time.');
assert.ok(!routing.includes('Date.parse(payload.generatedAt) / 1_000'),
  'Delayed Cron invocations must not emit stale signature timestamps.');
assert.ok(routing.includes('request.body.getReader()'));
assert.ok(routing.includes('if (total > MAX_BODY_BYTES)'));
assert.ok(routing.includes('await reader.cancel()'));
assert.ok(routing.includes("source: 'schedule', now: new Date()"));

console.log('Admin alert Cloudflare profiles validated: shared scheduled entrypoint, default-off Cron, fresh signatures, bounded operator bodies, browser-visible response contract and zero webhook secrets.');
