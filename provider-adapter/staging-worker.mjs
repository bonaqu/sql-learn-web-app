const MAX_BODY_BYTES = 8_192;
const PROVIDER_RESPONSE_BYTES = 16_384;
const CHALLENGE_PATTERN = /^[0-9a-f-]{36}$/i;
const CODE_PATTERN = /^\d{6}$/;

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

async function boundedText(response, maximum = PROVIDER_RESPONSE_BYTES) {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let result = '';
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
}

async function boundedJson(request) {
  const declared = Number(request.headers.get('content-length') || 0);
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return null;
  try {
    const text = await request.text();
    if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) return null;
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function providerJson(response) {
  const text = await boundedText(response);
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return {};
  }
}

function deliveryRequest(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const body = value;
  if (body.contract !== 'contact-verification-delivery-v1'
    || !CHALLENGE_PATTERN.test(String(body.challengeId || ''))
    || !['email', 'sms'].includes(body.channel)
    || !['register', 'password-reset', 'sensitive-action'].includes(body.purpose)
    || typeof body.destination !== 'string'
    || !CODE_PATTERN.test(String(body.code || ''))
    || !Number.isFinite(Date.parse(String(body.expiresAt || '')))) return null;
  return body;
}

async function sendEmail(challenge, env) {
  const apiKey = secret(env.RESEND_API_KEY, 10);
  const from = String(env.RESEND_FROM || '').trim();
  if (!apiKey || !from || !/^\S+@\S+$/.test(from.replace(/^.*</, '').replace(/>$/, ''))) {
    throw new Error('RESEND_CONFIGURATION_INCOMPLETE');
  }
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    redirect: 'error',
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
  if (!response.ok || typeof payload.id !== 'string') throw new Error('RESEND_DELIVERY_REJECTED');
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
  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
    method: 'POST',
    redirect: 'error',
    headers: {
      authorization: `Basic ${btoa(`${accountSid}:${authToken}`)}`,
      'content-type': 'application/x-www-form-urlencoded; charset=utf-8'
    },
    body: form
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
  if (!expectedSecret || bearer(request) !== expectedSecret) return json({ error: 'Not found' }, 404);
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
  if (!captureSecret || bearer(request) !== captureSecret || !CHALLENGE_PATTERN.test(challengeId)) {
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
      return capture(request, env, decodeURIComponent(url.pathname.slice('/capture/'.length)));
    }
    return json({ error: 'Not found' }, 404);
  }
};
