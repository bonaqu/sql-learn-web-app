interface Env {
  DB?: D1Database;
  SETTINGS?: KVNamespace;
  AI?: Ai;
  ASSETS: Fetcher;
}

type ProgressPayload = {
  completed: string[];
  attempts: Record<string, number>;
  xp: number;
  streak: number;
  history: Array<{ day: string; solved: number }>;
};

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
});

const profileId = (request: Request) => {
  const raw = request.headers.get('x-profile-id') || 'private-local-profile';
  return raw.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80) || 'private-local-profile';
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);

    if (url.pathname === '/api/health') {
      return json({ ok: true, d1: Boolean(env.DB), kv: Boolean(env.SETTINGS), ai: Boolean(env.AI) });
    }

    if (url.pathname === '/api/progress') {
      const id = profileId(request);
      if (!env.DB) return json({ error: 'D1 binding is not configured' }, 503);
      if (request.method === 'GET') {
        const row = await env.DB.prepare('SELECT payload, updated_at FROM progress WHERE profile_id = ?').bind(id).first<{ payload: string; updated_at: string }>();
        return json(row ? { progress: JSON.parse(row.payload), updatedAt: row.updated_at } : { progress: null });
      }
      if (request.method === 'PUT') {
        const payload = await request.json<ProgressPayload>();
        if (!Array.isArray(payload.completed) || typeof payload.xp !== 'number') return json({ error: 'Invalid progress payload' }, 400);
        const serialized = JSON.stringify(payload).slice(0, 200_000);
        await env.DB.prepare(`INSERT INTO progress(profile_id, payload, updated_at) VALUES(?, ?, datetime('now'))
          ON CONFLICT(profile_id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at`).bind(id, serialized).run();
        return json({ ok: true });
      }
      return json({ error: 'Method not allowed' }, 405);
    }

    if (url.pathname === '/api/settings') {
      const id = profileId(request);
      if (!env.SETTINGS) return json({ error: 'KV binding is not configured' }, 503);
      if (request.method === 'GET') return json({ settings: await env.SETTINGS.get(`settings:${id}`, 'json') });
      if (request.method === 'PUT') {
        const settings = await request.json<Record<string, unknown>>();
        await env.SETTINGS.put(`settings:${id}`, JSON.stringify(settings), { expirationTtl: 60 * 60 * 24 * 365 });
        return json({ ok: true });
      }
      return json({ error: 'Method not allowed' }, 405);
    }

    if (url.pathname === '/api/mentor' && request.method === 'POST') {
      const body = await request.json<{ question?: string; sql?: string }>();
      const question = (body.question || '').slice(0, 1500);
      const sql = (body.sql || '').slice(0, 5000);
      if (!env.AI) return json({ answer: localMentor(sql) });
      try {
        const response = await env.AI.run('@cf/meta/llama-3.2-3b-instruct', {
          messages: [
            { role: 'system', content: 'Ты SQL-наставник для 2nd Support Engineer. Отвечай по-русски, конкретно, безопасно и не придумывай данные. Анализируй SQLite SQL. Не запрашивай персональные данные. Дай: 1) диагноз, 2) исправление, 3) инженерное объяснение.' },
            { role: 'user', content: `Вопрос: ${question}\n\nSQL:\n${sql}` }
          ],
          max_tokens: 550,
          temperature: 0.25
        }) as { response?: string };
        return json({ answer: response.response || localMentor(sql) });
      } catch {
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
  return tips.length ? `Локальный разбор:\n• ${tips.join('\n• ')}` : 'Запрос выглядит структурно нормально. Проверь контрольные строки, обработку NULL и план выполнения.';
}
