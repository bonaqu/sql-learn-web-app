import { getTurnstileToken } from './turnstile-client';

const DEFAULT_CLOUD_API = 'https://sql-learn-web-app.bonaqu.workers.dev';
const AUTH_SESSION_KEY = 'sql-academy-auth-session-v2';
const AUTH_CHANGED_EVENT = 'sql-academy-auth-changed';
const LEGACY_PROGRESS_PATH = '/api/user/progress';
const MASTERY_PROGRESS_PATH = '/api/mastery/progress';
const CAPABILITY_CACHE_MS = 60_000;
const nativeFetch = window.fetch.bind(window);

const TURNSTILE_ACTIONS = new Map<string, string>([
  ['/api/auth/register', 'register'],
  ['/api/auth/login', 'login'],
  ['/api/auth/password/reset', 'password-reset'],
  ['/api/auth/contact/challenge', 'contact-challenge'],
  ['/api/auth/contact/register', 'contact-register'],
  ['/api/auth/contact/password/reset', 'contact-password-reset']
]);

const configuredApiBase = (import.meta.env.VITE_API_BASE || '').replace(/\/$/, '');
let capabilityCache: {
  expiresAt: number;
  promise: Promise<{ enabled: boolean; siteKey: string }>;
} | null = null;

function apiBase() {
  if (configuredApiBase) return configuredApiBase;
  if (window.location.hostname === 'bonaqu.github.io') return DEFAULT_CLOUD_API;
  return '';
}

function normalizedApiPath(pathname: string) {
  return pathname === LEGACY_PROGRESS_PATH ? MASTERY_PROGRESS_PATH : pathname;
}

function resolveInput(input: RequestInfo | URL): RequestInfo | URL {
  const base = apiBase();
  if (typeof input === 'string') {
    const url = new URL(input, window.location.href);
    if (url.origin !== window.location.origin || !url.pathname.startsWith('/api/')) return input;
    const pathname = normalizedApiPath(url.pathname);
    return base
      ? `${base}${pathname}${url.search}${url.hash}`
      : `${pathname}${url.search}${url.hash}`;
  }
  if (input instanceof URL) {
    if (!input.pathname.startsWith('/api/') || input.origin !== window.location.origin) return input;
    const pathname = normalizedApiPath(input.pathname);
    return new URL(`${base || window.location.origin}${pathname}${input.search}${input.hash}`);
  }
  const requestUrl = new URL(input.url, window.location.href);
  if (!requestUrl.pathname.startsWith('/api/') || requestUrl.origin !== window.location.origin) return input;
  const pathname = normalizedApiPath(requestUrl.pathname);
  return new Request(`${base || window.location.origin}${pathname}${requestUrl.search}${requestUrl.hash}`, input);
}

function authToken() {
  try {
    const session = JSON.parse(localStorage.getItem(AUTH_SESSION_KEY) || 'null') as { token?: string } | null;
    return session?.token || '';
  } catch {
    return '';
  }
}

function requestUrl(input: RequestInfo | URL) {
  if (typeof input === 'string') return new URL(input, window.location.href);
  if (input instanceof URL) return input;
  return new URL(input.url, window.location.href);
}

function requestMethod(input: RequestInfo | URL, init?: RequestInit) {
  return String(init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
}

function publicAuthRequest(url: URL) {
  return url.pathname === '/api/auth/register'
    || url.pathname === '/api/auth/login'
    || url.pathname === '/api/auth/password/reset'
    || url.pathname === '/api/auth/contact/challenge'
    || url.pathname === '/api/auth/contact/confirm'
    || url.pathname === '/api/auth/contact/register'
    || url.pathname === '/api/auth/contact/password/reset'
    || url.pathname === '/api/capabilities'
    || url.pathname === '/api/health';
}

function turnstileCapability() {
  if (capabilityCache && capabilityCache.expiresAt > Date.now()) return capabilityCache.promise;
  const base = apiBase();
  const endpoint = `${base || ''}/api/capabilities`;
  const promise = nativeFetch(endpoint, {
    headers: { accept: 'application/json' },
    cache: 'no-store'
  }).then(async response => {
    if (!response.ok) return { enabled: false, siteKey: '' };
    const payload = await response.json() as {
      integrations?: { turnstile?: { enabled?: boolean; siteKey?: string } };
    };
    return {
      enabled: payload.integrations?.turnstile?.enabled === true,
      siteKey: typeof payload.integrations?.turnstile?.siteKey === 'string'
        ? payload.integrations.turnstile.siteKey
        : ''
    };
  }).catch(() => ({ enabled: false, siteKey: '' }));
  capabilityCache = { expiresAt: Date.now() + CAPABILITY_CACHE_MS, promise };
  return promise;
}

window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const resolved = resolveInput(input);
  const url = requestUrl(resolved);
  const headers = new Headers(input instanceof Request ? input.headers : undefined);
  if (init?.headers) new Headers(init.headers).forEach((value, name) => headers.set(name, value));
  const token = authToken();
  if (url.pathname.startsWith('/api/') && token && !headers.has('authorization')) {
    headers.set('authorization', `Bearer ${token}`);
  }

  const action = requestMethod(resolved, init) === 'POST' ? TURNSTILE_ACTIONS.get(url.pathname) : undefined;
  if (action && !headers.has('cf-turnstile-response')) {
    const turnstile = await turnstileCapability();
    if (turnstile.enabled) {
      if (!turnstile.siteKey) throw new Error('Turnstile включён без публичного site key. Обратись в поддержку.');
      headers.set('cf-turnstile-response', await getTurnstileToken(turnstile.siteKey, action));
    }
  }

  const response = await nativeFetch(resolved, { ...init, headers });
  if (response.status === 401 && url.pathname.startsWith('/api/') && !publicAuthRequest(url)) {
    localStorage.removeItem(AUTH_SESSION_KEY);
    localStorage.removeItem('sql-academy-account-session-v1');
    window.dispatchEvent(new CustomEvent(AUTH_CHANGED_EVENT, { detail: null }));
  }
  return response;
}) as typeof window.fetch;

export {};
