type AttemptErrorKind =
  | 'syntax'
  | 'schema'
  | 'runtime'
  | 'result-shape'
  | 'row-set'
  | 'ordering'
  | 'values'
  | 'null-filter'
  | 'aggregation'
  | 'join-cardinality';

type AttemptDiagnosticPayload = {
  kind: AttemptErrorKind;
  title: string;
  explanation: string;
  nextStep: string;
  atlasId?: string;
};

type TaskStatsPayload = {
  attempts: number;
  incorrect: number;
  hintsUsed: number;
  solutionViews?: number;
  independentPasses?: number;
  lastIndependentAt?: string;
  errorKinds?: Partial<Record<AttemptErrorKind, number>>;
  lastDiagnostic?: AttemptDiagnosticPayload;
  lastAttemptAt?: string;
  completedAt?: string;
};

type ProgressPayload = {
  version: 4;
  completed: string[];
  taskStats: Record<string, TaskStatsPayload>;
  xp: number;
  streak: number;
  history: Array<{ day: string; solved: number }>;
  lastTask?: string;
  lastStudyDate?: string;
};

type MentorMode = 'next-step' | 'debug' | 'concept' | 'review';

type MentorPayload = {
  mode?: MentorMode;
  question?: string;
  sql?: string;
  task?: string;
  topic?: string;
  difficulty?: string;
  lastFeedback?: string;
  attempts?: number;
  hintsUsed?: number;
  allowSolution?: boolean;
};

const MAX_PROGRESS_BYTES = 200_000;
const MAX_SETTINGS_BYTES = 20_000;
const MAX_MENTOR_BYTES = 30_000;
const MENTOR_PROFILE_DAILY_LIMIT = 20;
const MENTOR_GLOBAL_DAILY_LIMIT = 100;
const PROFILE_PATTERN = /^[a-zA-Z0-9_-]{8,80}$/;
const TASK_ID_PATTERN = /^task-[0-9]{3}$/;
const MENTOR_MODES = new Set<MentorMode>(['next-step', 'debug', 'concept', 'review']);
const ATTEMPT_ERROR_KINDS = new Set<AttemptErrorKind>([
  'syntax',
  'schema',
  'runtime',
  'result-shape',
  'row-set',
  'ordering',
  'values',
  'null-filter',
  'aggregation',
  'join-cardinality'
]);

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

const boundedInteger = (value: unknown, max = 1_000_000) =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= max;

const boundedString = (value: unknown, max: number) =>
  typeof value === 'string' && value.length <= max;

const validAttemptDiagnostic = (value: unknown): value is AttemptDiagnosticPayload => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const diagnostic = value as Partial<AttemptDiagnosticPayload>;
  return ATTEMPT_ERROR_KINDS.has(diagnostic.kind as AttemptErrorKind)
    && boundedString(diagnostic.title, 160)
    && boundedString(diagnostic.explanation, 1_200)
    && boundedString(diagnostic.nextStep, 1_200)
    && (diagnostic.atlasId === undefined || boundedString(diagnostic.atlasId, 120));
};

const validErrorKinds = (value: unknown) => {
  if (value === undefined) return true;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.entries(value).every(([kind, count]) =>
    ATTEMPT_ERROR_KINDS.has(kind as AttemptErrorKind) && boundedInteger(count, 10_000));
};

const validTaskStats = (value: unknown): value is TaskStatsPayload => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const stats = value as Partial<TaskStatsPayload>;
  return boundedInteger(stats.attempts, 10_000)
    && boundedInteger(stats.incorrect, 10_000)
    && boundedInteger(stats.hintsUsed, 10_000)
    && (stats.solutionViews === undefined || boundedInteger(stats.solutionViews, 10_000))
    && (stats.independentPasses === undefined || boundedInteger(stats.independentPasses, 10_000))
    && (stats.lastIndependentAt === undefined || boundedString(stats.lastIndependentAt, 80))
    && validErrorKinds(stats.errorKinds)
    && (stats.lastDiagnostic === undefined || validAttemptDiagnostic(stats.lastDiagnostic))
    && (stats.lastAttemptAt === undefined || boundedString(stats.lastAttemptAt, 80))
    && (stats.completedAt === undefined || boundedString(stats.completedAt, 80));
};

const validProgress = (payload: unknown): payload is ProgressPayload => {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false;
  const value = payload as Partial<ProgressPayload>;
  if (value.version !== 4
    || !Array.isArray(value.completed)
    || !value.completed.every(item => typeof item === 'string' && TASK_ID_PATTERN.test(item))
    || !value.taskStats
    || typeof value.taskStats !== 'object'
    || Array.isArray(value.taskStats)
    || !boundedInteger(value.xp)
    || !boundedInteger(value.streak, 100_000)
    || !Array.isArray(value.history)
    || value.history.length > 31) return false;

  const validHistory = value.history.every(point => point
    && typeof point.day === 'string'
    && point.day.length <= 16
    && boundedInteger(point.solved, 10_000));
  const validStats = Object.entries(value.taskStats).every(([taskId, stats]) =>
    TASK_ID_PATTERN.test(taskId) && validTaskStats(stats));

  return validHistory
    && validStats
    && (value.lastTask === undefined || TASK_ID_PATTERN.test(value.lastTask))
    && (value.lastStudyDate === undefined || boundedString(value.lastStudyDate, 80));
};

const mentorFallback = (sql: string, mode: MentorMode, feedback: string) => {
  const normalized = sql.toLowerCase();
  const tips: string[] = [];
  if (!normalized.trim()) tips.push('Редактор пуст. Начни с формы результата и оператора SELECT.');
  if (normalized.includes('select *')) tips.push('Замени SELECT * явным списком столбцов.');
  if (/=\s*null\b/.test(normalized)) tips.push('Для NULL используй IS NULL или IS NOT NULL.');
  if (normalized.includes('join') && !/\bon\b/.test(normalized)) tips.push('Добавь условие ON, связывающее ключи таблиц.');
  if (normalized.includes('left join') && /count\s*\(\s*\*\s*\)/.test(normalized)) tips.push('После LEFT JOIN считай ключ правой таблицы, а не COUNT(*).');
  if (normalized.includes('group by') && !normalized.includes('order by')) tips.push('Для стабильного отчёта проверь необходимость ORDER BY.');
  if (normalized.includes(' like ') && normalized.includes("'%")) tips.push('LIKE с ведущим % обычно не использует обычный B-tree индекс.');
  if (feedback.startsWith('Ошибка SQLite:')) tips.unshift(feedback);

  if (mode === 'concept') return 'Разбей запрос на четыре вопроса: какие строки нужны, какие столбцы вернуть, нужна ли агрегация и каким должен быть порядок результата.';
  if (mode === 'review') return 'План повтора: 1) запиши ожидаемый результат словами; 2) проверь один оператор за раз; 3) запусти промежуточный SELECT; 4) добавь стабильную сортировку.';
  if (mode === 'next-step') return tips[0] || 'Сверь первый выбранный столбец и условие WHERE с формулировкой задачи, затем запусти запрос снова.';
  return tips.length ? `Локальная диагностика:\n• ${tips.join('\n• ')}` : 'Синтаксис выглядит правдоподобно. Проверь столбцы, число строк, обработку NULL и порядок результата.';
};

async function consumeMentorQuota(env: Cloudflare.Env, id: string) {
  if (!env.SETTINGS) return { allowed: true, remaining: null as number | null };
  const day = new Date().toISOString().slice(0, 10);
  const profileKey = `mentor:profile:${day}:${id}`;
  const globalKey = `mentor:global:${day}`;
  const [profileRaw, globalRaw] = await Promise.all([
    env.SETTINGS.get(profileKey),
    env.SETTINGS.get(globalKey)
  ]);
  const profileCount = Math.max(0, Number(profileRaw) || 0);
  const globalCount = Math.max(0, Number(globalRaw) || 0);
  if (profileCount >= MENTOR_PROFILE_DAILY_LIMIT || globalCount >= MENTOR_GLOBAL_DAILY_LIMIT) {
    return { allowed: false, remaining: 0 };
  }
  await Promise.all([
    env.SETTINGS.put(profileKey, String(profileCount + 1), { expirationTtl: 172_800 }),
    env.SETTINGS.put(globalKey, String(globalCount + 1), { expirationTtl: 172_800 })
  ]);
  return { allowed: true, remaining: MENTOR_PROFILE_DAILY_LIMIT - profileCount - 1 };
}

export default {
  async fetch(request: Request, env: Cloudflare.Env): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);

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
        return json({ ok: true, version: payload.version });
      }

      return json({ error: 'Method not allowed' }, 405, { allow: 'GET, PUT' });
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

    if (url.pathname === '/api/mentor' && request.method === 'POST') {
      const id = profileId(request);
      if (!id) return json({ error: 'A valid x-profile-id header is required' }, 400);
      if (bodyTooLarge(request, MAX_MENTOR_BYTES)) return json({ error: 'Mentor payload is too large' }, 413);
      const body = await request.json<MentorPayload>();
      const sql = typeof body.sql === 'string' ? body.sql.slice(0, 12_000) : '';
      const question = typeof body.question === 'string' ? body.question.slice(0, 2_000) : '';
      const task = typeof body.task === 'string' ? body.task.slice(0, 2_000) : '';
      const topic = typeof body.topic === 'string' ? body.topic.slice(0, 120) : '';
      const difficulty = typeof body.difficulty === 'string' ? body.difficulty.slice(0, 40) : '';
      const lastFeedback = typeof body.lastFeedback === 'string' ? body.lastFeedback.slice(0, 2_000) : '';
      const mode: MentorMode = MENTOR_MODES.has(body.mode as MentorMode) ? body.mode as MentorMode : 'next-step';
      const attempts = boundedInteger(body.attempts, 10_000) ? body.attempts : 0;
      const hintsUsed = boundedInteger(body.hintsUsed, 100) ? body.hintsUsed : 0;
      const quota = await consumeMentorQuota(env, id);
      if (!quota.allowed) return json({ error: 'Лимит AI Mentor на сегодня исчерпан.', remaining: 0 }, 429, { 'retry-after': '86400' });
      const fallback = mentorFallback(sql, mode, lastFeedback);
      if (!env.AI) return json({ answer: fallback, source: 'local', remaining: quota.remaining });
      try {
        const system = [
          'Ты AI SQL Mentor в учебной академии для 2nd Support Engineer.',
          'Отвечай по-русски, спокойно и конкретно.',
          'Не запрашивай и не повторяй имя, email, телефон, работодателя, адрес, токены или другие персональные данные.',
          'Если allowSolution=false, не давай готовый SQL-запрос целиком: дай следующий шаг, диагностику или концептуальное объяснение.',
          'Учитывай SQLite, учебный набор tickets, engineers и customers.',
          'Ответ должен быть до 160 слов.'
        ].join(' ');
        const prompt = [
          `Режим: ${mode}`,
          `Тема: ${topic}`,
          `Сложность: ${difficulty}`,
          `Задача: ${task}`,
          `Вопрос: ${question}`,
          `Попыток: ${attempts}; подсказок: ${hintsUsed}`,
          `Последняя обратная связь: ${lastFeedback}`,
          `Текущий SQL:\n${sql}`,
          `Можно показать полное решение: ${Boolean(body.allowSolution)}`
        ].join('\n\n');
        const aiResult = await env.AI.run('@cf/meta/llama-3.2-3b-instruct', {
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: prompt }
          ],
          max_tokens: 320,
          temperature: 0.25
        }) as { response?: string };
        const answer = String(aiResult?.response || '').trim();
        return json({ answer: answer || fallback, source: answer ? 'workers-ai' : 'local', remaining: quota.remaining });
      } catch {
        return json({ answer: fallback, source: 'local', remaining: quota.remaining });
      }
    }

    return json({ error: 'Not found' }, 404);
  }
} satisfies ExportedHandler<Cloudflare.Env>;
