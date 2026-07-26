import app from './index';
import { authenticateSession } from './auth';
import { handleDialectRealEngineRequest } from './dialect-real-engine-route';

export { Sandbox } from '@cloudflare/sandbox';

const ALLOWED_ORIGINS = new Set([
  'https://bonaqu.github.io',
  'http://localhost:4173',
  'http://127.0.0.1:4173',
  'http://localhost:5173',
  'http://127.0.0.1:5173'
]);

function allowedOrigin(request: Request) {
  const origin = request.headers.get('origin');
  if (!origin) return null;
  if (origin === new URL(request.url).origin || ALLOWED_ORIGINS.has(origin)) return origin;
  return false;
}

function withCors(response: Response, origin: string) {
  const headers = new Headers(response.headers);
  headers.set('access-control-allow-origin', origin);
  headers.set('access-control-expose-headers', 'retry-after, x-request-id, x-dialect-lab-contract');
  headers.set('vary', 'Origin');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

export default {
  async fetch(request: Request, env: Cloudflare.Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== '/api/dialect-labs/execute' || request.method !== 'POST') {
      return app.fetch(request, env);
    }

    const origin = allowedOrigin(request);
    if (origin === false) return app.fetch(request, env);
    const auth = await authenticateSession(request, env);
    if (auth instanceof Response) return origin ? withCors(auth, origin) : auth;
    const response = await handleDialectRealEngineRequest(request, env, auth.userId);
    if (!response) return app.fetch(request, env);
    return origin ? withCors(response, origin) : response;
  }
} satisfies ExportedHandler<Cloudflare.Env>;
