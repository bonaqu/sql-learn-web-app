type CommercialEnvKey =
  | 'FEATURE_EMAIL_VERIFICATION'
  | 'FEATURE_SMS_VERIFICATION'
  | 'FEATURE_TURNSTILE'
  | 'FEATURE_ADMIN_CONSOLE';

type CommercialEnvironment = Cloudflare.Env & Partial<Record<CommercialEnvKey, string>>;

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

const IMPLEMENTED_CAPABILITIES: Readonly<Record<CommercialCapabilityName, boolean>> = Object.freeze({
  emailVerification: false,
  smsVerification: false,
  turnstile: false,
  adminConsole: false
});

function enabledFlag(value: string | undefined) {
  return value?.trim().toLowerCase() === 'on';
}

export function commercialCapabilities(env: CommercialEnvironment): CommercialCapabilities {
  const requested = {
    emailVerification: enabledFlag(env.FEATURE_EMAIL_VERIFICATION),
    smsVerification: enabledFlag(env.FEATURE_SMS_VERIFICATION),
    turnstile: enabledFlag(env.FEATURE_TURNSTILE),
    adminConsole: enabledFlag(env.FEATURE_ADMIN_CONSOLE)
  } satisfies Record<CommercialCapabilityName, boolean>;

  return {
    contract: 'commercial-capabilities-v1',
    authentication: {
      usernamePassword: true,
      recoveryCodes: true
    },
    integrations: {
      emailVerification: { enabled: requested.emailVerification && IMPLEMENTED_CAPABILITIES.emailVerification },
      smsVerification: { enabled: requested.smsVerification && IMPLEMENTED_CAPABILITIES.smsVerification },
      turnstile: { enabled: requested.turnstile && IMPLEMENTED_CAPABILITIES.turnstile },
      adminConsole: { enabled: requested.adminConsole && IMPLEMENTED_CAPABILITIES.adminConsole }
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
