import {
  contactVerificationSigningSecret,
  type ContactVerificationEnvironment
} from './contact-verification';
import type { VerificationChannel, VerificationPurpose } from './integrations/verification';
import { runRetentionCleanup } from './retention-policy';

type SecurityEventType =
  | 'challenge-created'
  | 'challenge-rejected'
  | 'rate-limited'
  | 'provider-failed'
  | 'confirmation-invalid'
  | 'confirmation-locked'
  | 'contact-confirmed';

type ChallengeMetadata = {
  channel: VerificationChannel | null;
  purpose: VerificationPurpose | null;
};

type ContactSecurityRequest = {
  readonly url: string;
  readonly headers: Headers;
  text(): Promise<string>;
};

const CHALLENGE_PATH = '/api/auth/contact/challenge';
const CONFIRM_PATH = '/api/auth/contact/confirm';
const MAX_BODY_BYTES = 4_096;
const CHALLENGE_ID_PATTERN = /^[0-9a-f-]{36}$/i;

function ownedBuffer(bytes: Uint8Array) {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

async function actorDigest(request: ContactSecurityRequest, secret: string) {
  const dateBucket = new Date().toISOString().slice(0, 10);
  const address = (request.headers.get('cf-connecting-ip') || 'unknown').trim().slice(0, 80);
  const agent = (request.headers.get('user-agent') || 'unknown').trim().slice(0, 160);
  const key = await crypto.subtle.importKey(
    'raw',
    ownedBuffer(new TextEncoder().encode(secret)),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    ownedBuffer(new TextEncoder().encode(`sql-academy/contact-actor/v1:${dateBucket}:${address}:${agent}`))
  );
  return bytesToHex(new Uint8Array(signature));
}

function validChannel(value: unknown): value is VerificationChannel {
  return value === 'email' || value === 'sms';
}

function validPurpose(value: unknown): value is VerificationPurpose {
  return value === 'register' || value === 'password-reset' || value === 'sensitive-action';
}

async function boundedJson(request: ContactSecurityRequest) {
  const declared = Number(request.headers.get('content-length') || 0);
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return null;
  try {
    const text = await request.text();
    if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) return null;
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function challengeEvent(status: number): SecurityEventType | null {
  if (status === 202) return 'challenge-created';
  if (status === 429) return 'rate-limited';
  if (status === 503) return 'provider-failed';
  return status >= 400 ? 'challenge-rejected' : null;
}

function confirmationEvent(status: number): SecurityEventType | null {
  if (status === 200) return 'contact-confirmed';
  if (status === 429) return 'confirmation-locked';
  return status >= 400 ? 'confirmation-invalid' : null;
}

async function metadataForRequest(
  request: ContactSecurityRequest,
  env: ContactVerificationEnvironment,
  pathname: string
): Promise<ChallengeMetadata> {
  const parsed = await boundedJson(request) as {
    channel?: unknown;
    purpose?: unknown;
    challengeId?: unknown;
  } | null;
  if (pathname === CHALLENGE_PATH) {
    return {
      channel: validChannel(parsed?.channel) ? parsed.channel : null,
      purpose: validPurpose(parsed?.purpose) ? parsed.purpose : null
    };
  }
  if (typeof parsed?.challengeId !== 'string' || !CHALLENGE_ID_PATTERN.test(parsed.challengeId)) {
    return { channel: null, purpose: null };
  }
  const row = await env.DB.prepare(`SELECT channel, purpose FROM contact_verification_challenges
    WHERE challenge_id = ?`).bind(parsed.challengeId)
    .first<{ channel: VerificationChannel; purpose: VerificationPurpose }>();
  return {
    channel: validChannel(row?.channel) ? row.channel : null,
    purpose: validPurpose(row?.purpose) ? row.purpose : null
  };
}

function sqliteTime(date = new Date()) {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

export async function recordContactSecurityOutcome(
  request: ContactSecurityRequest,
  response: Response,
  env: ContactVerificationEnvironment
) {
  const pathname = new URL(request.url).pathname;
  if (pathname !== CHALLENGE_PATH && pathname !== CONFIRM_PATH) return;
  if (!env.DB) return;
  const secret = contactVerificationSigningSecret(env);
  if (!secret) return;

  const eventType = pathname === CHALLENGE_PATH
    ? challengeEvent(response.status)
    : confirmationEvent(response.status);
  if (!eventType) return;

  try {
    const metadata = await metadataForRequest(request, env, pathname);
    await env.DB.prepare(`INSERT INTO contact_security_events(
      event_id, event_type, channel, purpose, actor_digest, response_status, created_at
    ) VALUES(?, ?, ?, ?, ?, ?, ?)`).bind(
      crypto.randomUUID(),
      eventType,
      metadata.channel,
      metadata.purpose,
      await actorDigest(request, secret),
      response.status,
      sqliteTime()
    ).run();
  } catch (error) {
    const name = error instanceof Error ? error.name.slice(0, 80) : 'UnknownError';
    console.error('contact_security_event_failed', { pathname, eventType, responseStatus: response.status, name });
    return;
  }

  try {
    await runRetentionCleanup(env, {
      execute: true,
      scopes: [
        'contactSecurityEvents',
        'expiredUnconfirmedChallenges',
        'confirmedUnconsumedChallenges',
        'consumedChallenges'
      ]
    });
  } catch (error) {
    const name = error instanceof Error ? error.name.slice(0, 80) : 'UnknownError';
    console.error('contact_security_retention_failed', {
      pathname,
      eventType,
      responseStatus: response.status,
      name
    });
  }
}
