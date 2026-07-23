type ProgressPayload = {
  completed: string[];
  attempts: Record<string, number>;
  xp: number;
  streak: number;
  history: Array<{ day: string; solved: number }>;
  lastTask?: string;
};

const MAX_PROGRESS_BYTES = 200_000;
const MAX_SETTINGS_BYTES = 20_000;
const PROFILE_PATTERN = /^[a-zA-Z0-9_-]{8,80}$/;

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff'
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

const validProgress = (payload: unknown): payload is ProgressPayload => {
  if (!payload || typeof payload !== 'object') return false;
  const value = payload as Partial<ProgressPayload>;
  return Array.isArray(value.completed)
    && value.completed.every(item => typeof item === 'string' && item.length <= 80)
    && typeof value.attempts === 'object'
    && value.attempts !== null
    && typeof value.xp === 'number'
    && Number.isFinite(value.xp)
    && value.xp >= 0
    && typeof value.streak === 'number'
    && Number.isFinite(value.streak)
    && Array.isArray(value.history);
};

export default {
  async fetch(request: Request, env: Cloudflare.Env): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);

    if (url.pathname === '/api/health') {
      return json({ ok: true, d1: Boolean(env.DB), kv: Boolean(env.SETTINGS), ai: Boolean(env.AI) });
    }

    if (url.pathname === '/api/progress') {
      const id = profileId(request);
      if (!id) return json({ error: 'A valid x-profile-id header is required' }, 400);
      if (!env.DB) return json({ error: 'D1 binding is not configured' }, 503);

      if (request.method === 'GET') {
        const row = await env.DB.prepare('SELECT payload, updated_at FROM progress WHERE profile_id = ?')
          .bind(id)
          .first<{ payload: string; updated_at: string }>();
        if (!row) return json({ progress: null });
        try {
          return json({ progress: JSON.parse(row.payload), updatedAt: row.updated_at });
        } catch {
          return json({ error: 'Stored progress is corrupted' }, 500);
        }
      }

      if (request.method === 'PUT') {
        if (bodyTooLarge(request, MAX_PROGRESS_BYTES)) return json({ error: 'Progress payload is too large' }, 413);
        const payload: unknown = await request.json();
        if (!validProgress(payload)) return json({ error: 'Invalid progress payload' }, 400);
        const serialized = JSON.stringify(payload);
        if (new TextEncoder().encode(serialized).byteLength > MAX_PROGRESS_BYTES) return json({ error: 'Progress payload is too large' }, 413);
        await env.DB.prepare(`INSERT INTO progress(profile_id, payload, updated_at) VALUES(?, ?, datetime('now'))
          ON CONFLICT(profile_id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at`)
          .bind(id, serialized)
          .run();
        return json({ ok: true });
      }

      return json({ error: 'Method not allowed' }, 405);
    }

    if (url.pathname === '/api/settings') {
      const id = profileId(request);
      if (!id) return json({ error: 'A valid x-profile-id header is required' }, 400);
      if (!env.SETTINGS) return json({ error: 'KV binding is not configured' }, 503);

      if (request.method === 'GET') {
        return json({ settings: await env.SETTINGS.get(`settings:${id}`, 'json') });
      }

      if (request.method === 'PUT') {
        if (bodyTooLarge(request, MAX_SETTINGS_BYTES)) return json({ error: 'Settings payload is too large' }, 413);
        const settings: unknown = await request.json();
        if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return json({ error: 'Invalid settings payload' }, 400);
        const serialized = JSON.stringify(settings);
        if (new TextEncoder().encode(serialized).byteLength > MAX_SETTINGS_BYTES) return json({ error: 'Settings payload is too large' }, 413);
        await env.SETTINGS.put(`settings:${id}`, serialized, { expirationTtl: 60 * 60 * 24 * 365 });
        return json({ ok: true });
      }

      return json({ error: 'Method not allowed' }, 405);
    }

    if (url.pathname === '/api/mentor' && request.method === 'POST') {
      if (bodyTooLarge(request, 30_000)) return json({ error: 'Mentor request is too large' }, 413);
      const body = await request.json<{ question?: string; sql?: string; task?: string }>();
      const question = (body.question || '').slice(0, 1500);
      const sql = (body.sql || '').slice(0, 5000);
      const task = (body.task || '').slice(0, 1500);
      if (!env.AI) return json({ answer: localMentor(sql) });

      try {
        const response = await env.AI.run('@cf/meta/llama-3.2-3b-instruct', {
          messages: [
            {
              role: 'system',
              content: 'Ты SQL-наставник для 2nd Support Engineer. Отвечай по-русски. Не запрашивай персональные данные и не придумывай схему. Не выдавай готовое решение сразу: сначала диагноз, затем один следующий шаг, затем инженерное объяснение. Учитывай SQLite.'
            },
            { role: 'user', content: `Задача: ${task}\n\nВопрос: ${question}\n\nSQL:\n${sql}` }
          ],
          max_tokens: 550,
          temperature: 0.2
        }) as { response?: string };
        return json({ answer: response.response || localMentor(sql) });
      } catch (error) {
        console.error(JSON.stringify({ event: 'mentor_fallback', message: error instanceof Error ? error.message : String(error) }));
        return json({ answer: localMentor(sql), fallback: true });
      }
    }

    return json({ error: 'Not found' }, 404);
  }
};

function localMentor(sql: string) {
  const normalized = sql.toLowerCase();
  const tips: string[] = [];
  if (normalized.includes('select *')) tips.push('Замени SELECT * явным списком столбцов.');
  if (normalized.includes('= null')) tips.push('Для NULL используй IS NULL или IS NOT NULL.');
  if (normalized.includes('group by') && !normalized.includes('order by')) tips.push('Для стабильного отчёта добавь детерминированный ORDER BY.');
  if (normalized.includes(' like ') && normalized.includes("'%")) tips.push('LIKE с ведущим % часто мешает использовать обычный индекс.');
  if (!normalized.includes('explain') && normalized.includes('join')) tips.push('Проверь план через EXPLAIN QUERY PLAN и индексы на ключах JOIN.');
  return tips.length
    ? `Локальный разбор:\n• ${tips.join('\n• ')}`
    : 'Запрос выглядит структурно нормально. Проверь контрольные строки, обработку NULL и план выполнения.';
}
