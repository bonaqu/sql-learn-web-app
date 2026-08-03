type DeliveryChannel = 'email' | 'sms';
type DeliveryPurpose = 'register' | 'password-reset' | 'sensitive-action';
type ProviderName = 'resend' | 'twilio';
type DeliveryStatus =
  | 'reserved'
  | 'accepted'
  | 'sent'
  | 'delivered'
  | 'delayed'
  | 'bounced'
  | 'complained'
  | 'suppressed'
  | 'failed'
  | 'undelivered';
type SuppressionReason = 'hard-bounce' | 'complaint' | 'operator';

type DeliveryRequest = {
  contract: 'contact-verification-delivery-v1';
  challengeId: string;
  channel: DeliveryChannel;
  destination: string;
  purpose: DeliveryPurpose;
  code: string;
  expiresAt: string;
  sourceKey: string;
};

type DeliveryAttemptRow = {
  challenge_id: string;
  channel: DeliveryChannel;
  purpose: DeliveryPurpose;
  destination_hash: string;
  provider: ProviderName;
  provider_message_id: string | null;
  status: DeliveryStatus;
  error_code: string | null;
  expires_at: string;
  created_at: string;
  updated_at: string;
  delivered_at: string | null;
};

type ProviderEvent = {
  provider: ProviderName;
  providerEventId: string;
  providerMessageId: string;
  eventType: string;
  status: DeliveryStatus;
  suppressionReason: SuppressionReason | null;
};

type StoredProviderEventRow = {
  provider_event_id: string;
  provider: ProviderName;
  provider_message_id: string;
  event_type: string;
};

const DELIVERY_CONTRACT = 'contact-verification-delivery-v1';
const MAX_DELIVERY_BODY_BYTES = 4_096;
const MAX_WEBHOOK_BODY_BYTES = 64 * 1_024;
const MAX_PROVIDER_RESPONSE_BYTES = 32 * 1_024;
const PROVIDER_TIMEOUT_MS = 7_000;
const SIGNATURE_TOLERANCE_SECONDS = 5 * 60;
const CHALLENGE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DIGEST_PATTERN = /^[0-9a-f]{64}$/;
const CODE_PATTERN = /^[0-9]{6}$/;
const PURPOSES = new Set<DeliveryPurpose>(['register', 'password-reset', 'sensitive-action']);
const CHANNELS = new Set<DeliveryChannel>(['email', 'sms']);
const encoder = new TextEncoder();

const responseHeaders = {
  'cache-control': 'no-store',
  'content-type': 'application/json; charset=utf-8',
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
  'x-contact-provider-contract': 'contact-provider-gateway-v1'
};

function json(data: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...responseHeaders, ...headers }
  });
}

function safeError(code: string, status: number, retryAfterSeconds?: number) {
  return json(
    { error: code },
    status,
    retryAfterSeconds ? { 'retry-after': String(retryAfterSeconds) } : {}
  );
}

function secret(value: string | undefined, minimum = 16, maximum = 2_000) {
  const normalized = (value || '').trim();
  return normalized.length >= minimum && normalized.length <= maximum ? normalized : '';
}

function featureOn(value: string | undefined) {
  return value?.trim().toLowerCase() === 'on';
}

function boundedInteger(value: string | undefined, fallback: number, minimum: number, maximum: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : fallback;
}

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

function base64ToBytes(value: string) {
  try {
    const binary = atob(value);
    return Uint8Array.from(binary, character => character.charCodeAt(0));
  } catch {
    return null;
  }
}

function ownedBuffer(bytes: Uint8Array) {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array) {
  if (left.byteLength !== right.byteLength) return false;
  let difference = 0;
  for (let index = 0; index < left.byteLength; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

async function digestBytes(value: string) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', ownedBuffer(encoder.encode(value))));
}

async function sha256Hex(value: string) {
  return bytesToHex(await digestBytes(value));
}

async function secretMatches(candidate: string, expected: string) {
  const boundedCandidate = secret(candidate, 1, 4_096);
  if (!boundedCandidate || !expected) return false;
  const [candidateDigest, expectedDigest] = await Promise.all([
    digestBytes(boundedCandidate),
    digestBytes(expected)
  ]);
  return constantTimeEqual(candidateDigest, expectedDigest);
}

async function hmacBytes(secretValue: string, value: string, hash: 'SHA-1' | 'SHA-256' = 'SHA-256') {
  const key = await crypto.subtle.importKey(
    'raw',
    ownedBuffer(encoder.encode(secretValue)),
    { name: 'HMAC', hash },
    false,
    ['sign']
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, ownedBuffer(encoder.encode(value))));
}

async function pseudonym(env: Cloudflare.Env, namespace: string, value: string) {
  const hmacSecret = secret(env.PII_HMAC_SECRET, 32);
  if (!hmacSecret) throw new Error('PII_HMAC_SECRET_MISSING');
  return bytesToHex(await hmacBytes(hmacSecret, `sql-academy/contact-provider/v1:${namespace}:${value}`));
}

async function authenticated(request: Request, env: Cloudflare.Env) {
  const expected = secret(env.DELIVERY_WEBHOOK_SECRET, 32);
  const authorization = request.headers.get('authorization') || '';
  const candidate = authorization.startsWith('Bearer ') ? authorization.slice('Bearer '.length).trim() : '';
  return expected ? secretMatches(candidate, expected) : false;
}

async function boundedRequestText(request: Request, maximumBytes: number) {
  const declared = Number(request.headers.get('content-length') || 0);
  if (Number.isFinite(declared) && declared > maximumBytes) return null;
  try {
    const body = await request.text();
    return encoder.encode(body).byteLength <= maximumBytes ? body : null;
  } catch {
    return null;
  }
}

async function boundedResponseText(response: Response, maximumBytes: number) {
  const declared = Number(response.headers.get('content-length') || 0);
  if (Number.isFinite(declared) && declared > maximumBytes) throw new Error('PROVIDER_RESPONSE_TOO_LARGE');
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximumBytes) throw new Error('PROVIDER_RESPONSE_TOO_LARGE');
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const combined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(combined);
}

async function providerFetch(input: RequestInfo | URL, init: RequestInit) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort('provider-timeout'), PROVIDER_TIMEOUT_MS);
  try {
    return await fetch(input, { ...init, signal: controller.signal, redirect: 'error' });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw new Error('PROVIDER_TIMEOUT');
    throw new Error('PROVIDER_UNAVAILABLE');
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeEmail(value: string) {
  const candidate = value.trim().normalize('NFKC').toLowerCase();
  if (candidate.length < 3 || candidate.length > 254 || /\s/.test(candidate)) return null;
  const separator = candidate.lastIndexOf('@');
  if (separator <= 0 || separator !== candidate.indexOf('@')) return null;
  const local = candidate.slice(0, separator);
  const domain = candidate.slice(separator + 1);
  if (local.length > 64 || local.startsWith('.') || local.endsWith('.') || local.includes('..')) return null;
  if (!/^[a-z0-9.!#$%&'*+\/=?^_`{|}~-]+$/i.test(local)) return null;
  const labels = domain.split('.');
  if (domain.length > 253 || labels.length < 2) return null;
  if (!labels.every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label))) return null;
  return `${local}@${domain}`;
}

function normalizePhone(value: string) {
  const candidate = value.trim().replace(/[\s().-]/g, '');
  return /^\+[1-9][0-9]{7,14}$/.test(candidate) ? candidate : null;
}

function normalizeDestination(channel: DeliveryChannel, value: string) {
  return channel === 'email' ? normalizeEmail(value) : normalizePhone(value);
}

function parseDeliveryRequest(value: unknown): DeliveryRequest | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<Record<keyof DeliveryRequest, unknown>>;
  if (candidate.contract !== DELIVERY_CONTRACT) return null;
  if (typeof candidate.challengeId !== 'string' || !CHALLENGE_ID_PATTERN.test(candidate.challengeId)) return null;
  if (typeof candidate.channel !== 'string' || !CHANNELS.has(candidate.channel as DeliveryChannel)) return null;
  if (typeof candidate.purpose !== 'string' || !PURPOSES.has(candidate.purpose as DeliveryPurpose)) return null;
  if (typeof candidate.destination !== 'string' || candidate.destination.length > 320) return null;
  if (typeof candidate.code !== 'string' || !CODE_PATTERN.test(candidate.code)) return null;
  if (typeof candidate.sourceKey !== 'string' || !DIGEST_PATTERN.test(candidate.sourceKey)) return null;
  if (typeof candidate.expiresAt !== 'string') return null;
  const expiry = Date.parse(candidate.expiresAt);
  if (!Number.isFinite(expiry) || expiry <= Date.now() || expiry > Date.now() + 15 * 60_000) return null;
  return {
    contract: DELIVERY_CONTRACT,
    challengeId: candidate.challengeId,
    channel: candidate.channel as DeliveryChannel,
    destination: candidate.destination,
    purpose: candidate.purpose as DeliveryPurpose,
    code: candidate.code,
    expiresAt: new Date(expiry).toISOString(),
    sourceKey: candidate.sourceKey
  };
}

function publicBaseUrl(env: Cloudflare.Env) {
  const configured = (env.PUBLIC_BASE_URL || '').trim().replace(/\/$/, '');
  if (!configured) return null;
  try {
    const parsed = new URL(configured);
    return parsed.protocol === 'https:' && !parsed.username && !parsed.password && !parsed.hash
      ? parsed.origin + parsed.pathname.replace(/\/$/, '')
      : null;
  } catch {
    return null;
  }
}

function providerReady(channel: DeliveryChannel, env: Cloudflare.Env) {
  if (!secret(env.DELIVERY_WEBHOOK_SECRET, 32) || !secret(env.PII_HMAC_SECRET, 32)) return false;
  if (channel === 'email') {
    return featureOn(env.FEATURE_EMAIL_DELIVERY)
      && Boolean((env.RESEND_FROM || '').trim())
      && Boolean(secret(env.RESEND_API_KEY, 16))
      && Boolean(secret(env.RESEND_WEBHOOK_SECRET, 16));
  }
  return featureOn(env.FEATURE_SMS_DELIVERY)
    && Boolean(publicBaseUrl(env))
    && Boolean((env.TWILIO_MESSAGING_SERVICE_SID || '').trim().match(/^MG[0-9a-f]{32}$/i))
    && Boolean(secret(env.TWILIO_ACCOUNT_SID, 16))
    && Boolean(secret(env.TWILIO_AUTH_TOKEN, 16));
}

function purposeLabel(purpose: DeliveryPurpose) {
  if (purpose === 'register') return 'регистрации';
  if (purpose === 'password-reset') return 'восстановления пароля';
  return 'подтверждения действия';
}

async function sendWithResend(payload: DeliveryRequest, destination: string, env: Cloudflare.Env) {
  const apiKey = secret(env.RESEND_API_KEY, 16);
  const from = (env.RESEND_FROM || '').trim();
  if (!apiKey || !from) throw new Error('EMAIL_PROVIDER_DISABLED');
  const label = purposeLabel(payload.purpose);
  const response = await providerFetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json; charset=utf-8',
      'idempotency-key': payload.challengeId
    },
    body: JSON.stringify({
      from,
      to: [destination],
      subject: `Код SQL Academy для ${label}`,
      text: `Код SQL Academy: ${payload.code}. Он действует до ${payload.expiresAt}. Никому не сообщайте этот код.`,
      html: `<p>Код SQL Academy для ${label}: <strong>${payload.code}</strong></p><p>Действует до ${payload.expiresAt}. Никому не сообщайте этот код.</p>`,
      headers: { 'X-SQL-Academy-Challenge': payload.challengeId },
      tags: [{ name: 'purpose', value: payload.purpose.replace(/-/g, '_') }]
    })
  });
  const body = await boundedResponseText(response, MAX_PROVIDER_RESPONSE_BYTES);
  if (!response.ok) throw new Error(`RESEND_REJECTED_${response.status}`);
  try {
    const parsed = JSON.parse(body) as { id?: unknown };
    if (typeof parsed.id !== 'string' || !parsed.id || parsed.id.length > 160) throw new Error();
    return parsed.id;
  } catch {
    throw new Error('RESEND_RESPONSE_INVALID');
  }
}

async function sendWithTwilio(payload: DeliveryRequest, destination: string, env: Cloudflare.Env) {
  const accountSid = secret(env.TWILIO_ACCOUNT_SID, 16);
  const authToken = secret(env.TWILIO_AUTH_TOKEN, 16);
  const messagingServiceSid = (env.TWILIO_MESSAGING_SERVICE_SID || '').trim();
  const baseUrl = publicBaseUrl(env);
  if (!accountSid || !authToken || !messagingServiceSid || !baseUrl) throw new Error('SMS_PROVIDER_DISABLED');
  const form = new URLSearchParams({
    To: destination,
    MessagingServiceSid: messagingServiceSid,
    Body: `SQL Academy: код ${payload.code}. Никому его не сообщайте.`,
    StatusCallback: `${baseUrl}/webhooks/twilio`
  });
  const response = await providerFetch(
    `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`,
    {
      method: 'POST',
      headers: {
        authorization: `Basic ${btoa(`${accountSid}:${authToken}`)}`,
        'content-type': 'application/x-www-form-urlencoded; charset=utf-8'
      },
      body: form.toString()
    }
  );
  const body = await boundedResponseText(response, MAX_PROVIDER_RESPONSE_BYTES);
  if (!response.ok) throw new Error(`TWILIO_REJECTED_${response.status}`);
  try {
    const parsed = JSON.parse(body) as { sid?: unknown };
    if (typeof parsed.sid !== 'string' || !/^SM[0-9a-f]{32}$/i.test(parsed.sid)) throw new Error();
    return parsed.sid;
  } catch {
    throw new Error('TWILIO_RESPONSE_INVALID');
  }
}

function sanitizedProviderError(error: unknown) {
  const code = error instanceof Error ? error.message : 'PROVIDER_UNAVAILABLE';
  if (/^(?:RESEND|TWILIO)_REJECTED_[0-9]{3}$/.test(code)) return code;
  return new Set([
    'PROVIDER_TIMEOUT',
    'PROVIDER_UNAVAILABLE',
    'PROVIDER_RESPONSE_TOO_LARGE',
    'RESEND_RESPONSE_INVALID',
    'TWILIO_RESPONSE_INVALID',
    'EMAIL_PROVIDER_DISABLED',
    'SMS_PROVIDER_DISABLED'
  ]).has(code) ? code : 'PROVIDER_UNAVAILABLE';
}

async function existingAttempt(env: Cloudflare.Env, challengeId: string) {
  return env.DELIVERY_DB.prepare(
    `SELECT challenge_id, channel, purpose, destination_hash, provider, provider_message_id,
            status, error_code, expires_at, created_at, updated_at, delivered_at
       FROM contact_delivery_attempts
      WHERE challenge_id = ?1`
  ).bind(challengeId).first<DeliveryAttemptRow>();
}

function publicAttempt(row: DeliveryAttemptRow) {
  return {
    challengeId: row.challenge_id,
    channel: row.channel,
    purpose: row.purpose,
    provider: row.provider,
    status: row.status,
    errorCode: row.error_code,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deliveredAt: row.delivered_at
  };
}

function messageIdHeader(providerMessageId: string | null) {
  return providerMessageId ? { 'x-verification-message-id': providerMessageId } : {};
}

async function consumeAbuseBucket(
  env: Cloudflare.Env,
  scope: 'destination' | 'source',
  subjectHash: string,
  limit: number
) {
  const windowStart = `${new Date().toISOString().slice(0, 13)}:00:00.000Z`;
  const row = await env.DELIVERY_DB.prepare(
    `INSERT INTO contact_delivery_abuse_buckets(scope, subject_hash, window_start, attempts, updated_at)
     VALUES (?1, ?2, ?3, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
     ON CONFLICT(scope, subject_hash, window_start) DO UPDATE SET
       attempts = attempts + 1,
       updated_at = excluded.updated_at
     RETURNING attempts`
  ).bind(scope, subjectHash, windowStart).first<{ attempts: number }>();
  return Boolean(row && row.attempts <= limit);
}

function allowedPriorStatuses(nextStatus: DeliveryStatus): DeliveryStatus[] {
  const transitions: Record<DeliveryStatus, DeliveryStatus[]> = {
    reserved: ['reserved'],
    accepted: ['reserved', 'accepted'],
    sent: ['reserved', 'accepted', 'sent'],
    delayed: ['reserved', 'accepted', 'sent', 'delayed'],
    delivered: ['reserved', 'accepted', 'sent', 'delayed', 'delivered'],
    bounced: ['reserved', 'accepted', 'sent', 'delayed', 'bounced'],
    failed: ['reserved', 'accepted', 'sent', 'delayed', 'failed'],
    undelivered: ['reserved', 'accepted', 'sent', 'delayed', 'undelivered'],
    complained: ['reserved', 'accepted', 'sent', 'delayed', 'delivered', 'bounced', 'complained'],
    suppressed: ['reserved', 'accepted', 'sent', 'delayed', 'delivered', 'bounced', 'failed', 'undelivered', 'complained', 'suppressed']
  };
  return transitions[nextStatus];
}

function persistedEventSemantics(
  provider: ProviderName,
  providerEventId: string,
  providerMessageId: string,
  eventType: string
): ProviderEvent | null {
  if (provider === 'resend') {
    const states: Record<string, { status: DeliveryStatus; suppressionReason: SuppressionReason | null }> = {
      'email.sent': { status: 'sent', suppressionReason: null },
      'email.delivered': { status: 'delivered', suppressionReason: null },
      'email.delivery_delayed': { status: 'delayed', suppressionReason: null },
      'email.bounced.transient': { status: 'delayed', suppressionReason: null },
      'email.bounced.permanent': { status: 'bounced', suppressionReason: 'hard-bounce' },
      'email.bounced': { status: 'bounced', suppressionReason: null },
      'email.complained': { status: 'complained', suppressionReason: 'complaint' },
      'email.suppressed': { status: 'suppressed', suppressionReason: 'hard-bounce' },
      'email.failed': { status: 'failed', suppressionReason: null }
    };
    const semantics = states[eventType];
    return semantics ? {
      provider,
      providerEventId,
      providerMessageId,
      eventType,
      ...semantics
    } : null;
  }
  const twilioStates: Record<string, DeliveryStatus> = {
    'message.accepted': 'accepted',
    'message.scheduled': 'accepted',
    'message.queued': 'accepted',
    'message.sending': 'accepted',
    'message.sent': 'sent',
    'message.delivered': 'delivered',
    'message.failed': 'failed',
    'message.undelivered': 'undelivered'
  };
  const status = twilioStates[eventType];
  return status ? {
    provider,
    providerEventId,
    providerMessageId,
    eventType,
    status,
    suppressionReason: null
  } : null;
}

async function applyProviderEventToAttempt(env: Cloudflare.Env, event: ProviderEvent) {
  const attempt = await env.DELIVERY_DB.prepare(
    `SELECT challenge_id, destination_hash
       FROM contact_delivery_attempts
      WHERE provider = ?1 AND provider_message_id = ?2`
  ).bind(event.provider, event.providerMessageId).first<{ challenge_id: string; destination_hash: string }>();
  if (!attempt) return false;

  await env.DELIVERY_DB.prepare(
    `UPDATE contact_delivery_events
        SET challenge_id = ?2
      WHERE provider_event_id = ?1 AND challenge_id IS NULL`
  ).bind(event.providerEventId, attempt.challenge_id).run();

  const priorStatuses = allowedPriorStatuses(event.status);
  const placeholders = priorStatuses.map((_, index) => `?${index + 4}`).join(', ');
  const errorCode = event.eventType.replace(/[^a-z0-9]+/gi, '_').slice(0, 80).toUpperCase();
  const updated = await env.DELIVERY_DB.prepare(
    `UPDATE contact_delivery_attempts
        SET status = ?1,
            error_code = CASE WHEN ?1 IN ('failed', 'bounced', 'complained', 'suppressed', 'undelivered') THEN ?2 ELSE NULL END,
            delivered_at = CASE WHEN ?1 = 'delivered' THEN COALESCE(delivered_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) ELSE delivered_at END,
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE challenge_id = ?3 AND status IN (${placeholders})`
  ).bind(event.status, errorCode, attempt.challenge_id, ...priorStatuses).run();

  if ((updated.meta.changes || 0) !== 1 || !event.suppressionReason) return true;
  await env.DELIVERY_DB.prepare(
    `INSERT INTO contact_delivery_suppressions(destination_hash, reason, provider_event_id, created_at, released_at)
     VALUES (?1, ?2, ?3, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), NULL)
     ON CONFLICT(destination_hash) DO UPDATE SET
       reason = excluded.reason,
       provider_event_id = excluded.provider_event_id,
       created_at = excluded.created_at,
       released_at = NULL`
  ).bind(attempt.destination_hash, event.suppressionReason, event.providerEventId).run();
  return true;
}

async function recordProviderEvent(env: Cloudflare.Env, event: ProviderEvent) {
  await env.DELIVERY_DB.prepare(
    `INSERT OR IGNORE INTO contact_delivery_events(
       provider_event_id, challenge_id, provider, provider_message_id, event_type, received_at
     ) VALUES (
       ?1,
       (SELECT challenge_id FROM contact_delivery_attempts WHERE provider = ?2 AND provider_message_id = ?3 LIMIT 1),
       ?2, ?3, ?4, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     )`
  ).bind(
    event.providerEventId,
    event.provider,
    event.providerMessageId,
    event.eventType
  ).run();
  await applyProviderEventToAttempt(env, event);
}

async function reconcileProviderEvents(env: Cloudflare.Env, provider: ProviderName, providerMessageId: string) {
  const pending = await env.DELIVERY_DB.prepare(
    `SELECT provider_event_id, provider, provider_message_id, event_type
       FROM contact_delivery_events
      WHERE provider = ?1 AND provider_message_id = ?2 AND challenge_id IS NULL
      ORDER BY received_at ASC, provider_event_id ASC`
  ).bind(provider, providerMessageId).all<StoredProviderEventRow>();
  for (const row of pending.results || []) {
    const event = persistedEventSemantics(
      row.provider,
      row.provider_event_id,
      row.provider_message_id,
      row.event_type
    );
    if (event) await applyProviderEventToAttempt(env, event);
  }
}

async function handleDelivery(request: Request, env: Cloudflare.Env) {
  if (!(await authenticated(request, env))) return safeError('UNAUTHORIZED', 401);
  const text = await boundedRequestText(request, MAX_DELIVERY_BODY_BYTES);
  if (text === null) return safeError('INVALID_DELIVERY_REQUEST', 400);
  let decoded: unknown;
  try {
    decoded = JSON.parse(text);
  } catch {
    return safeError('INVALID_DELIVERY_REQUEST', 400);
  }
  const payload = parseDeliveryRequest(decoded);
  if (!payload) return safeError('INVALID_DELIVERY_REQUEST', 400);
  const destination = normalizeDestination(payload.channel, payload.destination);
  if (!destination) return safeError('INVALID_DESTINATION', 400);
  if (!providerReady(payload.channel, env)) return safeError('CHANNEL_DISABLED', 404);

  const destinationHash = await pseudonym(env, `destination:${payload.channel}`, destination);
  const sourceHash = await pseudonym(env, 'source', payload.sourceKey);
  const existing = await existingAttempt(env, payload.challengeId);
  if (existing) {
    if (existing.channel !== payload.channel || existing.purpose !== payload.purpose || existing.destination_hash !== destinationHash) {
      return safeError('CHALLENGE_CONFLICT', 409);
    }
    return json(
      publicAttempt(existing),
      existing.status === 'failed' ? 502 : 200,
      messageIdHeader(existing.provider_message_id)
    );
  }

  const suppression = await env.DELIVERY_DB.prepare(
    `SELECT reason FROM contact_delivery_suppressions
      WHERE destination_hash = ?1 AND released_at IS NULL`
  ).bind(destinationHash).first<{ reason: string }>();
  if (suppression) return safeError('DESTINATION_SUPPRESSED', 429, 3_600);

  const destinationLimit = boundedInteger(env.DESTINATION_LIMIT_PER_HOUR, 5, 1, 20);
  const sourceLimit = boundedInteger(env.SOURCE_LIMIT_PER_HOUR, 20, 1, 100);
  const destinationAllowed = await consumeAbuseBucket(env, 'destination', destinationHash, destinationLimit);
  const sourceAllowed = await consumeAbuseBucket(env, 'source', sourceHash, sourceLimit);
  if (!destinationAllowed || !sourceAllowed) return safeError('DELIVERY_RATE_LIMITED', 429, 3_600);

  const provider: ProviderName = payload.channel === 'email' ? 'resend' : 'twilio';
  const reserved = await env.DELIVERY_DB.prepare(
    `INSERT OR IGNORE INTO contact_delivery_attempts(
       challenge_id, channel, purpose, destination_hash, source_hash, provider,
       status, expires_at, created_at, updated_at
     ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'reserved', ?7,
       strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`
  ).bind(
    payload.challengeId,
    payload.channel,
    payload.purpose,
    destinationHash,
    sourceHash,
    provider,
    payload.expiresAt
  ).run();
  if (reserved.meta.changes !== 1) {
    const raced = await existingAttempt(env, payload.challengeId);
    return raced
      ? json(publicAttempt(raced), 200, messageIdHeader(raced.provider_message_id))
      : safeError('CHALLENGE_RESERVATION_FAILED', 409);
  }

  try {
    const providerMessageId = payload.channel === 'email'
      ? await sendWithResend(payload, destination, env)
      : await sendWithTwilio(payload, destination, env);
    const persisted = await env.DELIVERY_DB.prepare(
      `UPDATE contact_delivery_attempts
          SET provider_message_id = ?2,
              status = CASE WHEN status = 'reserved' THEN 'accepted' ELSE status END,
              error_code = CASE WHEN status = 'reserved' THEN NULL ELSE error_code END,
              updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE challenge_id = ?1 AND provider_message_id IS NULL`
    ).bind(payload.challengeId, providerMessageId).run();
    if ((persisted.meta.changes || 0) !== 1) throw new Error('DELIVERY_STATE_UNAVAILABLE');
    await reconcileProviderEvents(env, provider, providerMessageId);
    const accepted = await existingAttempt(env, payload.challengeId);
    return accepted
      ? json(publicAttempt(accepted), 202, messageIdHeader(providerMessageId))
      : safeError('DELIVERY_STATE_UNAVAILABLE', 503);
  } catch (error) {
    const errorCode = sanitizedProviderError(error);
    await env.DELIVERY_DB.prepare(
      `UPDATE contact_delivery_attempts
          SET status = 'failed', error_code = ?2,
              updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE challenge_id = ?1 AND status IN ('reserved', 'accepted')`
    ).bind(payload.challengeId, errorCode).run();
    return safeError(errorCode, 502, 30);
  }
}

async function verifyResendSignature(rawBody: string, request: Request, env: Cloudflare.Env) {
  const secretValue = secret(env.RESEND_WEBHOOK_SECRET, 16);
  const eventId = (request.headers.get('svix-id') || '').trim();
  const timestamp = (request.headers.get('svix-timestamp') || '').trim();
  const signatures = (request.headers.get('svix-signature') || '').trim().split(/\s+/);
  if (!secretValue || !eventId || eventId.length > 200 || !/^[0-9]{10}$/.test(timestamp) || signatures.length === 0) return null;
  const seconds = Number(timestamp);
  if (!Number.isFinite(seconds) || Math.abs(Date.now() / 1_000 - seconds) > SIGNATURE_TOLERANCE_SECONDS) return null;
  const encodedSecret = secretValue.startsWith('whsec_') ? secretValue.slice('whsec_'.length) : secretValue;
  const keyBytes = base64ToBytes(encodedSecret);
  if (!keyBytes) return null;
  const key = await crypto.subtle.importKey(
    'raw',
    ownedBuffer(keyBytes),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const expected = new Uint8Array(await crypto.subtle.sign(
    'HMAC',
    key,
    ownedBuffer(encoder.encode(`${eventId}.${timestamp}.${rawBody}`))
  ));
  const valid = signatures.some(item => {
    const encoded = item.startsWith('v1,') ? item.slice(3) : '';
    const actual = encoded ? base64ToBytes(encoded) : null;
    return Boolean(actual && constantTimeEqual(actual, expected));
  });
  return valid ? eventId : null;
}

function parseResendEvent(rawBody: string, providerEventId: string): ProviderEvent | null {
  const parsed = JSON.parse(rawBody) as {
    type?: unknown;
    data?: {
      email_id?: unknown;
      id?: unknown;
      bounce?: { type?: unknown };
    };
  };
  const rawEventType = typeof parsed.type === 'string' ? parsed.type : '';
  const providerMessageId = typeof parsed.data?.email_id === 'string'
    ? parsed.data.email_id
    : typeof parsed.data?.id === 'string'
      ? parsed.data.id
      : '';
  if (!providerMessageId || providerMessageId.length > 160) return null;
  const bounceType = typeof parsed.data?.bounce?.type === 'string'
    ? parsed.data.bounce.type.trim().toLowerCase()
    : '';
  const eventType = rawEventType === 'email.bounced' && bounceType === 'transient'
    ? 'email.bounced.transient'
    : rawEventType === 'email.bounced' && bounceType === 'permanent'
      ? 'email.bounced.permanent'
      : rawEventType;
  return persistedEventSemantics('resend', providerEventId, providerMessageId, eventType);
}

async function handleResendWebhook(request: Request, env: Cloudflare.Env) {
  const rawBody = await boundedRequestText(request, MAX_WEBHOOK_BODY_BYTES);
  if (rawBody === null) return safeError('INVALID_PROVIDER_WEBHOOK', 400);
  const providerEventId = await verifyResendSignature(rawBody, request, env);
  if (!providerEventId) return safeError('INVALID_PROVIDER_SIGNATURE', 401);
  try {
    const event = parseResendEvent(rawBody, providerEventId);
    if (!event) return json({ accepted: true }, 202);
    await recordProviderEvent(env, event);
    return json({ accepted: true });
  } catch {
    return safeError('INVALID_PROVIDER_WEBHOOK', 400);
  }
}

async function verifyTwilioSignature(rawBody: string, request: Request, env: Cloudflare.Env) {
  const authToken = secret(env.TWILIO_AUTH_TOKEN, 16);
  const baseUrl = publicBaseUrl(env);
  const signature = (request.headers.get('x-twilio-signature') || '').trim();
  if (!authToken || !baseUrl || !signature) return false;
  const parameters = new URLSearchParams(rawBody);
  const names = [...new Set(parameters.keys())].sort();
  let signed = `${baseUrl}/webhooks/twilio`;
  for (const name of names) {
    for (const value of parameters.getAll(name).sort()) signed += `${name}${value}`;
  }
  const expected = await hmacBytes(authToken, signed, 'SHA-1');
  const actual = base64ToBytes(signature);
  return Boolean(actual && constantTimeEqual(actual, expected));
}

function twilioStatus(value: string): DeliveryStatus | null {
  const states: Record<string, DeliveryStatus> = {
    accepted: 'accepted',
    scheduled: 'accepted',
    queued: 'accepted',
    sending: 'accepted',
    sent: 'sent',
    delivered: 'delivered',
    failed: 'failed',
    undelivered: 'undelivered'
  };
  return states[value.toLowerCase()] || null;
}

async function handleTwilioWebhook(request: Request, env: Cloudflare.Env) {
  const rawBody = await boundedRequestText(request, MAX_WEBHOOK_BODY_BYTES);
  if (rawBody === null) return safeError('INVALID_PROVIDER_WEBHOOK', 400);
  if (!(await verifyTwilioSignature(rawBody, request, env))) return safeError('INVALID_PROVIDER_SIGNATURE', 401);
  const parameters = new URLSearchParams(rawBody);
  const providerMessageId = parameters.get('MessageSid') || parameters.get('SmsSid') || '';
  const rawStatus = parameters.get('MessageStatus') || parameters.get('SmsStatus') || '';
  const status = twilioStatus(rawStatus);
  if (!/^SM[0-9a-f]{32}$/i.test(providerMessageId) || !status) return json({ accepted: true }, 202);
  await recordProviderEvent(env, {
    provider: 'twilio',
    providerEventId: `twilio:${await sha256Hex(`${providerMessageId}:${rawStatus}:${rawBody}`)}`,
    providerMessageId,
    eventType: `message.${rawStatus.toLowerCase()}`,
    status,
    suppressionReason: null
  });
  return json({ accepted: true });
}

async function handleStatus(request: Request, env: Cloudflare.Env, challengeId: string) {
  if (!(await authenticated(request, env))) return safeError('UNAUTHORIZED', 401);
  if (!CHALLENGE_ID_PATTERN.test(challengeId)) return safeError('INVALID_CHALLENGE_ID', 400);
  const row = await existingAttempt(env, challengeId);
  return row ? json(publicAttempt(row)) : safeError('DELIVERY_NOT_FOUND', 404);
}

async function handleHealth(request: Request, env: Cloudflare.Env) {
  if (!(await authenticated(request, env))) return safeError('UNAUTHORIZED', 401);
  const statusRows = await env.DELIVERY_DB.prepare(
    `SELECT status, COUNT(*) AS count
       FROM contact_delivery_attempts
      WHERE datetime(created_at) >= datetime('now', '-24 hours')
      GROUP BY status`
  ).all<{ status: DeliveryStatus; count: number }>();
  const activeSuppressions = await env.DELIVERY_DB.prepare(
    `SELECT COUNT(*) AS count
       FROM contact_delivery_suppressions
      WHERE released_at IS NULL`
  ).first<{ count: number }>();
  const pendingCallbacks = await env.DELIVERY_DB.prepare(
    `SELECT COUNT(*) AS count
       FROM contact_delivery_events
      WHERE challenge_id IS NULL AND datetime(received_at) >= datetime('now', '-24 hours')`
  ).first<{ count: number }>();
  return json({
    contract: 'contact-provider-health-v1',
    environment: env.ENVIRONMENT || 'unknown',
    capabilities: {
      email: providerReady('email', env),
      sms: providerReady('sms', env)
    },
    last24Hours: Object.fromEntries((statusRows.results || []).map(row => [row.status, row.count])),
    activeSuppressions: activeSuppressions?.count || 0,
    pendingCallbacks: pendingCallbacks?.count || 0,
    generatedAt: new Date().toISOString()
  });
}

async function purgeExpiredEvidence(env: Cloudflare.Env) {
  const retentionDays = boundedInteger(env.STATUS_RETENTION_DAYS, 30, 7, 180);
  await env.DELIVERY_DB.batch([
    env.DELIVERY_DB.prepare(
      `DELETE FROM contact_delivery_events
        WHERE datetime(received_at) < datetime('now', ?1)`
    ).bind(`-${retentionDays} days`),
    env.DELIVERY_DB.prepare(
      `DELETE FROM contact_delivery_attempts
        WHERE datetime(updated_at) < datetime('now', ?1)`
    ).bind(`-${retentionDays} days`),
    env.DELIVERY_DB.prepare(
      `DELETE FROM contact_delivery_abuse_buckets
        WHERE datetime(window_start) < datetime('now', '-2 days')`
    )
  ]);
}

function decodedChallengeId(pathname: string) {
  try {
    return decodeURIComponent(pathname.slice('/v1/status/'.length));
  } catch {
    return '';
  }
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === 'POST' && url.pathname === '/v1/deliver') return handleDelivery(request, env);
    if (request.method === 'POST' && url.pathname === '/webhooks/resend') return handleResendWebhook(request, env);
    if (request.method === 'POST' && url.pathname === '/webhooks/twilio') return handleTwilioWebhook(request, env);
    if (request.method === 'GET' && url.pathname === '/v1/health') return handleHealth(request, env);
    if (request.method === 'GET' && url.pathname.startsWith('/v1/status/')) {
      return handleStatus(request, env, decodedChallengeId(url.pathname));
    }
    return safeError('NOT_FOUND', 404);
  },
  async scheduled(_controller, env, ctx): Promise<void> {
    ctx.waitUntil(purgeExpiredEvidence(env));
  }
} satisfies ExportedHandler<Cloudflare.Env>;
