import {
  handleContactAccountRequest as handleContactAccountCore
} from './contact-account';
import {
  handleContactVerificationRequest as handleContactVerificationCore,
  verifyContactVerificationTicket,
  type ContactVerificationEnvironment,
  type VerificationChannel,
  type VerificationPurpose
} from './contact-verification';
import { recordContactSecurityEvent } from './contact-observability';

const MAX_OBSERVED_BODY_BYTES = 128 * 1024;
const CHALLENGE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type ObservedEnvironment = ContactVerificationEnvironment;

async function boundedJson(request: Request) {
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

async function responseJson(response: Response) {
  try {
    return await response.clone().json() as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function challengeMetadata(env: ObservedEnvironment, challengeId: string) {
  return env.DB.prepare(`SELECT channel, purpose FROM contact_verification_challenges WHERE challenge_id = ?`)
    .bind(challengeId)
    .first<{ channel: VerificationChannel; purpose: VerificationPurpose }>();
}

export async function handleObservedContactVerificationRequest(
  request: Request,
  env: ObservedEnvironment
): Promise<Response | null> {
  const pathname = new URL(request.url).pathname;
  if (pathname !== '/api/auth/contact/challenge' && pathname !== '/api/auth/contact/confirm') return null;
  const bodyPromise = boundedJson(request.clone());
  const response = await handleContactVerificationCore(request, env);
  if (!response) return null;
  const [body, payload] = await Promise.all([bodyPromise, responseJson(response)]);

  if (pathname === '/api/auth/contact/challenge') {
    const channel = body?.channel === 'email' || body?.channel === 'sms' ? body.channel : null;
    const purpose = body?.purpose === 'register' || body?.purpose === 'password-reset' || body?.purpose === 'sensitive-action'
      ? body.purpose
      : null;
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
    return response;
  }

  const challengeId = typeof body?.challengeId === 'string' && CHALLENGE_ID_PATTERN.test(body.challengeId)
    ? body.challengeId
    : null;
  if (!challengeId) return response;
  const metadata = await challengeMetadata(env, challengeId);
  if (response.status === 200 && payload?.verified === true) {
    await recordContactSecurityEvent(env, {
      eventType: 'contact-confirmed',
      challengeId,
      channel: metadata?.channel,
      purpose: metadata?.purpose
    });
    return response;
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
  return response;
}

function accountPurpose(pathname: string): VerificationPurpose | null {
  if (pathname === '/api/auth/contact/register') return 'register';
  if (pathname === '/api/auth/contact/password/reset') return 'password-reset';
  if (pathname === '/api/auth/contact/attach') return 'sensitive-action';
  return null;
}

export async function handleObservedContactAccountRequest(
  request: Request,
  env: ObservedEnvironment
): Promise<Response | null> {
  const purpose = accountPurpose(new URL(request.url).pathname);
  if (!purpose) return null;
  const bodyPromise = boundedJson(request.clone());
  const response = await handleContactAccountCore(request, env);
  if (!response) return null;
  if (response.status !== 200 && response.status !== 201) return response;
  const body = await bodyPromise;
  const ticket = await verifyContactVerificationTicket(body?.contactTicket, env, { purpose });
  if (ticket) {
    await recordContactSecurityEvent(env, {
      eventType: 'ticket-consumed',
      challengeId: ticket.challengeId,
      channel: ticket.channel,
      purpose: ticket.purpose
    });
  }
  return response;
}