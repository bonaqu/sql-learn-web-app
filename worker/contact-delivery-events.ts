import {
  recordContactDeliveryEvent,
  type ContactDeliveryStatus
} from './contact-observability';
import type { VerificationProviderEnvironment } from './integrations/verification';

export type ContactDeliveryEnvironment = VerificationProviderEnvironment;

const CALLBACK_TOLERANCE_SECONDS = 5 * 60;
const MAX_CALLBACK_BYTES = 128 * 1024;
const BASE64_ALPHABET = /^[A-Za-z0-9+/]+={0,2}$/;
const TWILIO_SID = /^SM[a-fA-F0-9]{32}$/;

function textResponse(status: number, body = '') {
  return new Response(body, {
    status,
    headers: {
      'cache-control': 'no-store',
      'content-type': 'text/plain; charset=utf-8',
      'x-content-type-options': 'nosniff'
    }
  });
}

function utf8(value: string) {
  return new TextEncoder().encode(value);
}

function bytesEqual(left: Uint8Array, right: Uint8Array) {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) mismatch |= left[index] ^ right[index];
  return mismatch === 0;
}

function decodeBase64(value: string) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  if (!BASE64_ALPHABET.test(normalized)) return null;
  try {
    const binary = atob(normalized);
    return Uint8Array.from(binary, character => character.charCodeAt(0));
  } catch {
    return null;
  }
}

async function hmac(algorithm: 'SHA-1' | 'SHA-256', secret: Uint8Array, message: string) {
  const key = await crypto.subtle.importKey('raw', secret, { name: 'HMAC', hash: algorithm }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, utf8(message)));
}

async function sha256Hex(value: string) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', utf8(value)));
  return [...digest].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

async function challengeIdForMessage(env: ContactDeliveryEnvironment, providerMessageId: string) {
  const row = await env.DB.prepare(`SELECT challenge_id
    FROM contact_verification_challenges WHERE provider_message_id = ?`)
    .bind(providerMessageId)
    .first<{ challenge_id: string }>();
  return row?.challenge_id || null;
}

function resendStatus(type: string): ContactDeliveryStatus | null {
  const mapping: Record<string, ContactDeliveryStatus> = {
    'email.sent': 'sent',
    'email.delivered': 'delivered',
    'email.delivery_delayed': 'delayed',
    'email.bounced': 'bounced',
    'email.complained': 'complained',
    'email.failed': 'failed',
    'email.opened': 'read',
    'email.clicked': 'read'
  };
  return mapping[type] || null;
}

async function verifyResendSignature(
  body: string,
  headers: Headers,
  secretValue: string
) {
  const eventId = (headers.get('svix-id') || '').trim();
  const timestampRaw = (headers.get('svix-timestamp') || '').trim();
  const signatures = (headers.get('svix-signature') || '').trim().split(/\s+/).filter(Boolean);
  const timestamp = Number(timestampRaw);
  const now = Math.floor(Date.now() / 1_000);
  if (!eventId || eventId.length > 200 || !Number.isInteger(timestamp)
    || Math.abs(now - timestamp) > CALLBACK_TOLERANCE_SECONDS) return null;
  const encodedSecret = secretValue.trim().replace(/^whsec_/, '');
  const secret = decodeBase64(encodedSecret);
  if (!secret || secret.length < 16) return null;
  const expected = await hmac('SHA-256', secret, `${eventId}.${timestampRaw}.${body}`);
  const valid = signatures.some(candidate => {
    const [version, encoded] = candidate.split(',', 2);
    if (version !== 'v1' || !encoded) return false;
    const actual = decodeBase64(encoded);
    return actual ? bytesEqual(expected, actual) : false;
  });
  return valid ? eventId : null;
}

export async function handleResendDeliveryEvent(request: Request, env: ContactDeliveryEnvironment) {
  if (request.method !== 'POST') return textResponse(405, 'Method not allowed');
  const secret = (env.RESEND_WEBHOOK_SECRET || '').trim();
  if (!secret.startsWith('whsec_')) return textResponse(404, 'Not found');
  const contentLength = Number(request.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > MAX_CALLBACK_BYTES) return textResponse(413, 'Payload too large');
  const body = await request.text();
  if (utf8(body).byteLength > MAX_CALLBACK_BYTES) return textResponse(413, 'Payload too large');
  const eventId = await verifyResendSignature(body, request.headers, secret);
  if (!eventId) return textResponse(401, 'Invalid signature');
  const payload = JSON.parse(body) as {
    type?: string;
    created_at?: string;
    data?: { email_id?: string };
  };
  const status = resendStatus(String(payload.type || ''));
  const emailId = String(payload.data?.email_id || '').trim();
  if (!status || !emailId || emailId.length > 180) return textResponse(204);
  const providerMessageId = `resend:${emailId}`;
  const challengeId = await challengeIdForMessage(env, providerMessageId);
  await recordContactDeliveryEvent(env, {
    eventId: `resend:${eventId}`,
    provider: 'resend',
    providerMessageId,
    challengeId,
    channel: 'email',
    status,
    occurredAt: String(payload.created_at || new Date().toISOString()).slice(0, 80)
  });
  return textResponse(204);
}

function twilioStatus(value: string): ContactDeliveryStatus {
  const mapping: Record<string, ContactDeliveryStatus> = {
    accepted: 'accepted',
    scheduled: 'queued',
    queued: 'queued',
    sending: 'queued',
    sent: 'sent',
    delivered: 'delivered',
    undelivered: 'undelivered',
    failed: 'failed',
    read: 'read'
  };
  return mapping[value.toLowerCase()] || 'unknown';
}

async function verifyTwilioSignature(request: Request, params: URLSearchParams, authToken: string) {
  const signature = decodeBase64((request.headers.get('x-twilio-signature') || '').trim());
  if (!signature || authToken.length < 20) return false;
  const sorted = [...params.entries()].sort(([leftKey, leftValue], [rightKey, rightValue]) =>
    leftKey.localeCompare(rightKey) || leftValue.localeCompare(rightValue));
  const message = request.url + sorted.map(([key, value]) => `${key}${value}`).join('');
  const expected = await hmac('SHA-1', utf8(authToken), message);
  return bytesEqual(expected, signature);
}

export async function handleTwilioDeliveryEvent(request: Request, env: ContactDeliveryEnvironment) {
  if (request.method !== 'POST') return textResponse(405, 'Method not allowed');
  const authToken = (env.TWILIO_AUTH_TOKEN || '').trim();
  if (authToken.length < 20) return textResponse(404, 'Not found');
  const contentType = request.headers.get('content-type') || '';
  if (!contentType.toLowerCase().startsWith('application/x-www-form-urlencoded')) {
    return textResponse(415, 'Unsupported media type');
  }
  const contentLength = Number(request.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > MAX_CALLBACK_BYTES) return textResponse(413, 'Payload too large');
  const body = await request.text();
  if (utf8(body).byteLength > MAX_CALLBACK_BYTES) return textResponse(413, 'Payload too large');
  const params = new URLSearchParams(body);
  if (!(await verifyTwilioSignature(request, params, authToken))) return textResponse(401, 'Invalid signature');
  const sid = String(params.get('MessageSid') || params.get('SmsSid') || '').trim();
  if (!TWILIO_SID.test(sid)) return textResponse(204);
  const rawStatus = String(params.get('MessageStatus') || params.get('SmsStatus') || 'unknown');
  const status = twilioStatus(rawStatus);
  const errorCode = String(params.get('ErrorCode') || '').trim() || null;
  const providerMessageId = `twilio:${sid}`;
  const challengeId = await challengeIdForMessage(env, providerMessageId);
  const eventHash = await sha256Hex(`${sid}|${status}|${errorCode || ''}`);
  await recordContactDeliveryEvent(env, {
    eventId: `twilio:${eventHash}`,
    provider: 'twilio',
    providerMessageId,
    challengeId,
    channel: 'sms',
    status,
    errorCode,
    occurredAt: new Date().toISOString()
  });
  return textResponse(204);
}