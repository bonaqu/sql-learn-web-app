import core from './core';

const ALLOWED_ORIGINS = new Set([
  'https://bonaqu.github.io',
  'http://localhost:4173',
  'http://127.0.0.1:4173',
  'http://localhost:5173',
  'http://127.0.0.1:5173'
]);

const CORS_METHODS = 'GET, PUT, POST, OPTIONS';
const CORS_HEADERS = 'content-type, x-profile-id';

function allowedOrigin(request: Request) {
  const origin = request.headers.get('origin');
  if (!origin) return null;
  if (origin === new URL(request.url).origin || ALLOWED_ORIGINS.has(origin)) return origin;
  return false;
}

function corsHeaders(origin: string) {
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': CORS_METHODS,
    'access-control-allow-headers': CORS_HEADERS,
    'access-control-expose-headers': 'retry-after',
    'access-control-max-age': '86400',
    vary: 'Origin'
  };
}

function withCors(response: Response, origin: string) {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(corsHeaders(origin))) headers.set(name, value);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

export default {
  async fetch(request: Request, env: Cloudflare.Env): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return core.fetch(request, env);

    const origin = allowedOrigin(request);
    if (origin === false) {
      return new Response(JSON.stringify({ error: 'Origin is not allowed' }), {
        status: 403,
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'no-store',
          'x-content-type-options': 'nosniff',
          vary: 'Origin'
        }
      });
    }

    if (request.method === 'OPTIONS') {
      if (!origin) return new Response(null, { status: 204, headers: { allow: CORS_METHODS } });
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    const response = await core.fetch(request, env);
    return origin ? withCors(response, origin) : response;
  }
} satisfies ExportedHandler<Cloudflare.Env>;
