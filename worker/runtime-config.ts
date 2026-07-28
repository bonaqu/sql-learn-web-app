type CommercialBindings = Cloudflare.Env & {
  ALLOWED_ORIGINS?: string;
  PRODUCT_NAME?: string;
  DEPLOYMENT_ENVIRONMENT?: string;
  FEATURE_EMAIL_VERIFICATION?: string;
  FEATURE_SMS_VERIFICATION?: string;
  FEATURE_TURNSTILE?: string;
  FEATURE_ADMIN_CONSOLE?: string;
  EMAIL_PROVIDER?: string;
  EMAIL_PROVIDER_ENDPOINT?: string;
  EMAIL_API_KEY?: string;
  EMAIL_FROM?: string;
  SMS_PROVIDER?: string;
  SMS_PROVIDER_ENDPOINT?: string;
  SMS_API_KEY?: string;
  SMS_FROM?: string;
  TURNSTILE_SECRET_KEY?: string;
  TURNSTILE_EXPECTED_HOSTNAMES?: string;
  ADMIN_ALLOWED_USER_IDS?: string;
};

export type CommercialFeature = 'emailVerification' | 'smsVerification' | 'turnstile' | 'adminConsole';

const TRUE_VALUES = new Set(['1', 'true', 'on', 'enabled', 'yes']);
const LOCAL_ORIGINS = new Set([
  'http://localhost:4173',
  'http://127.0.0.1:4173',
  'http://localhost:5173',
  'http://127.0.0.1:5173'
]);

function bindings(env: Cloudflare.Env) {
  return env as CommercialBindings;
}

function clean(value: unknown, max = 500) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

export function featureRequested(env: Cloudflare.Env, feature: CommercialFeature) {
  const source = bindings(env);
  const value = feature === 'emailVerification'
    ? source.FEATURE_EMAIL_VERIFICATION
    : feature === 'smsVerification'
      ? source.FEATURE_SMS_VERIFICATION
      : feature === 'turnstile'
        ? source.FEATURE_TURNSTILE
        : source.FEATURE_ADMIN_CONSOLE;
  return TRUE_VALUES.has(clean(value, 32).toLowerCase());
}

function providerReady(provider: unknown, endpoint: unknown, apiKey: unknown, sender: unknown) {
  const providerName = clean(provider, 80).toLowerCase();
  if (!providerName || providerName === 'disabled') return false;
  const target = clean(endpoint, 500);
  try {
    const url = new URL(target);
    if (url.protocol !== 'https:') return false;
  } catch {
    return false;
  }
  return clean(apiKey, 2_000).length >= 8 && clean(sender, 320).length >= 3;
}

export function adminAllowedUserIds(env: Cloudflare.Env) {
  return new Set(clean(bindings(env).ADMIN_ALLOWED_USER_IDS, 4_000)
    .split(',')
    .map(value => value.trim())
    .filter(value => /^[a-zA-Z0-9_-]{8,80}$/.test(value))
    .slice(0, 100));
}

export function expectedTurnstileHostnames(env: Cloudflare.Env) {
  return new Set(clean(bindings(env).TURNSTILE_EXPECTED_HOSTNAMES, 2_000)
    .split(',')
    .map(value => value.trim().toLowerCase())
    .filter(value => /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(value))
    .slice(0, 30));
}

export function turnstileSecret(env: Cloudflare.Env) {
  return clean(bindings(env).TURNSTILE_SECRET_KEY, 2_000);
}

export function commercialCapabilities(env: Cloudflare.Env) {
  const source = bindings(env);
  const emailVerification = featureRequested(env, 'emailVerification')
    && providerReady(source.EMAIL_PROVIDER, source.EMAIL_PROVIDER_ENDPOINT, source.EMAIL_API_KEY, source.EMAIL_FROM);
  const smsVerification = featureRequested(env, 'smsVerification')
    && providerReady(source.SMS_PROVIDER, source.SMS_PROVIDER_ENDPOINT, source.SMS_API_KEY, source.SMS_FROM);
  const turnstile = featureRequested(env, 'turnstile') && turnstileSecret(env).length >= 8;
  const adminConsole = featureRequested(env, 'adminConsole') && adminAllowedUserIds(env).size > 0;

  return Object.freeze({
    version: 1 as const,
    usernamePassword: true,
    recoveryCodes: true,
    emailVerification,
    smsVerification,
    turnstile,
    adminConsole
  });
}

export function commercialConfigurationErrors(env: Cloudflare.Env) {
  const source = bindings(env);
  const errors: string[] = [];
  if (featureRequested(env, 'emailVerification')
    && !providerReady(source.EMAIL_PROVIDER, source.EMAIL_PROVIDER_ENDPOINT, source.EMAIL_API_KEY, source.EMAIL_FROM)) {
    errors.push('EMAIL_VERIFICATION_INCOMPLETE');
  }
  if (featureRequested(env, 'smsVerification')
    && !providerReady(source.SMS_PROVIDER, source.SMS_PROVIDER_ENDPOINT, source.SMS_API_KEY, source.SMS_FROM)) {
    errors.push('SMS_VERIFICATION_INCOMPLETE');
  }
  if (featureRequested(env, 'turnstile') && turnstileSecret(env).length < 8) errors.push('TURNSTILE_INCOMPLETE');
  if (featureRequested(env, 'adminConsole') && adminAllowedUserIds(env).size === 0) errors.push('ADMIN_ALLOWLIST_EMPTY');
  return errors;
}

export function productRuntime(env: Cloudflare.Env) {
  const source = bindings(env);
  return {
    productName: clean(source.PRODUCT_NAME, 80) || 'SQL Academy',
    environment: clean(source.DEPLOYMENT_ENVIRONMENT, 32) || 'production'
  };
}

export function configuredOrigins(env: Cloudflare.Env) {
  const origins = new Set(LOCAL_ORIGINS);
  for (const raw of clean(bindings(env).ALLOWED_ORIGINS, 4_000).split(',')) {
    const candidate = raw.trim();
    if (!candidate) continue;
    try {
      const url = new URL(candidate);
      if ((url.protocol === 'https:' || url.protocol === 'http:') && url.origin === candidate) origins.add(candidate);
    } catch {
      // Invalid entries are ignored instead of broadening CORS.
    }
    if (origins.size >= 30) break;
  }
  return origins;
}

export function requestOriginAllowed(request: Request, env: Cloudflare.Env) {
  const origin = request.headers.get('origin');
  if (!origin) return null;
  if (origin === new URL(request.url).origin || configuredOrigins(env).has(origin)) return origin;
  return false;
}
