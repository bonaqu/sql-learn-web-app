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

console.log('Admin alert Cloudflare profiles validated: shared scheduled entrypoint, default-off Cron, reviewed cooldown and zero webhook secrets.');
