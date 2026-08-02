import {
  adminAllowedUserIds,
  adminConsoleReady,
  commercialCapabilities,
  commercialConfigurationErrors,
  CommercialEnvironment
} from './commercial-capabilities';
import { contactDeliveryTimeline, contactOperationalHealth } from './contact-observability';

const ADMIN_PATHS = new Set(['/api/admin/health', '/api/admin/contact-delivery']);
const CHALLENGE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const json = (data: unknown, status = 200, extraHeaders: Record<string, string> = {}) => new Response(JSON.stringify(data), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    ...extraHeaders
  }
});

export function handleHiddenAdminBoundary(request: Request, env: CommercialEnvironment) {
  if (!ADMIN_PATHS.has(new URL(request.url).pathname)) return null;
  return adminConsoleReady(env) ? null : json({ error: 'Not found' }, 404);
}

async function scalarCount(env: Cloudflare.Env, sql: string) {
  const row = await env.DB.prepare(sql).first<{ count: number }>();
  return Math.max(0, Number(row?.count) || 0);
}

async function scalarTimestamp(env: Cloudflare.Env, sql: string) {
  const row = await env.DB.prepare(sql).first<{ value: string | null }>();
  return row?.value || null;
}

export async function handleAdminHealthRequest(
  request: Request,
  env: CommercialEnvironment,
  userId: string
): Promise<Response | null> {
  const url = new URL(request.url);
  if (!ADMIN_PATHS.has(url.pathname)) return null;
  if (!adminConsoleReady(env) || !adminAllowedUserIds(env).has(userId)) return json({ error: 'Not found' }, 404);
  if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405, { allow: 'GET' });
  if (!env.DB) return json({ error: 'D1 binding is not configured' }, 503);

  if (url.pathname === '/api/admin/contact-delivery') {
    const challengeId = (url.searchParams.get('challengeId') || '').trim();
    if (!CHALLENGE_ID_PATTERN.test(challengeId)) return json({ error: 'Invalid challenge' }, 400);
    const timeline = await contactDeliveryTimeline(env, challengeId);
    return timeline ? json({ contract: 'contact-delivery-admin-v1', ...timeline }) : json({ error: 'Not found' }, 404);
  }

  const [users, activeSessions, progressRows, latestUserUpdate, latestProgressUpdate, contacts] = await Promise.all([
    scalarCount(env, 'SELECT COUNT(*) AS count FROM users'),
    scalarCount(env, "SELECT COUNT(*) AS count FROM auth_sessions WHERE expires_at > datetime('now')"),
    scalarCount(env, 'SELECT COUNT(*) AS count FROM progress'),
    scalarTimestamp(env, 'SELECT MAX(updated_at) AS value FROM users'),
    scalarTimestamp(env, 'SELECT MAX(updated_at) AS value FROM progress'),
    contactOperationalHealth(env)
  ]);

  return json({
    ok: true,
    generatedAt: new Date().toISOString(),
    capabilities: commercialCapabilities(env),
    configurationErrors: commercialConfigurationErrors(env),
    bindings: {
      d1: Boolean(env.DB),
      kv: Boolean(env.SETTINGS),
      ai: Boolean(env.AI)
    },
    aggregates: {
      users,
      activeSessions,
      progressRows,
      latestUserUpdate,
      latestProgressUpdate
    },
    contacts
  });
}