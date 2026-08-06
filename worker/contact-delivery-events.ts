import { contactVerificationReady, type ContactVerificationEnvironment } from './contact-verification';
import {
  verificationEventSecret,
  type VerificationChannel,
  type VerificationProviderEnvironment
} from './integrations/verification';
import { runRetentionCleanup } from './retention-policy';

export type ContactDeliveryEnvironment = ContactVerificationEnvironment & VerificationProviderEnvironment;

type DeliveryStatus = 'accepted' | 'delivered' | 'deferred' | 'bounced' | 'complained' | 'failed';

type DeliveryEventBody = {
  contract: 'contact-verification-delivery-event-v1';
  eventId: string;
  challengeId: string;
  channel: VerificationChannel;
  provider: string;
  providerMessageId: string;
  status: DeliveryStatus;
  occurredAt: string;
  reasonCode?: string;
};

type ChallengeDeliveryRow = {
  challenge_id: string;
  channel: VerificationChannel;
  provider_message_id: string | null;
  created_at: string;
};

type ExistingDeliveryEventRow = {
  challenge_id: string;
  channel: VerificationChannel;
  provider: string;
  provider_message_id: string;
  status: DeliveryStatus;
  reason_code: string | null;
  occurred_at: string;
};

const DELIVERY_PATH = '/api/provider/contact-delivery/events';
const MAX_BODY_BYTES = 8_192;
const EVENT_TOLERANCE_MS = 5 * 60_000;
const EVENT_ID_PATTERN = /^[A-Za-z0-9._:/-]{8,160}$/;
const CHALLENGE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PROVIDER_PATTERN = /^[A-Za-z0-9._-]{1,80}$/;
const MESSAGE_ID_PATTERN = /^[A-Za-z0-9._:/-]{1,160}$/;
const REASON_PATTERN = /^[A-Za-z0-9._:/-]{1,80}$/;
const HEX_SIGNATURE_PATTERN = /^[0-9a-f]{64}$/i;
const STATUSES = new Set<DeliveryStatus>(['accepted', 'delivered', 'deferred', 'bounced', 'complained', 'failed']);

const json = (data: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(data), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'x-contact-delivery-contract': 'contact-verification-delivery-event-v1',
    ...headers
  }
});

function ownedBuffer(bytes: Uint8Array) {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function hexToBytes(value: string) {
  if (!HEX_SIGNATURE_PATTERN.test(value)) return null;
  return Uint8Array.from(value.match(/.{2}/g) || [], pair => Number.parseInt(pair, 16));
}

async function verifySignature(secret: string, timestamp: string, body: string, signature: Uint8Array) {
  const key = await crypto.subtle.importKey(
    'raw',
    ownedBuffer(new TextEncoder().encode(secret)),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify']
  );
  return crypto.subtle.verify(
    'HMAC',
    key,
    ownedBuffer(signature),
    ownedBuffer(new TextEncoder().encode(`${timestamp}.${body}`))
  );
}

function sqliteTime(date = new Date()) {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

function parseSqliteTime(value: string) {
  return Date.parse(value.includes('T') ? value : `${value.replace(' ', 'T')}Z`);
}

function validChannel(value: unknown): value is VerificationChannel {
  return value === 'email' || value === 'sms';
}

function validStatus(value: unknown): value is DeliveryStatus {
  return typeof value === 'string' && STATUSES.has(value as DeliveryStatus);
}

function parseBody(value: unknown): DeliveryEventBody | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const body = value as Partial<DeliveryEventBody>;
  if (body.contract !== 'contact-verification-delivery-event-v1'
    || typeof body.eventId !== 'string' || !EVENT_ID_PATTERN.test(body.eventId)
    || typeof body.challengeId !== 'string' || !CHALLENGE_ID_PATTERN.test(body.challengeId)
    || !validChannel(body.channel)
    || typeof body.provider !== 'string' || !PROVIDER_PATTERN.test(body.provider)
    || typeof body.providerMessageId !== 'string' || !MESSAGE_ID_PATTERN.test(body.providerMessageId)
    || !validStatus(body.status)
    || typeof body.occurredAt !== 'string' || !Number.isFinite(Date.parse(body.occurredAt))) return null;
  if (body.reasonCode !== undefined
    && (typeof body.reasonCode !== 'string' || !REASON_PATTERN.test(body.reasonCode))) return null;
  return body as DeliveryEventBody;
}

async function boundedBody(request: Request) {
  const declared = Number(request.headers.get('content-length') || 0);
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return null;
  const text = await request.text();
  return new TextEncoder().encode(text).byteLength <= MAX_BODY_BYTES ? text : null;
}

function eventTimestamp(request: Request) {
  const raw = (request.headers.get('x-verification-event-timestamp') || '').trim();
  if (!/^\d{10,13}$/.test(raw)) return null;
  const numeric = Number(raw);
  const milliseconds = raw.length === 10 ? numeric * 1_000 : numeric;
  return Number.isFinite(milliseconds) ? { raw, milliseconds } : null;
}

function signatureBytes(request: Request) {
  const raw = (request.headers.get('x-verification-signature') || '').trim();
  const value = raw.startsWith('sha256=') ? raw.slice(7) : raw;
  return hexToBytes(value);
}

function sameDeliveryEvent(existing: ExistingDeliveryEventRow, body: DeliveryEventBody, occurredAt: string) {
  return existing.challenge_id === body.challengeId
    && existing.channel === body.channel
    && existing.provider === body.provider
    && existing.provider_message_id === body.providerMessageId
    && existing.status === body.status
    && existing.reason_code === (body.reasonCode || null)
    && existing.occurred_at === occurredAt;
}

async function pruneDeliveryRetention(env: ContactDeliveryEnvironment, deliveryStatus: DeliveryStatus) {
  try {
    await runRetentionCleanup(env, {
      execute: true,
      scopes: ['contactDeliveryEvents', 'contactSecurityEvents']
    });
  } catch (error) {
    const name = error instanceof Error ? error.name.slice(0, 80) : 'UnknownError';
    console.error('contact_delivery_retention_failed', {
      deliveryStatus,
      name
    });
  }
}

export async function handleContactDeliveryEventRequest(
  request: Request,
  env: ContactDeliveryEnvironment,
  context?: ExecutionContext
): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== DELIVERY_PATH) return null;
  if (!contactVerificationReady('email', env) && !contactVerificationReady('sms', env)) {
    return json({ error: 'Not found' }, 404);
  }
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405, { allow: 'POST' });
  if (!env.DB) return json({ error: 'Delivery event storage is unavailable' }, 503);

  const timestamp = eventTimestamp(request);
  const signature = signatureBytes(request);
  const rawBody = await boundedBody(request);
  if (!timestamp || !signature || rawBody === null || Math.abs(Date.now() - timestamp.milliseconds) > EVENT_TOLERANCE_MS) {
    return json({ error: 'Invalid delivery event' }, 401);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return json({ error: 'Invalid delivery event' }, 400);
  }
  const body = parseBody(parsed);
  if (!body || request.headers.get('x-verification-event-id') !== body.eventId) {
    return json({ error: 'Invalid delivery event' }, 400);
  }
  if (!contactVerificationReady(body.channel, env)) return json({ error: 'Not found' }, 404);

  const secret = verificationEventSecret(body.channel, env);
  if (!secret || !await verifySignature(secret, timestamp.raw, rawBody, signature)) {
    return json({ error: 'Invalid delivery event' }, 401);
  }

  const challenge = await env.DB.prepare(`SELECT challenge_id, channel, provider_message_id, created_at
    FROM contact_verification_challenges WHERE challenge_id = ?`)
    .bind(body.challengeId).first<ChallengeDeliveryRow>();
  if (!challenge
    || challenge.channel !== body.channel
    || !challenge.provider_message_id
    || challenge.provider_message_id !== body.providerMessageId) {
    return json({ error: 'Delivery event target was not found' }, 404);
  }

  const occurredAtMs = Date.parse(body.occurredAt);
  const challengeCreatedAtMs = parseSqliteTime(challenge.created_at);
  if (occurredAtMs < challengeCreatedAtMs - EVENT_TOLERANCE_MS
    || occurredAtMs > Date.now() + EVENT_TOLERANCE_MS
    || occurredAtMs - challengeCreatedAtMs > 7 * 86_400_000) {
    return json({ error: 'Invalid delivery event time' }, 400);
  }
  const occurredAt = sqliteTime(new Date(occurredAtMs));
  const latencyMs = Math.max(0, occurredAtMs - challengeCreatedAtMs);
  const inserted = await env.DB.prepare(`INSERT OR IGNORE INTO contact_delivery_events(
    event_id, challenge_id, channel, provider, provider_message_id, status,
    reason_code, occurred_at, received_at, latency_ms
  ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
    body.eventId,
    body.challengeId,
    body.channel,
    body.provider,
    body.providerMessageId,
    body.status,
    body.reasonCode || null,
    occurredAt,
    sqliteTime(),
    latencyMs
  ).run();

  const duplicate = (inserted.meta.changes || 0) === 0;
  if (duplicate) {
    const existing = await env.DB.prepare(`SELECT challenge_id, channel, provider, provider_message_id,
      status, reason_code, occurred_at FROM contact_delivery_events WHERE event_id = ?`)
      .bind(body.eventId).first<ExistingDeliveryEventRow>();
    if (!existing || !sameDeliveryEvent(existing, body, occurredAt)) {
      return json({ error: 'Delivery event ID collision' }, 409);
    }
  }

  const retention = pruneDeliveryRetention(env, body.status);
  if (context) context.waitUntil(retention);
  else await retention;

  return json({
    ok: true,
    duplicate,
    eventId: body.eventId,
    status: body.status
  });
}
