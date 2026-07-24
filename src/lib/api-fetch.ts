const DEFAULT_CLOUD_API = 'https://sql-learn-web-app.bonaqu.workers.dev';
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

  if (typeof input === 'string') {
    return input.startsWith('/api/') ? `${base}${input}` : input;
  }

  if (input instanceof URL) {
    return input.pathname.startsWith('/api/') && input.origin === window.location.origin
      ? new URL(`${base}${input.pathname}${input.search}${input.hash}`)
      : input;
  }

  const requestUrl = new URL(input.url, window.location.href);
  if (!requestUrl.pathname.startsWith('/api/') || requestUrl.origin !== window.location.origin) return input;

  return new Request(`${base}${requestUrl.pathname}${requestUrl.search}${requestUrl.hash}`, input);
}

window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => nativeFetch(resolveInput(input), init)) as typeof window.fetch;

export {};
