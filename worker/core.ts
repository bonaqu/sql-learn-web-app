import { handleMentorRequest } from './mentor';

const MAX_SETTINGS_BYTES = 20_000;
const PROFILE_PATTERN = /^[a-zA-Z0-9_-]{8,80}$/;

const json = (data: unknown, status = 200, extraHeaders: Record<string, string> = {}) => new Response(JSON.stringify(data), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    ...extraHeaders
  }
});

const profileId = (request: Request): string | null => {
  const raw = request.headers.get('x-profile-id')?.trim() || '';
  return PROFILE_PATTERN.test(raw) ? raw : null;
};

const bodyTooLarge = (request: Request, maxBytes: number) => {
  const length = Number(request.headers.get('content-length') || 0);
  return Number.isFinite(length) && length > maxBytes;
};

export default {
  async fetch(request: Request, env: Cloudflare.Env): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);

    const mentorResponse = await handleMentorRequest(request, env);
    if (mentorResponse) return mentorResponse;

    if (url.pathname === '/api/health') {
      return json({
        ok: true,
        d1: Boolean(env.DB),
        kv: Boolean(env.SETTINGS),
        ai: Boolean(env.AI),
        progressVersion: 4,
        curriculumVersion: 1
      });
    }

    if (url.pathname === '/api/progress') {
      const id = profileId(request);
      if (!id) return json({ error: 'A valid x-profile-id header is required' }, 400);
      if (!env.DB) return json({ error: 'D1 binding is not configured' }, 503);

      if (request.method === 'GET') {
        const row = await env.DB.prepare('SELECT payload, revision, updated_at FROM progress WHERE profile_id = ?')
          .bind(id)
          .first<{ payload: string; revision: number; updated_at: string }>();
        if (!row) return json({ progress: null, revision: 0, updatedAt: null });
        try {
          return json({ progress: JSON.parse(row.payload), revision: row.revision || 0, updatedAt: row.updated_at });
        } catch {
          return json({ error: 'Stored progress is corrupted' }, 500);
        }
      }

      if (request.method === 'PUT') {
        // Drain the rejected legacy payload before returning. Leaving the request
        // stream unread can tear down the local Worker proxy connection and makes
        // the explicit 428 recovery contract unreliable for real clients as well.
        await request.arrayBuffer();
        return json({
          error: 'Legacy progress writes are read-only. Reload and use the revisioned mastery progress contract.',
          code: 'PROGRESS_REVISION_REQUIRED',
          recoveryPath: '/api/mastery/progress'
        }, 428, { 'x-progress-contract': 'legacy-read-only' });
      }

      return json({ error: 'Method not allowed' }, 405, { allow: 'GET' });
    }

    if (url.pathname === '/api/settings') {
      const id = profileId(request);
      if (!id) return json({ error: 'A valid x-profile-id header is required' }, 400);
      if (!env.SETTINGS) return json({ error: 'KV binding is not configured' }, 503);
      const key = `profile:${id}`;
      if (request.method === 'GET') return json({ settings: await env.SETTINGS.get(key, 'json') });
      if (request.method === 'PUT') {
        if (bodyTooLarge(request, MAX_SETTINGS_BYTES)) return json({ error: 'Settings payload is too large' }, 413);
        const payload: unknown = await request.json();
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return json({ error: 'Invalid settings payload' }, 400);
        const serialized = JSON.stringify(payload);
        if (new TextEncoder().encode(serialized).byteLength > MAX_SETTINGS_BYTES) return json({ error: 'Settings payload is too large' }, 413);
        await env.SETTINGS.put(key, serialized);
        return json({ ok: true });
      }
      return json({ error: 'Method not allowed' }, 405, { allow: 'GET, PUT' });
    }

    return json({ error: 'Not found' }, 404);
  }
} satisfies ExportedHandler<Cloudflare.Env>;
