const DEFAULT_CLOUD_API = 'https://sql-learn-web-app.bonaqu.workers.dev';
const AUTH_SESSION_KEY = 'sql-academy-auth-session-v2';
const AUTH_CHANGED_EVENT = 'sql-academy-auth-changed';
const nativeFetch = window.fetch.bind(window);

const configuredApiBase = (import.meta.env.VITE_API_BASE || '').replace(/\/$/, '');

function apiBase() {
  if (configuredApiBase) return configuredApiBase;
  if (window.location.hostname === 'bonaqu.github.io') return DEFAULT_CLOUD_API;
  return '';
}

function resolveInput(input: RequestInfo | URL): RequestInfo | URL {
  const base = apiBase();
  if (!base) return input;
  if (typeof input === 'string') return input.startsWith('/api/') ? `${base}${input}` : input;
  if (input instanceof URL) {
    return input.pathname.startsWith('/api/') && input.origin === window.location.origin
      ? new URL(`${base}${input.pathname}${input.search}${input.hash}`)
      : input;
  }
  const requestUrl = new URL(input.url, window.location.href);
  if (!requestUrl.pathname.startsWith('/api/') || requestUrl.origin !== window.location.origin) return input;
  return new Request(`${base}${requestUrl.pathname}${requestUrl.search}${requestUrl.hash}`, input);
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

function publicAuthRequest(url: URL) {
  return url.pathname === '/api/auth/register'
    || url.pathname === '/api/auth/login'
    || url.pathname === '/api/auth/password/reset'
    || url.pathname === '/api/health';
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
  const response = await nativeFetch(resolved, { ...init, headers });
  if (response.status === 401 && url.pathname.startsWith('/api/') && !publicAuthRequest(url)) {
    localStorage.removeItem(AUTH_SESSION_KEY);
    localStorage.removeItem('sql-academy-account-session-v1');
    window.dispatchEvent(new CustomEvent(AUTH_CHANGED_EVENT, { detail: null }));
  }
  return response;
}) as typeof window.fetch;

export {};
