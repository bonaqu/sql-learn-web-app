import { verificationProviderReady, type VerificationProviderEnvironment } from './integrations/verification';

export type DeliveryStatus =
  | 'accepted'
  | 'delivered'
  | 'deferred'
  | 'bounced'
  | 'complained'
  | 'undeliverable'
  | 'provider-rejected'
  | 'provider-unavailable';

export type ContactSecurityEventType =
  | 'challenge-created'
  | 'resend-cooldown'
  | 'challenge-rate-limit'
  | 'provider-failure'
  | 'invalid-code'
  | 'code-locked'
  | 'confirmed'
  | 'ticket-consumed';

export type ContactOperationsEnvironment = VerificationProviderEnvironment & Partial<Record<
  'CONTACT_DELIVERY_RECEIPT_SECRET' | 'FEATURE_EMAIL_VERIFICATION' | 'FEATURE_SMS_VERIFICATION',
  string
>>;

type Channel = 'email' | 'sms';
type Purpose = 'register' | 'password-reset' | 'sensitive-action';

type ChallengeRow = {
  channel: Channel;
  purpose: Purpose;
  provider_message_id: string | null;
};

type DeliveryEventRow = {
  status: DeliveryStatus;
  reason_code: string | null;
  occurred_at: string;
  recorded_at: string;
};

const RECEIPT_PATH = '/api/integrations/contact-delivery-receipt';
const MAX_JSON_BYTES = 12_000;
const EVENT_ID_PATTERN = /^[A-Za-z0-9._:/-]{1,180}$/;
const CHALLENGE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MESSAGE_ID_PATTERN = /^[A-Za-z0-9._:/-]{1,160}$/;
const REASON_PATTERN = /^[A-Za-z0-9._:/-]{1,96}$/;
const STATUSES = new Set<DeliveryStatus>([
  'accepted', 'delivered', 'deferred', 'bounced', 'complained', 'undeliverable',
  'provider-rejected', 'provider-unavailable'
]);
const CHANNELS = new Set<Channel>(['email', 'sms']);
const PURPOSES = new Set<Purpose>(['register', 'password-reset', 'sensitive-action']);

const json = (data: unknown, status = 200, extra: Record<string, string> = {}) => new Response(JSON.stringify(data), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'x-contact-delivery-contract': 'contact-verification-receipt-v1',
    ...extra
  }
});

function sqliteTime(date = new Date()) {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

function enabled(value: string | undefined) {
  return value?.trim().toLowerCase() === 'on';
}

function receiptSecret(env: ContactOperationsEnvironment) {
  const value = (env.CONTACT_DELIVERY_RECEIPT_SECRET || '').trim();
  return value.length >= 32 && value.length <= 2_000 ? value : '';
}

export function contactDeliveryReceiptReady(env: ContactOperationsEnvironment) {
  const emailReady = enabled(env.FEATURE_EMAIL_VERIFICATION) && verificationProviderReady('email', env);
  const smsReady = enabled(env.FEATURE_SMS_VERIFICATION) && verificationProviderReady('sms', env);
  return receiptSecret(env).length > 0 && (emailReady || smsReady);
}

function constantTimeEqual(left: string, right: string) {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  let difference = leftBytes.length ^ rightBytes.length;
  const length = Math.max(leftBytes.length, rightBytes.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (leftBytes[index] || 0) ^ (rightBytes[index] || 0);
  }
  return difference === 0;
}

function authorized(request: Request, env: ContactOperationsEnvironment) {
  const header = request.headers.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  const expected = receiptSecret(env);
  return expected.length > 0 && constantTimeEqual(token, expected);
}

async function boundedJson(request: Request) {
  const declared = Number(request.headers.get('content-length') || 0);
  if (Number.isFinite(declared) && declared > MAX_JSON_BYTES) return null;
  try {
    const text = await request.text();
    if (new TextEncoder().encode(text).byteLength > MAX_JSON_BYTES) return null;
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function validOccurredAt(value: unknown) {
  if (typeof value !== 'string') return null;
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) return null;
  const now = Date.now();
  if (milliseconds < now - 31 * 86_400_000 || milliseconds > now + 86_400_000) return null;
  return sqliteTime(new Date(milliseconds));
}

function eventKey(channel: Channel, eventId: string) {
  return `${channel}:${eventId}`;
}

export function deliveryEventStatement(
  env: ContactOperationsEnvironment,
  input: {
    eventId: string;
    challengeId: string;
    channel: Channel;
    purpose: Purpose;
    providerMessageId?: string | null;
    status: DeliveryStatus;
    reasonCode?: string | null;
    occurredAt?: string;
  }
) {
  return env.DB.prepare(`INSERT OR IGNORE INTO contact_delivery_events(
    event_key, event_id, challenge_id, channel, purpose, provider_message_id,
    status, reason_code, occurred_at, recorded_at
  ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
      eventKey(input.channel, input.eventId),
      input.eventId,
      input.challengeId,
      input.channel,
      input.purpose,
      input.providerMessageId || null,
      input.status,
      input.reasonCode || null,
      input.occurredAt || sqliteTime(),
      sqliteTime()
    );
}

export function securityEventStatement(
  env: ContactOperationsEnvironment,
  input: {
    challengeId?: string | null;
    channel: Channel;
    purpose: Purpose;
    eventType: ContactSecurityEventType;
    occurredAt?: string;
  }
) {
  return env.DB.prepare(`INSERT INTO contact_security_events(
    event_id, challenge_id, channel, purpose, event_type, occurred_at
  ) VALUES(?, ?, ?, ?, ?, ?)`).bind(
      crypto.randomUUID(),
      input.challengeId || null,
      input.channel,
      input.purpose,
      input.eventType,
      input.occurredAt || sqliteTime()
    );
}

export async function recordDeliveryEvent(
  env: ContactOperationsEnvironment,
  input: Parameters<typeof deliveryEventStatement>[1]
) {
  return deliveryEventStatement(env, input).run();
}

export async function recordSecurityEvent(
  env: ContactOperationsEnvironment,
  input: Parameters<typeof securityEventStatement>[1]
) {
  return securityEventStatement(env, input).run();
}

export async function pruneContactOperationalEvents(env: ContactOperationsEnvironment) {
  const cutoff = sqliteTime(new Date(Date.now() - 30 * 86_400_000));
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM contact_delivery_events WHERE event_key IN (
      SELECT event_key FROM contact_delivery_events WHERE occurred_at < ? ORDER BY occurred_at ASC LIMIT 250
    )`).bind(cutoff),
    env.DB.prepare(`DELETE FROM contact_security_events WHERE event_id IN (
      SELECT event_id FROM contact_security_events WHERE occurred_at < ? ORDER BY occurred_at ASC LIMIT 250
    )`).bind(cutoff)
  ]);
}

async function deliveryStatus(request: Request, env: ContactOperationsEnvironment) {
  const challengeId = new URL(request.url).searchParams.get('challengeId') || '';
  if (!CHALLENGE_ID_PATTERN.test(challengeId)) return json({ error: 'Invalid challenge id' }, 400);
  const rows = await env.DB.prepare(`SELECT status, reason_code, occurred_at, recorded_at
    FROM contact_delivery_events WHERE challenge_id = ? ORDER BY occurred_at, recorded_at LIMIT 50`)
    .bind(challengeId).all<DeliveryEventRow>();
  return json({
    challengeId,
    events: rows.results.map(row => ({
      status: row.status,
      reasonCode: row.reason_code,
      occurredAt: row.occurred_at,
      recordedAt: row.recorded_at
    }))
  });
}

export async function handleContactDeliveryReceiptRequest(
  request: Request,
  env: ContactOperationsEnvironment
): Promise<Response | null> {
  if (new URL(request.url).pathname !== RECEIPT_PATH) return null;
  if (!contactDeliveryReceiptReady(env)) return json({ error: 'Not found' }, 404);
  if (!authorized(request, env)) return json({ error: 'Not found' }, 404);
  if (!env.DB) return json({ error: 'Delivery storage is unavailable' }, 503);
  if (request.method === 'GET') return deliveryStatus(request, env);
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405, { allow: 'GET, POST' });

  const body = await boundedJson(request) as {
    contract?: unknown;
    eventId?: unknown;
    challengeId?: unknown;
    channel?: unknown;
    purpose?: unknown;
    providerMessageId?: unknown;
    status?: unknown;
    reasonCode?: unknown;
    occurredAt?: unknown;
  } | null;
  const occurredAt = validOccurredAt(body?.occurredAt);
  if (!body
    || body.contract !== 'contact-verification-receipt-v1'
    || typeof body.eventId !== 'string'
    || !EVENT_ID_PATTERN.test(body.eventId)
    || typeof body.challengeId !== 'string'
    || !CHALLENGE_ID_PATTERN.test(body.challengeId)
    || typeof body.channel !== 'string'
    || !CHANNELS.has(body.channel as Channel)
    || typeof body.purpose !== 'string'
    || !PURPOSES.has(body.purpose as Purpose)
    || typeof body.providerMessageId !== 'string'
    || !MESSAGE_ID_PATTERN.test(body.providerMessageId)
    || typeof body.status !== 'string'
    || !STATUSES.has(body.status as DeliveryStatus)
    || (body.reasonCode !== undefined && body.reasonCode !== null
      && (typeof body.reasonCode !== 'string' || !REASON_PATTERN.test(body.reasonCode)))
    || !occurredAt) {
    return json({ error: 'Invalid delivery receipt' }, 400);
  }

  const channel = body.channel as Channel;
  const purpose = body.purpose as Purpose;
  const status = body.status as DeliveryStatus;
  const challenge = await env.DB.prepare(`SELECT channel, purpose, provider_message_id
    FROM contact_verification_challenges WHERE challenge_id = ?`)
    .bind(body.challengeId).first<ChallengeRow>();
  if (challenge && (challenge.channel !== channel
    || challenge.purpose !== purpose
    || challenge.provider_message_id !== body.providerMessageId)) {
    return json({ error: 'Delivery receipt does not match the challenge' }, 409);
  }

  const result = await deliveryEventStatement(env, {
    eventId: body.eventId,
    challengeId: body.challengeId,
    channel,
    purpose,
    providerMessageId: body.providerMessageId,
    status,
    reasonCode: typeof body.reasonCode === 'string' ? body.reasonCode : null,
    occurredAt
  }).run();
  const duplicate = (result.meta.changes || 0) === 0;
  console.log('contact_delivery_receipt_recorded', {
    channel,
    purpose,
    status,
    duplicate,
    challengeKnown: Boolean(challenge)
  });
  await pruneContactOperationalEvents(env);
  return json({ ok: true, duplicate }, duplicate ? 200 : 202);
}
