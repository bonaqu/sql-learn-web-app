import {
  commercialCapabilities,
  expectedTurnstileHostnames,
  featureRequested,
  turnstileSecret
} from './runtime-config';

type TurnstileResponse = {
  success?: boolean;
  hostname?: string;
  action?: string;
  challenge_ts?: string;
  'error-codes'?: string[];
};

const PUBLIC_AUTH_ACTIONS = new Map([
  ['/api/auth/register', 'register'],
  ['/api/auth/login', 'login'],
  ['/api/auth/password/reset', 'password-reset']
]);

const json = (data: unknown, status: number) => new Response(JSON.stringify(data), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer'
  }
});

async function tokenFromRequest(request: Request) {
  const header = request.headers.get('cf-turnstile-response')?.trim();
  if (header) return header.slice(0, 2_048);
  try {
    const payload = await request.clone().json<Record<string, unknown>>();
    return typeof payload.turnstileToken === 'string' ? payload.turnstileToken.trim().slice(0, 2_048) : '';
  } catch {
    return '';
  }
}

function remoteIp(request: Request) {
  const value = request.headers.get('cf-connecting-ip')?.trim() || '';
  return /^[0-9a-f:.]{3,64}$/i.test(value) ? value : '';
}

export function publicAuthTurnstileAction(request: Request) {
  if (request.method !== 'POST') return null;
  return PUBLIC_AUTH_ACTIONS.get(new URL(request.url).pathname) || null;
}

export async function enforceTurnstile(request: Request, env: Cloudflare.Env): Promise<Response | null> {
  const expectedAction = publicAuthTurnstileAction(request);
  if (!expectedAction || !featureRequested(env, 'turnstile')) return null;

  const capabilities = commercialCapabilities(env);
  const hostnames = expectedTurnstileHostnames(env);
  if (!capabilities.turnstile || hostnames.size === 0) {
    console.error('turnstile_configuration_incomplete', { expectedAction });
    return json({ error: 'Verification is temporarily unavailable', code: 'TURNSTILE_MISCONFIGURED' }, 503);
  }

  const token = await tokenFromRequest(request);
  if (!token) return json({ error: 'Verification is required', code: 'TURNSTILE_REQUIRED' }, 400);

  const form = new FormData();
  form.set('secret', turnstileSecret(env));
  form.set('response', token);
  const ip = remoteIp(request);
  if (ip) form.set('remoteip', ip);
  form.set('idempotency_key', crypto.randomUUID());

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);
  let result: TurnstileResponse;
  try {
    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body: form,
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`siteverify_http_${response.status}`);
    result = await response.json<TurnstileResponse>();
  } catch (error) {
    console.error('turnstile_siteverify_failed', {
      expectedAction,
      name: error instanceof Error ? error.name : 'UnknownError'
    });
    return json({ error: 'Verification is temporarily unavailable', code: 'TURNSTILE_UNAVAILABLE' }, 503);
  } finally {
    clearTimeout(timeout);
  }

  const hostname = String(result.hostname || '').toLowerCase();
  const action = String(result.action || '');
  if (!result.success || !hostnames.has(hostname) || action !== expectedAction) {
    console.warn('turnstile_rejected', {
      expectedAction,
      hostnameAccepted: hostnames.has(hostname),
      actionAccepted: action === expectedAction,
      errorCodes: Array.isArray(result['error-codes']) ? result['error-codes'].slice(0, 8) : []
    });
    return json({ error: 'Verification failed', code: 'TURNSTILE_REJECTED' }, 403);
  }

  return null;
}
