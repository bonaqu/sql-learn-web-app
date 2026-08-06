import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const deliveryEvents = readFileSync(new URL('../worker/contact-delivery-events.ts', import.meta.url), 'utf8');
const securityEvents = readFileSync(new URL('../worker/contact-security-events.ts', import.meta.url), 'utf8');

function helperSource(source: string, helper: string, nextExport: string) {
  const start = source.indexOf(helper);
  const end = source.indexOf(nextExport, start);
  assert.ok(start >= 0 && end > start, `Could not isolate ${helper}`);
  return source.slice(start, end);
}

const deliveryRetention = helperSource(
  deliveryEvents,
  'async function pruneDeliveryRetention',
  'export async function handleContactDeliveryEventRequest'
);
assert.ok(deliveryRetention.includes("console.error('contact_delivery_retention_failed'"));
assert.ok(deliveryRetention.includes('deliveryStatus'));
for (const forbidden of [
  'eventId',
  'challengeId',
  'providerMessageId',
  'destination',
  'actorDigest',
  'reasonCode'
]) {
  assert.ok(!deliveryRetention.includes(forbidden), `Delivery retention log can expose ${forbidden}`);
}

const securityRetention = helperSource(
  securityEvents,
  'async function pruneSecurityRetention',
  'export async function recordContactSecurityOutcome'
);
assert.ok(securityRetention.includes("console.error('contact_security_retention_failed'"));
for (const forbidden of [
  'challengeId',
  'destination',
  'actorDigest',
  'userAgent',
  'ipAddress',
  'code'
]) {
  assert.ok(!securityRetention.includes(forbidden), `Security retention log can expose ${forbidden}`);
}

console.log('Retention cleanup logging validated: failure diagnostics preserve status/error class without provider, challenge, contact or actor identifiers.');
