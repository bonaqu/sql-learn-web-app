import { contactVerificationReady } from './contact-verification';

type CommercialEnvKey =
  | 'FEATURE_EMAIL_VERIFICATION'
  | 'FEATURE_SMS_VERIFICATION'
  | 'FEATURE_TURNSTILE'
  | 'FEATURE_ADMIN_CONSOLE'
  | 'CONTACT_VERIFICATION_SIGNING_SECRET'
  | 'EMAIL_VERIFICATION_WEBHOOK_URL'
  | 'EMAIL_VERIFICATION_WEBHOOK_SECRET'
  | 'EMAIL_VERIFICATION_EVENT_SECRET'
  | 'SMS_VERIFICATION_WEBHOOK_URL'
  | 'SMS_VERIFICATION_WEBHOOK_SECRET'
  | 'SMS_VERIFICATION_EVENT_SECRET'
  | 'TURNSTILE_SECRET_KEY'
  | 'TURNSTILE_EXPECTED_HOSTNAMES'
  | 'ADMIN_ALLOWED_USER_IDS';

export type CommercialEnvironment = Cloudflare.Env & Partial<Record<CommercialEnvKey, string>>;

type CommercialCapabilityName =
  | 'emailVerification'
  | 'smsVerification'
  | 'turnstile'
  | 'adminConsole';

export type CommercialCapabilities = {
  contract: 'commercial-capabilities-v1';
  authentication: {
    usernamePassword: true;
    recoveryCodes: true;
  };
  integrations: Record<CommercialCapabilityName, { enabled: boolean }>;
};

const USER_ID_PATTERN = /^[a-zA-Z0-9_-]{8,80}$/;
const HOSTNAME_PATTERN = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export function enabledFlag(value: string | undefined) {
  return value?.trim().toLowerCase() === 'on';
}

function commaSeparated(value: string | undefined, max: number) {
  return (value || '').split(',').map(item => item.trim()).filter(Boolean).slice(0, max);
}

export function adminAllowedUserIds(env: CommercialEnvironment) {
  return new Set(commaSeparated(env.ADMIN_ALLOWED_USER_IDS, 100).filter(value => USER_ID_PATTERN.test(value)));
}

export function expectedTurnstileHostnames(env: CommercialEnvironment) {
  return new Set(commaSeparated(env.TURNSTILE_EXPECTED_HOSTNAMES, 30)
    .map(value => value.toLowerCase())
    .filter(value => HOSTNAME_PATTERN.test(value)));
}

export function turnstileSecret(env: CommercialEnvironment) {
  return (env.TURNSTILE_SECRET_KEY || '').trim().slice(0, 2_000);
}

export function turnstileReady(env: CommercialEnvironment) {
  return enabledFlag(env.FEATURE_TURNSTILE)
    && turnstileSecret(env).length >= 8
    && expectedTurnstileHostnames(env).size > 0;
}

export function adminConsoleReady(env: CommercialEnvironment) {
  return enabledFlag(env.FEATURE_ADMIN_CONSOLE) && adminAllowedUserIds(env).size > 0;
}

export function commercialConfigurationErrors(env: CommercialEnvironment) {
  const errors: string[] = [];
  if (enabledFlag(env.FEATURE_EMAIL_VERIFICATION) && !contactVerificationReady('email', env)) {
    errors.push('EMAIL_VERIFICATION_INCOMPLETE');
  }
  if (enabledFlag(env.FEATURE_SMS_VERIFICATION) && !contactVerificationReady('sms', env)) {
    errors.push('SMS_VERIFICATION_INCOMPLETE');
  }
  if (enabledFlag(env.FEATURE_TURNSTILE) && !turnstileReady(env)) errors.push('TURNSTILE_INCOMPLETE');
  if (enabledFlag(env.FEATURE_ADMIN_CONSOLE) && !adminConsoleReady(env)) errors.push('ADMIN_ALLOWLIST_EMPTY');
  return errors;
}

export function commercialCapabilities(env: CommercialEnvironment): CommercialCapabilities {
  return {
    contract: 'commercial-capabilities-v1',
    authentication: {
      usernamePassword: true,
      recoveryCodes: true
    },
    integrations: {
      emailVerification: { enabled: contactVerificationReady('email', env) },
      smsVerification: { enabled: contactVerificationReady('sms', env) },
      turnstile: { enabled: turnstileReady(env) },
      adminConsole: { enabled: adminConsoleReady(env) }
    }
  };
}

export function handleCommercialCapabilitiesRequest(request: Request, env: CommercialEnvironment) {
  const url = new URL(request.url);
  if (url.pathname !== '/api/capabilities') return null;
  if (request.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: {
        allow: 'GET, OPTIONS',
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff'
      }
    });
  }

  return new Response(JSON.stringify(commercialCapabilities(env)), {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=60, must-revalidate',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
      'x-commercial-capabilities-contract': 'commercial-capabilities-v1'
    }
  });
}