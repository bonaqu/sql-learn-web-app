const DEFAULT_CLOUD_API = 'https://sql-learn-web-app.bonaqu.workers.dev';
const AUTH_SESSION_KEY = 'sql-academy-auth-session-v2';
const AUTH_CHANGED_EVENT = 'sql-academy-auth-changed';
const LEGACY_PROGRESS_PATH = '/api/user/progress';
const MASTERY_PROGRESS_PATH = '/api/mastery/progress';
const TRANSIENT_STATUSES = new Set([502, 503, 504]);
const REPLAYABLE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS', 'PUT']);
const MAX_API_ATTEMPTS = 4;
const nativeFetch = window.fetch.bind(window);

const configuredApiBase = (import.meta.env.VITE_API_BASE || '').replace(/\/$/, '');

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

function publicAuthRequest(url: URL) {
  return url.pathname === '/api/auth/register'
    || url.pathname === '/api/auth/login'
    || url.pathname === '/api/auth/password/reset'
    || url.pathname === '/api/health';
}

function requestMethod(input: RequestInfo | URL, init?: RequestInit) {
  const fromRequest = input instanceof Request ? input.method : 'GET';
  return String(init?.method || fromRequest || 'GET').toUpperCase();
}

function retryDelay(attempt: number, response?: Response) {
  const retryAfter = Number(response?.headers.get('retry-after'));
  if (Number.isFinite(retryAfter) && retryAfter > 0) return Math.min(retryAfter * 1_000, 2_000);
  return Math.min(250 * 2 ** Math.max(0, attempt - 1), 1_500);
}

function sleep(milliseconds: number, signal?: AbortSignal | null) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason || new DOMException('The operation was aborted.', 'AbortError'));
      return;
    }
    const timer = window.setTimeout(resolve, milliseconds);
    signal?.addEventListener('abort', () => {
      window.clearTimeout(timer);
      reject(signal.reason || new DOMException('The operation was aborted.', 'AbortError'));
    }, { once: true });
  });
}

async function fetchWithTransientRecovery(
  resolved: RequestInfo | URL,
  init: RequestInit,
  method: string,
  isApiRequest: boolean
) {
  const replayable = isApiRequest && REPLAYABLE_METHODS.has(method);
  const requestTemplate = resolved instanceof Request ? resolved.clone() : resolved;
  let lastError: unknown;

  for (let attempt = 1; attempt <= (replayable ? MAX_API_ATTEMPTS : 1); attempt += 1) {
    try {
      const attemptInput = requestTemplate instanceof Request ? requestTemplate.clone() : requestTemplate;
      const response = await nativeFetch(attemptInput, init);
      if (!replayable || !TRANSIENT_STATUSES.has(response.status) || attempt === MAX_API_ATTEMPTS) return response;
      await sleep(retryDelay(attempt, response), init.signal);
    } catch (error) {
      lastError = error;
      if (!replayable || init.signal?.aborted || attempt === MAX_API_ATTEMPTS) throw error;
      await sleep(retryDelay(attempt), init.signal);
    }
  }

  throw lastError instanceof Error ? lastError : new Error('API request failed after transient recovery attempts.');
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
  const method = requestMethod(input, init);
  const requestInit = { ...init, headers };
  const response = await fetchWithTransientRecovery(resolved, requestInit, method, url.pathname.startsWith('/api/'));
  if (response.status === 401 && url.pathname.startsWith('/api/') && !publicAuthRequest(url)) {
    localStorage.removeItem(AUTH_SESSION_KEY);
    localStorage.removeItem('sql-academy-account-session-v1');
    window.dispatchEvent(new CustomEvent(AUTH_CHANGED_EVENT, { detail: null }));
  }
  return response;
}) as typeof window.fetch;

export {};