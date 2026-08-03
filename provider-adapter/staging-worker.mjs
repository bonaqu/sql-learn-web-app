const MAX_BODY_BYTES = 8_192;
const PROVIDER_RESPONSE_BYTES = 16_384;
const PROVIDER_TIMEOUT_MS = 8_000;
const CHALLENGE_PATTERN = /^[0-9a-f-]{36}$/i;
const CODE_PATTERN = /^\d{6}$/;
const encoder = new TextEncoder();

const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    ...headers
  }
});

function secret(value, minimum = 16, maximum = 2_000) {
  const normalized = String(value || '').trim();
  return normalized.length >= minimum && normalized.length <= maximum ? normalized : '';
}

function bearer(request) {
  const authorization = request.headers.get('authorization') || '';
  return authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
}

function ownedBuffer(bytes) {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function constantTimeEqual(left, right) {
  if (left.byteLength !== right.byteLength) return false;
  let difference = 0;
  for (let index = 0; index < left.byteLength; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

async function digest(value) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', ownedBuffer(encoder.encode(value))));
}

async function secretMatches(candidate, expected) {
  const boundedCandidate = secret(candidate, 1, 4_096);
  if (!boundedCandidate || !expected) return false;
  const [candidateDigest, expectedDigest] = await Promise.all([digest(boundedCandidate), digest(expected)]);
  return constantTimeEqual(candidateDigest, expectedDigest);
}

async function providerFetch(url, init) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort('provider-timeout'), PROVIDER_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal, redirect: 'error' });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw new Error('PROVIDER_TIMEOUT');
    throw new Error('PROVIDER_UNAVAILABLE');
  } finally {
    clearTimeout(timeout);
  }
}

async function boundedText(response, maximum = PROVIDER_RESPONSE_BYTES) {
  const declared = Number(response.headers.get('content-length') || 0);
  if (Number.isFinite(declared) && declared > maximum) throw new Error('PROVIDER_RESPONSE_TOO_LARGE');
  if (!response.body) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let result = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximum) {
        await reader.cancel('provider-response-too-large');
        throw new Error('PROVIDER_RESPONSE_TOO_LARGE');
      }
      result += decoder.decode(value, { stream: true });
    }
    return result + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

async function boundedJson(request) {
  const declared = Number(request.headers.get('content-length') || 0);
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return null;
  try {
    const text = await request.text();
    if (encoder.encode(text).byteLength > MAX_BODY_BYTES) return null;
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function providerJson(response) {
  const text = await boundedText(response);
  try { return text ? JSON.parse(text) : {}; } catch { return {}; }
}

function normalizeEmail(value) {
  const candidate = String(value || '').trim().normalize('NFKC').toLowerCase();
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

function normalizePhone(value) {
  const candidate = String(value || '').trim().replace(/[\s().-]/g, '');
  return /^\+[1-9][0-9]{7,14}$/.test(candidate) ? candidate : null;
}

function deliveryRequest(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const body = value;
  const channel = String(body.channel || '');
  const destination = channel === 'email'
    ? normalizeEmail(body.destination)
    : channel === 'sms'
      ? normalizePhone(body.destination)
      : null;
  const expiresAtMs = Date.parse(String(body.expiresAt || ''));
  if (body.contract !== 'contact-verification-delivery-v1'
    || !CHALLENGE_PATTERN.test(String(body.challengeId || ''))
    || !destination
    || !['register', 'password-reset', 'sensitive-action'].includes(body.purpose)
    || !CODE_PATTERN.test(String(body.code || ''))
    || !Number.isFinite(expiresAtMs)
    || expiresAtMs <= Date.now()
    || expiresAtMs > Date.now() + 15 * 60_000) return null;
  return { ...body, channel, destination, expiresAt: new Date(expiresAtMs).toISOString() };
}

async function sendEmail(challenge, env) {
  const apiKey = secret(env.RESEND_API_KEY, 10);
  const from = String(env.RESEND_FROM || '').trim();
  const fromAddress = normalizeEmail(from.replace(/^.*</, '').replace(/>$/, ''));
  if (!apiKey || !fromAddress) throw new Error('RESEND_CONFIGURATION_INCOMPLETE');
  const response = await providerFetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json; charset=utf-8',
      'idempotency-key': challenge.challengeId
    },
    body: JSON.stringify({
      from,
      to: [challenge.destination],
      subject: 'SQL Academy — код подтверждения',
      text: `Код подтверждения SQL Academy: ${challenge.code}\n\nКод действует 10 минут. Никому его не сообщайте.`,
      html: `<p>Код подтверждения SQL Academy:</p><p style="font-size:28px;font-weight:700;letter-spacing:0.18em">${challenge.code}</p><p>Код действует 10 минут. Никому его не сообщайте.</p>`,
      tags: [
        { name: 'purpose', value: String(challenge.purpose).replace(/[^A-Za-z0-9_-]/g, '_') },
        { name: 'challenge', value: challenge.challengeId }
      ]
    })
  });
  const payload = await providerJson(response);
  if (!response.ok || typeof payload.id !== 'string' || payload.id.length > 160) {
    throw new Error('RESEND_DELIVERY_REJECTED');
  }
  return { provider: 'resend', providerMessageId: payload.id };
}

async function sendSms(challenge, env) {
  const accountSid = secret(env.TWILIO_ACCOUNT_SID, 34, 34);
  const authToken = secret(env.TWILIO_AUTH_TOKEN, 16);
  const messagingServiceSid = secret(env.TWILIO_MESSAGING_SERVICE_SID, 34, 34);
  const from = String(env.TWILIO_FROM || '').trim();
  if (!/^AC[0-9a-f]{32}$/i.test(accountSid) || !authToken
    || (!/^MG[0-9a-f]{32}$/i.test(messagingServiceSid) && !/^\+[1-9]\d{7,14}$/.test(from))) {
    throw new Error('TWILIO_CONFIGURATION_INCOMPLETE');
  }
  const form = new URLSearchParams({
    To: challenge.destination,
    Body: `SQL Academy: код ${challenge.code}. Действует 10 минут. Никому его не сообщайте.`
  });
  if (messagingServiceSid) form.set('MessagingServiceSid', messagingServiceSid);
  else form.set('From', from);
  const response = await providerFetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
    method: 'POST',
    headers: {
      authorization: `Basic ${btoa(`${accountSid}:${authToken}`)}`,
      'content-type': 'application/x-www-form-urlencoded; charset=utf-8'
    },
    body: form.toString()
  });
  const payload = await providerJson(response);
  if (!response.ok || typeof payload.sid !== 'string' || !/^(SM|MM)[0-9a-f]{32}$/i.test(payload.sid)) {
    throw new Error('TWILIO_DELIVERY_REJECTED');
  }
  return { provider: 'twilio', providerMessageId: payload.sid };
}

async function deliver(request, env) {
  const body = deliveryRequest(await boundedJson(request));
  if (!body) return json({ error: 'Invalid delivery request' }, 400);
  const expectedSecret = body.channel === 'email'
    ? secret(env.EMAIL_INBOUND_WEBHOOK_SECRET)
    : secret(env.SMS_INBOUND_WEBHOOK_SECRET);
  if (!expectedSecret || !await secretMatches(bearer(request), expectedSecret)) return json({ error: 'Not found' }, 404);
  if (!env.CONTACT_STAGING_STATE) return json({ error: 'Staging state is unavailable' }, 503);

  try {
    const delivery = body.channel === 'email'
      ? await sendEmail(body, env)
      : await sendSms(body, env);
    await env.CONTACT_STAGING_STATE.put(`challenge:${body.challengeId}`, JSON.stringify({
      challengeId: body.challengeId,
      channel: body.channel,
      provider: delivery.provider,
      providerMessageId: delivery.providerMessageId,
      code: body.code,
      createdAt: new Date().toISOString(),
      expiresAt: body.expiresAt
    }), { expirationTtl: 3_600 });
    return new Response(null, {
      status: 202,
      headers: {
        'cache-control': 'no-store',
        'x-verification-message-id': delivery.providerMessageId,
        'x-verification-provider': delivery.provider
      }
    });
  } catch (error) {
    const code = error instanceof Error && /^[A-Z0-9_]+$/.test(error.message)
      ? error.message
      : 'STAGING_PROVIDER_UNAVAILABLE';
    console.error('contact_staging_delivery_failed', { channel: body.channel, purpose: body.purpose, code });
    return json({ error: 'Provider delivery failed', code }, 503, { 'retry-after': '60' });
  }
}

async function capture(request, env, challengeId) {
  if (String(env.STAGING_CAPTURE_ENABLED || '').toLowerCase() !== 'on') return json({ error: 'Not found' }, 404);
  const captureSecret = secret(env.STAGING_CAPTURE_SECRET, 32);
  if (!captureSecret || !CHALLENGE_PATTERN.test(challengeId)
    || !await secretMatches(bearer(request), captureSecret)) {
    return json({ error: 'Not found' }, 404);
  }
  const value = await env.CONTACT_STAGING_STATE?.get(`challenge:${challengeId}`);
  if (!value) return json({ error: 'Not found' }, 404);
  let parsed;
  try { parsed = JSON.parse(value); } catch { return json({ error: 'Not found' }, 404); }
  return json({
    contract: 'contact-provider-staging-capture-v1',
    challengeId: parsed.challengeId,
    channel: parsed.channel,
    provider: parsed.provider,
    providerMessageId: parsed.providerMessageId,
    code: parsed.code,
    expiresAt: parsed.expiresAt
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/health' && request.method === 'GET') {
      return json({
        ok: true,
        contract: 'contact-provider-staging-adapter-v1',
        emailConfigured: Boolean(secret(env.RESEND_API_KEY, 10) && env.RESEND_FROM),
        smsConfigured: Boolean(secret(env.TWILIO_ACCOUNT_SID, 34, 34) && secret(env.TWILIO_AUTH_TOKEN, 16))
      });
    }
    if (url.pathname === '/deliver' && request.method === 'POST') return deliver(request, env);
    if (url.pathname.startsWith('/capture/') && request.method === 'GET') {
      let challengeId = '';
      try { challengeId = decodeURIComponent(url.pathname.slice('/capture/'.length)); } catch { return json({ error: 'Not found' }, 404); }
      return capture(request, env, challengeId);
    }
    return json({ error: 'Not found' }, 404);
  }
};
