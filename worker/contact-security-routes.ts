import { verifyContactVerificationTicket } from './contact-verification';
import { recordContactSecurityEvent } from './contact-observability';
import type {
  ContactVerificationEnvironment,
  VerificationChannel,
  VerificationPurpose
} from './contact-verification';

const MAX_OBSERVED_BODY_BYTES = 128 * 1024;
const CHALLENGE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OBSERVED_PATHS = new Set([
  '/api/auth/contact/challenge',
  '/api/auth/contact/confirm',
  '/api/auth/contact/register',
  '/api/auth/contact/password/reset',
  '/api/auth/contact/attach'
]);

type ObservedEnvironment = ContactVerificationEnvironment;

async function boundedJsonFromRequest(request: Request) {
  const contentLength = Number(request.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > MAX_OBSERVED_BODY_BYTES) return null;
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_OBSERVED_BODY_BYTES) return null;
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function boundedJsonFromResponse(response: Response) {
  const contentLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > MAX_OBSERVED_BODY_BYTES) return null;
  const text = await response.text();
  if (new TextEncoder().encode(text).byteLength > MAX_OBSERVED_BODY_BYTES) return null;
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function challengeMetadata(env: ObservedEnvironment, challengeId: string) {
  return env.DB.prepare(`SELECT channel, purpose FROM contact_verification_challenges WHERE challenge_id = ?`)
    .bind(challengeId)
    .first<{ channel: VerificationChannel; purpose: VerificationPurpose }>();
}

function channelFrom(value: unknown): VerificationChannel | null {
  return value === 'email' || value === 'sms' ? value : null;
}

function purposeFrom(value: unknown): VerificationPurpose | null {
  return value === 'register' || value === 'password-reset' || value === 'sensitive-action' ? value : null;
}

function accountPurpose(pathname: string): VerificationPurpose | null {
  if (pathname === '/api/auth/contact/register') return 'register';
  if (pathname === '/api/auth/contact/password/reset') return 'password-reset';
  if (pathname === '/api/auth/contact/attach') return 'sensitive-action';
  return null;
}

export async function observeContactSecurityResponse(
  request: Request,
  response: Response,
  env: ObservedEnvironment
) {
  const pathname = new URL(request.url).pathname;
  if (!OBSERVED_PATHS.has(pathname)) return;
  const [body, payload] = await Promise.all([
    boundedJsonFromRequest(request),
    boundedJsonFromResponse(response)
  ]);

  if (pathname === '/api/auth/contact/challenge') {
    const channel = channelFrom(body?.channel);
    const purpose = purposeFrom(body?.purpose);
    if (response.status === 202
      && typeof payload?.challengeId === 'string'
      && CHALLENGE_ID_PATTERN.test(payload.challengeId)) {
      await recordContactSecurityEvent(env, {
        eventType: 'challenge-created',
        challengeId: payload.challengeId,
        channel,
        purpose
      });
    } else if (response.status === 429) {
      await recordContactSecurityEvent(env, {
        eventType: 'challenge-rate-limited',
        channel,
        purpose
      });
    }
    return;
  }

  if (pathname === '/api/auth/contact/confirm') {
    const challengeId = typeof body?.challengeId === 'string' && CHALLENGE_ID_PATTERN.test(body.challengeId)
      ? body.challengeId
      : null;
    if (!challengeId) return;
    const metadata = await challengeMetadata(env, challengeId);
    if (response.status === 200 && payload?.verified === true) {
      await recordContactSecurityEvent(env, {
        eventType: 'contact-confirmed',
        challengeId,
        channel: metadata?.channel,
        purpose: metadata?.purpose
      });
      return;
    }
    if (response.status === 400 && typeof payload?.attemptsRemaining === 'number') {
      await recordContactSecurityEvent(env, {
        eventType: 'code-invalid',
        challengeId,
        channel: metadata?.channel,
        purpose: metadata?.purpose
      });
      if (payload.attemptsRemaining <= 0) {
        await recordContactSecurityEvent(env, {
          eventType: 'code-exhausted',
          challengeId,
          channel: metadata?.channel,
          purpose: metadata?.purpose
        });
      }
    }
    return;
  }

  const purpose = accountPurpose(pathname);
  if (!purpose || (response.status !== 200 && response.status !== 201)) return;
  const ticket = await verifyContactVerificationTicket(body?.contactTicket, env, { purpose });
  if (!ticket) return;
  await recordContactSecurityEvent(env, {
    eventType: 'ticket-consumed',
    challengeId: ticket.challengeId,
    channel: ticket.channel,
    purpose: ticket.purpose
  });
}