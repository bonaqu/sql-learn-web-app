import {
  verificationProvider,
  verificationProviderReady,
  type VerificationChannel,
  type VerificationProviderEnvironment,
  type VerificationPurpose
} from './integrations/verification';

type ContactEnvironmentKey =
  | 'FEATURE_EMAIL_VERIFICATION'
  | 'FEATURE_SMS_VERIFICATION'
  | 'CONTACT_VERIFICATION_SIGNING_SECRET';

export type ContactVerificationEnvironment = VerificationProviderEnvironment
  & Partial<Record<ContactEnvironmentKey, string>>;

type ContactChallengeRow = {
  challenge_id: string;
  channel: VerificationChannel;
  purpose: VerificationPurpose;
  destination_digest: string;
  masked_destination: string;
  code_verifier: string;
  provider_message_id: string | null;
  attempts_remaining: number;
  expires_at: string;
  confirmed_at: string | null;
  consumed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type ContactVerificationTicketPayload = {
  version: 1;
  challengeId: string;
  channel: VerificationChannel;
  purpose: VerificationPurpose;
  destinationDigest: string;
  issuedAt: string;
  expiresAt: string;
};

type TicketExpectation = Partial<Pick<ContactVerificationTicketPayload,
  'channel' | 'purpose' | 'destinationDigest'>>;

const PURPOSES = new Set<VerificationPurpose>(['register', 'password-reset', 'sensitive-action']);
const CHANNELS = new Set<VerificationChannel>(['email', 'sms']);
const CHALLENGE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DIGEST_PATTERN = /^[0-9a-f]{64}$/;
const CODE_PATTERN = /^[0-9]{6}$/;
const CHALLENGE_TTL_MS = 10 * 60_000;
const TICKET_TTL_MS = 10 * 60_000;
const RESEND_COOLDOWN_MS = 60_000;
const CHALLENGE_WINDOW_MS = 15 * 60_000;
const MAX_CHALLENGES_PER_WINDOW = 3;
const MAX_CODE_ATTEMPTS = 5;
const MAX_JSON_BYTES = 4_096;

const json = (data: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(data), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'x-contact-verification-contract': 'contact-verification-v1',
    ...headers
  }
});

function sqliteTime(date = new Date()) {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

function parseSqliteTime(value: string | null | undefined) {
  if (!value) return 0;
  return Date.parse(value.includes('T') ? value : `${value.replace(' ', 'T')}Z`);
}

function featureEnabled(channel: VerificationChannel, env: ContactVerificationEnvironment) {
  const value = channel === 'email'
    ? env.FEATURE_EMAIL_VERIFICATION
    : env.FEATURE_SMS_VERIFICATION;
  return value?.trim().toLowerCase() === 'on';
}

export function contactVerificationSigningSecret(env: ContactVerificationEnvironment) {
  const value = (env.CONTACT_VERIFICATION_SIGNING_SECRET || '').trim();
  return value.length >= 32 && value.length <= 2_000 ? value : '';
}

export function contactVerificationReady(channel: VerificationChannel, env: ContactVerificationEnvironment) {
  return featureEnabled(channel, env)
    && contactVerificationSigningSecret(env).length > 0
    && verificationProviderReady(channel, env);
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
  if (domain.length > 253 || !domain.includes('.')) return null;
  const labels = domain.split('.');
  if (!labels.every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label))) return null;
  return `${local}@${domain}`;
}

function normalizePhone(value: string) {
  const candidate = value.trim().replace(/[\s().-]/g, '');
  return /^\+[1-9][0-9]{7,14}$/.test(candidate) ? candidate : null;
}

export function normalizeVerificationDestination(channel: VerificationChannel, value: unknown) {
  if (typeof value !== 'string') return null;
  return channel === 'email' ? normalizeEmail(value) : normalizePhone(value);
}

export function maskVerificationDestination(channel: VerificationChannel, destination: string) {
  if (channel === 'email') {
    const separator = destination.lastIndexOf('@');
    const local = destination.slice(0, separator);
    const domain = destination.slice(separator + 1);
    return `${local.slice(0, 1) || '*'}***@${domain}`;
  }
  return `${destination.slice(0, 2)}${'*'.repeat(Math.max(4, destination.length - 6))}${destination.slice(-4)}`;
}

function ownedBuffer(bytes: Uint8Array) {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

async function hmacKey(secret: string, usages: KeyUsage[]) {
  return crypto.subtle.importKey(
    'raw',
    ownedBuffer(new TextEncoder().encode(secret)),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    usages
  );
}

async function hmacBytes(secret: string, value: string) {
  const key = await hmacKey(secret, ['sign']);
  const data = ownedBuffer(new TextEncoder().encode(value));
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, data));
}

async function verifyHmac(secret: string, value: string, signature: Uint8Array) {
  const key = await hmacKey(secret, ['verify']);
  const data = ownedBuffer(new TextEncoder().encode(value));
  return crypto.subtle.verify('HMAC', key, ownedBuffer(signature), data);
}

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(value: string) {
  if (!DIGEST_PATTERN.test(value)) return null;
  return Uint8Array.from(value.match(/.{2}/g) || [], pair => Number.parseInt(pair, 16));
}

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlToBytes(value: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(value) || value.length > 4_000) return null;
  try {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    const binary = atob(padded);
    return Uint8Array.from(binary, character => character.charCodeAt(0));
  } catch {
    return null;
  }
}

function utf8Base64Url(value: string) {
  return bytesToBase64Url(new TextEncoder().encode(value));
}

async function destinationDigest(
  channel: VerificationChannel,
  destination: string,
  secret: string
) {
  return bytesToHex(await hmacBytes(secret, `sql-academy/contact-destination/v1:${channel}:${destination}`));
}

async function sourceKeyForRequest(request: Request, secret: string) {
  const sourceAddress = (request.headers.get('cf-connecting-ip') || 'unavailable').trim().slice(0, 80);
  return bytesToHex(await hmacBytes(secret, `sql-academy/contact-source/v1:${sourceAddress || 'unavailable'}`));
}

export async function contactDestinationDigest(
  channel: VerificationChannel,
  destination: unknown,
  env: ContactVerificationEnvironment
) {
  const normalized = normalizeVerificationDestination(channel, destination);
  const secret = contactVerificationSigningSecret(env);
  return normalized && secret ? destinationDigest(channel, normalized, secret) : null;
}

function codeMessage(row: Pick<ContactChallengeRow, 'challenge_id' | 'destination_digest' | 'purpose'>, code: string) {
  return `sql-academy/contact-code/v1:${row.challenge_id}:${row.destination_digest}:${row.purpose}:${code}`;
}

async function codeVerifier(
  challengeId: string,
  digest: string,
  purpose: VerificationPurpose,
  code: string,
  secret: string
) {
  return bytesToHex(await hmacBytes(secret, codeMessage({
    challenge_id: challengeId,
    destination_digest: digest,
    purpose
  }, code)));
}

async function codeMatches(row: ContactChallengeRow, code: string, secret: string) {
  const signature = hexToBytes(row.code_verifier);
  return signature ? verifyHmac(secret, codeMessage(row, code), signature) : false;
}

function secureSixDigitCode() {
  const limit = Math.floor(0x1_0000_0000 / 1_000_000) * 1_000_000;
  const values = new Uint32Array(1);
  do crypto.getRandomValues(values); while (values[0] >= limit);
  return String(values[0] % 1_000_000).padStart(6, '0');
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

function validPurpose(value: unknown): value is VerificationPurpose {
  return typeof value === 'string' && PURPOSES.has(value as VerificationPurpose);
}

function validChannel(value: unknown): value is VerificationChannel {
  return typeof value === 'string' && CHANNELS.has(value as VerificationChannel);
}

function ticketPayload(row: ContactChallengeRow): ContactVerificationTicketPayload | null {
  const issuedAtMs = parseSqliteTime(row.confirmed_at);
  if (!issuedAtMs) return null;
  return {
    version: 1,
    challengeId: row.challenge_id,
    channel: row.channel,
    purpose: row.purpose,
    destinationDigest: row.destination_digest,
    issuedAt: new Date(issuedAtMs).toISOString(),
    expiresAt: new Date(issuedAtMs + TICKET_TTL_MS).toISOString()
  };
}

function validTicketPayload(value: unknown): value is ContactVerificationTicketPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const payload = value as Partial<ContactVerificationTicketPayload>;
  return payload.version === 1
    && typeof payload.challengeId === 'string'
    && CHALLENGE_ID_PATTERN.test(payload.challengeId)
    && validChannel(payload.channel)
    && validPurpose(payload.purpose)
    && typeof payload.destinationDigest === 'string'
    && DIGEST_PATTERN.test(payload.destinationDigest)
    && typeof payload.issuedAt === 'string'
    && Number.isFinite(Date.parse(payload.issuedAt))
    && typeof payload.expiresAt === 'string'
    && Number.isFinite(Date.parse(payload.expiresAt));
}

export async function createContactVerificationTicket(
  payload: ContactVerificationTicketPayload,
  env: ContactVerificationEnvironment
) {
  const secret = contactVerificationSigningSecret(env);
  const issuedAt = Date.parse(payload.issuedAt);
  const expiresAt = Date.parse(payload.expiresAt);
  if (!secret
    || !validTicketPayload(payload)
    || expiresAt - issuedAt !== TICKET_TTL_MS) throw new Error('INVALID_CONTACT_VERIFICATION_TICKET');
  const encoded = utf8Base64Url(JSON.stringify(payload));
  const signature = bytesToBase64Url(await hmacBytes(secret, `sql-academy/contact-ticket/v1:${encoded}`));
  return `${encoded}.${signature}`;
}

export async function verifyContactVerificationTicket(
  ticket: unknown,
  env: ContactVerificationEnvironment,
  expected: TicketExpectation = {},
  now = Date.now()
): Promise<ContactVerificationTicketPayload | null> {
  const secret = contactVerificationSigningSecret(env);
  if (!secret || typeof ticket !== 'string' || ticket.length > 6_000) return null;
  const parts = ticket.split('.');
  if (parts.length !== 2) return null;
  const [encoded, signaturePart] = parts;
  const payloadBytes = base64UrlToBytes(encoded);
  const signature = base64UrlToBytes(signaturePart);
  if (!payloadBytes || !signature || signature.byteLength !== 32) return null;
  if (!await verifyHmac(secret, `sql-academy/contact-ticket/v1:${encoded}`, signature)) return null;

  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder().decode(payloadBytes));
  } catch {
    return null;
  }
  if (!validTicketPayload(payload)) return null;
  const issuedAt = Date.parse(payload.issuedAt);
  const expiresAt = Date.parse(payload.expiresAt);
  if (issuedAt > now + 30_000 || expiresAt <= now || expiresAt - issuedAt !== TICKET_TTL_MS) return null;
  if (expected.channel && payload.channel !== expected.channel) return null;
  if (expected.purpose && payload.purpose !== expected.purpose) return null;
  if (expected.destinationDigest && payload.destinationDigest !== expected.destinationDigest) return null;
  return payload;
}

export async function consumeContactVerificationTicket(
  ticket: unknown,
  env: ContactVerificationEnvironment,
  expected: TicketExpectation = {}
): Promise<ContactVerificationTicketPayload | null> {
  const payload = await verifyContactVerificationTicket(ticket, env, expected);
  if (!payload || !env.DB) return null;
  const now = sqliteTime();
  const consumed = await env.DB.prepare(`UPDATE contact_verification_challenges
    SET consumed_at = ?, updated_at = ?
    WHERE challenge_id = ? AND channel = ? AND purpose = ? AND destination_digest = ?
      AND confirmed_at IS NOT NULL AND consumed_at IS NULL`).bind(
      now, now, payload.challengeId, payload.channel, payload.purpose, payload.destinationDigest
    ).run();
  return (consumed.meta.changes || 0) === 1 ? payload : null;
}

async function pruneChallenges(env: ContactVerificationEnvironment) {
  const now = sqliteTime();
  const cutoff = sqliteTime(new Date(Date.now() - 86_400_000));
  await env.DB.prepare(`DELETE FROM contact_verification_challenges WHERE challenge_id IN (
    SELECT challenge_id FROM contact_verification_challenges
    WHERE (expires_at < ? AND confirmed_at IS NULL)
       OR (consumed_at IS NOT NULL AND consumed_at < ?)
    ORDER BY updated_at ASC LIMIT 100
  )`).bind(now, cutoff).run();
}

async function createChallenge(request: Request, env: ContactVerificationEnvironment) {
  const body = await boundedJson(request) as {
    channel?: unknown;
    purpose?: unknown;
    destination?: unknown;
  } | null;
  if (!body || !validChannel(body.channel) || !validPurpose(body.purpose)) {
    return json({ error: 'Invalid verification request' }, 400);
  }
  if (!contactVerificationReady(body.channel, env)) return json({ error: 'Not found' }, 404);
  const destination = normalizeVerificationDestination(body.channel, body.destination);
  if (!destination) return json({ error: 'Invalid verification destination' }, 400);

  const secret = contactVerificationSigningSecret(env);
  const digest = await destinationDigest(body.channel, destination, secret);
  const sourceKey = await sourceKeyForRequest(request, secret);
  const now = Date.now();
  const latest = await env.DB.prepare(`SELECT created_at FROM contact_verification_challenges
    WHERE channel = ? AND purpose = ? AND destination_digest = ?
    ORDER BY created_at DESC LIMIT 1`).bind(body.channel, body.purpose, digest)
    .first<{ created_at: string }>();
  const latestAt = parseSqliteTime(latest?.created_at);
  if (latestAt && latestAt + RESEND_COOLDOWN_MS > now) {
    const retryAfter = Math.max(1, Math.ceil((latestAt + RESEND_COOLDOWN_MS - now) / 1_000));
    return json({ error: 'Verification challenge was requested recently' }, 429, {
      'retry-after': String(retryAfter)
    });
  }

  const windowStart = sqliteTime(new Date(now - CHALLENGE_WINDOW_MS));
  const recent = await env.DB.prepare(`SELECT COUNT(*) AS count FROM contact_verification_challenges
    WHERE channel = ? AND purpose = ? AND destination_digest = ? AND created_at >= ?`)
    .bind(body.channel, body.purpose, digest, windowStart).first<{ count: number }>();
  if ((Number(recent?.count) || 0) >= MAX_CHALLENGES_PER_WINDOW) {
    return json({ error: 'Too many verification challenges' }, 429, {
      'retry-after': String(Math.ceil(CHALLENGE_WINDOW_MS / 1_000))
    });
  }

  const challengeId = crypto.randomUUID();
  const code = secureSixDigitCode();
  const createdAt = sqliteTime(new Date(now));
  const expiresAt = sqliteTime(new Date(now + CHALLENGE_TTL_MS));
  const maskedDestination = maskVerificationDestination(body.channel, destination);
  const verifier = await codeVerifier(challengeId, digest, body.purpose, code, secret);
  await env.DB.prepare(`INSERT INTO contact_verification_challenges(
    challenge_id, channel, purpose, destination_digest, masked_destination,
    code_verifier, attempts_remaining, expires_at, created_at, updated_at
  ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
    challengeId,
    body.channel,
    body.purpose,
    digest,
    maskedDestination,
    verifier,
    MAX_CODE_ATTEMPTS,
    expiresAt,
    createdAt,
    createdAt
  ).run();

  try {
    const delivery = await verificationProvider(body.channel, env).send({
      challengeId,
      channel: body.channel,
      destination,
      purpose: body.purpose,
      code,
      expiresAt,
      sourceKey
    });
    const persistedAt = sqliteTime();
    const [updated] = await env.DB.batch([
      env.DB.prepare(`UPDATE contact_verification_challenges
        SET provider_message_id = ?, updated_at = ?
        WHERE challenge_id = ? AND provider_message_id IS NULL`).bind(
          delivery.providerMessageId, persistedAt, challengeId
        ),
      env.DB.prepare(`UPDATE contact_verification_challenges
        SET attempts_remaining = 0, expires_at = ?, updated_at = ?
        WHERE channel = ? AND purpose = ? AND destination_digest = ? AND challenge_id <> ?
          AND confirmed_at IS NULL AND consumed_at IS NULL AND expires_at > ?`).bind(
          persistedAt,
          persistedAt,
          body.channel,
          body.purpose,
          digest,
          challengeId,
          persistedAt
        )
    ]);
    if ((updated.meta.changes || 0) !== 1) throw new Error('VERIFICATION_CHALLENGE_PERSISTENCE_FAILED');
  } catch (error) {
    await env.DB.prepare('DELETE FROM contact_verification_challenges WHERE challenge_id = ?')
      .bind(challengeId).run();
    const code = error instanceof Error && /^VERIFICATION_[A-Z_]+$/.test(error.message)
      ? error.message
      : 'VERIFICATION_PROVIDER_UNAVAILABLE';
    console.error('contact_verification_delivery_failed', {
      challengeId,
      channel: body.channel,
      purpose: body.purpose,
      code
    });
    return json({ error: 'Verification delivery is temporarily unavailable' }, 503, {
      'retry-after': '60'
    });
  }

  await pruneChallenges(env);
  return json({
    challengeId,
    channel: body.channel,
    purpose: body.purpose,
    maskedDestination,
    expiresAt,
    resendAt: sqliteTime(new Date(now + RESEND_COOLDOWN_MS)),
    attempts: MAX_CODE_ATTEMPTS
  }, 202);
}

async function confirmChallenge(request: Request, env: ContactVerificationEnvironment) {
  const body = await boundedJson(request) as { challengeId?: unknown; code?: unknown } | null;
  if (!body
    || typeof body.challengeId !== 'string'
    || !CHALLENGE_ID_PATTERN.test(body.challengeId)
    || typeof body.code !== 'string'
    || !CODE_PATTERN.test(body.code)) {
    return json({ error: 'Invalid verification confirmation' }, 400);
  }

  let row = await env.DB.prepare('SELECT * FROM contact_verification_challenges WHERE challenge_id = ?')
    .bind(body.challengeId).first<ContactChallengeRow>();
  if (!row || !contactVerificationReady(row.channel, env)) return json({ error: 'Verification challenge is invalid' }, 400);
  if (!row.provider_message_id) return json({ error: 'Verification challenge is not ready' }, 409);
  if (row.consumed_at) return json({ error: 'Verification ticket was already used' }, 409);
  if (parseSqliteTime(row.expires_at) <= Date.now() && !row.confirmed_at) {
    return json({ error: 'Verification challenge expired' }, 410);
  }
  if (row.attempts_remaining <= 0) return json({ error: 'Verification challenge is locked' }, 429);

  const secret = contactVerificationSigningSecret(env);
  if (!await codeMatches(row, body.code, secret)) {
    await env.DB.prepare(`UPDATE contact_verification_challenges
      SET attempts_remaining = MAX(0, attempts_remaining - 1), updated_at = ?
      WHERE challenge_id = ? AND attempts_remaining > 0 AND confirmed_at IS NULL AND consumed_at IS NULL`)
      .bind(sqliteTime(), row.challenge_id).run();
    const current = await env.DB.prepare('SELECT attempts_remaining FROM contact_verification_challenges WHERE challenge_id = ?')
      .bind(row.challenge_id).first<{ attempts_remaining: number }>();
    return json({
      error: 'Verification code is invalid',
      attemptsRemaining: Math.max(0, Number(current?.attempts_remaining) || 0)
    }, 400);
  }

  if (!row.confirmed_at) {
    const confirmedAt = sqliteTime();
    const confirmed = await env.DB.prepare(`UPDATE contact_verification_challenges
      SET confirmed_at = ?, updated_at = ?
      WHERE challenge_id = ? AND confirmed_at IS NULL AND consumed_at IS NULL AND expires_at > ?`)
      .bind(confirmedAt, confirmedAt, row.challenge_id, confirmedAt).run();
    if ((confirmed.meta.changes || 0) !== 1) {
      row = await env.DB.prepare('SELECT * FROM contact_verification_challenges WHERE challenge_id = ?')
        .bind(row.challenge_id).first<ContactChallengeRow>();
      if (!row?.confirmed_at || row.consumed_at) return json({ error: 'Verification challenge expired' }, 410);
    } else {
      row.confirmed_at = confirmedAt;
      row.updated_at = confirmedAt;
    }
  }

  const payload = ticketPayload(row);
  if (!payload) return json({ error: 'Verification confirmation failed' }, 500);
  return json({
    verified: true,
    ticket: await createContactVerificationTicket(payload, env),
    channel: row.channel,
    purpose: row.purpose,
    maskedDestination: row.masked_destination,
    expiresAt: payload.expiresAt
  });
}

export async function handleContactVerificationRequest(
  request: Request,
  env: ContactVerificationEnvironment
): Promise<Response | null> {
  const url = new URL(request.url);
  const challengePath = url.pathname === '/api/auth/contact/challenge';
  const confirmPath = url.pathname === '/api/auth/contact/confirm';
  if (!challengePath && !confirmPath) return null;
  if (!contactVerificationReady('email', env) && !contactVerificationReady('sms', env)) {
    return json({ error: 'Not found' }, 404);
  }
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405, { allow: 'POST, OPTIONS' });
  if (!env.DB) return json({ error: 'Verification storage is unavailable' }, 503);
  return challengePath ? createChallenge(request, env) : confirmChallenge(request, env);
}
