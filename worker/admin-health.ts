import {
  adminAllowedUserIds,
  adminConsoleReady,
  commercialCapabilities,
  commercialConfigurationErrors,
  CommercialEnvironment
} from './commercial-capabilities';

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
  if (new URL(request.url).pathname !== '/api/admin/health') return null;
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
  if (new URL(request.url).pathname !== '/api/admin/health') return null;
  if (!adminConsoleReady(env) || !adminAllowedUserIds(env).has(userId)) return json({ error: 'Not found' }, 404);
  if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405, { allow: 'GET' });
  if (!env.DB) return json({ error: 'D1 binding is not configured' }, 503);

  const [users, activeSessions, progressRows, latestUserUpdate, latestProgressUpdate] = await Promise.all([
    scalarCount(env, 'SELECT COUNT(*) AS count FROM users'),
    scalarCount(env, "SELECT COUNT(*) AS count FROM auth_sessions WHERE expires_at > datetime('now')"),
    scalarCount(env, 'SELECT COUNT(*) AS count FROM progress'),
    scalarTimestamp(env, 'SELECT MAX(updated_at) AS value FROM users'),
    scalarTimestamp(env, 'SELECT MAX(updated_at) AS value FROM progress')
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
    }
  });
}
