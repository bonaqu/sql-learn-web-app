type AssessmentMode = 'quick' | 'interview' | 'exam';
type AssessmentStatus = 'completed' | 'expired' | 'abandoned';

type AssessmentReportPayload = {
  version: 1;
  id: string;
  userId: string;
  mode: AssessmentMode;
  status: AssessmentStatus;
  startedAt: string;
  completedAt: string;
  durationSeconds: number;
  score: number;
  accuracy: number;
  firstAttemptRate: number;
  independence: number;
  readinessDelta: number;
  strengths: string[];
  weaknesses: string[];
  localDebrief: string;
  aiDebrief?: string;
  taskScores: unknown[];
  moduleScores: unknown[];
};

const REPORT_ID_PATTERN = /^[a-f0-9-]{16,64}$/i;
const TASK_ID_PATTERN = /^task-[0-9]{3}$/;
const MODES = new Set<AssessmentMode>(['quick', 'interview', 'exam']);
const STATUSES = new Set<AssessmentStatus>(['completed', 'expired', 'abandoned']);
const MAX_REPORT_BYTES = 180_000;
const MAX_AI_BYTES = 24_000;
const DAILY_AI_LIMIT = 30;

const json = (data: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(data), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    ...headers
  }
});

async function readJson(request: Request) {
  try {
    return await request.json<unknown>();
  } catch {
    return null;
  }
}

function bodyTooLarge(request: Request, maximum: number) {
  const length = Number(request.headers.get('content-length') || 0);
  return Number.isFinite(length) && length > maximum;
}

function boundedInteger(value: unknown, maximum: number) {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= maximum;
}

function shortText(value: unknown, maximum: number) {
  return typeof value === 'string' && value.length <= maximum;
}

function stringList(value: unknown, maximumItems: number, maximumLength: number) {
  return Array.isArray(value)
    && value.length <= maximumItems
    && value.every(item => typeof item === 'string' && item.length <= maximumLength);
}

function validReport(value: unknown): value is AssessmentReportPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const report = value as Partial<AssessmentReportPayload>;
  return report.version === 1
    && typeof report.id === 'string'
    && REPORT_ID_PATTERN.test(report.id)
    && typeof report.userId === 'string'
    && report.userId.length >= 16
    && report.userId.length <= 80
    && MODES.has(report.mode as AssessmentMode)
    && STATUSES.has(report.status as AssessmentStatus)
    && shortText(report.startedAt, 64)
    && shortText(report.completedAt, 64)
    && boundedInteger(report.durationSeconds, 86_400)
    && boundedInteger(report.score, 100)
    && boundedInteger(report.accuracy, 100)
    && boundedInteger(report.firstAttemptRate, 100)
    && boundedInteger(report.independence, 100)
    && typeof report.readinessDelta === 'number'
    && Number.isInteger(report.readinessDelta)
    && report.readinessDelta >= -20
    && report.readinessDelta <= 20
    && stringList(report.strengths, 8, 120)
    && stringList(report.weaknesses, 8, 120)
    && shortText(report.localDebrief, 8_000)
    && (report.aiDebrief === undefined || shortText(report.aiDebrief, 8_000))
    && Array.isArray(report.taskScores)
    && report.taskScores.length <= 20
    && Array.isArray(report.moduleScores)
    && report.moduleScores.length <= 20;
}

async function consumeAiQuota(env: Cloudflare.Env, userId: string) {
  if (!env.SETTINGS) return { allowed: true, remaining: null as number | null };
  const day = new Date().toISOString().slice(0, 10);
  const key = `assessment:ai:${day}:${userId}`;
  const current = Math.max(0, Number(await env.SETTINGS.get(key)) || 0);
  if (current >= DAILY_AI_LIMIT) return { allowed: false, remaining: 0 };
  await env.SETTINGS.put(key, String(current + 1), { expirationTtl: 172_800 });
  return { allowed: true, remaining: DAILY_AI_LIMIT - current - 1 };
}

function interviewerFallback() {
  return 'Уточни контракт результата: что означает одна строка, какие столбцы обязательны, как обрабатывать NULL и нужен ли стабильный порядок. Готовый SQL и названия конкретных операторов я не подсказываю.';
}

function debriefFallback(report: AssessmentReportPayload) {
  const strengths = report.strengths.length ? report.strengths.join(', ') : 'стабильных сильных тем пока не выделено';
  const weaknesses = report.weaknesses.length ? report.weaknesses.join(', ') : 'повтори задачи с наибольшим числом попыток';
  return `Итог: ${report.score}/100, точность ${report.accuracy}%, самостоятельность ${report.independence}%.\nСильные стороны: ${strengths}.\nПриоритет развития: ${weaknesses}.\nСледующая сессия: реши две задачи из слабых модулей без подсказок, затем повтори одну задачу assessment с первой попытки.`;
}

async function listReports(env: Cloudflare.Env, userId: string) {
  const rows = await env.DB.prepare(`SELECT payload FROM assessment_reports
    WHERE user_id = ? ORDER BY completed_at DESC LIMIT 20`)
    .bind(userId)
    .all<{ payload: string }>();
  const reports = rows.results.flatMap(row => {
    try {
      const parsed = JSON.parse(row.payload) as AssessmentReportPayload;
      return validReport(parsed) ? [parsed] : [];
    } catch {
      return [];
    }
  });
  return json({ reports });
}

async function saveReport(request: Request, env: Cloudflare.Env, userId: string) {
  if (bodyTooLarge(request, MAX_REPORT_BYTES)) return json({ error: 'Assessment report is too large' }, 413);
  const body = await readJson(request);
  if (!validReport(body)) return json({ error: 'Invalid assessment report' }, 400);
  if (body.userId !== userId) return json({ error: 'Assessment owner mismatch' }, 403);
  const serialized = JSON.stringify(body);
  if (new TextEncoder().encode(serialized).byteLength > MAX_REPORT_BYTES) return json({ error: 'Assessment report is too large' }, 413);

  const existing = await env.DB.prepare('SELECT user_id FROM assessment_reports WHERE id = ?')
    .bind(body.id)
    .first<{ user_id: string }>();
  if (existing && existing.user_id !== userId) return json({ error: 'Assessment owner mismatch' }, 403);

  if (existing) {
    await env.DB.prepare(`UPDATE assessment_reports SET
        mode = ?, status = ?, started_at = ?, completed_at = ?, duration_seconds = ?, score = ?, payload = ?, updated_at = datetime('now')
      WHERE id = ? AND user_id = ?`)
      .bind(body.mode, body.status, body.startedAt, body.completedAt, body.durationSeconds, body.score, serialized, body.id, userId)
      .run();
  } else {
    await env.DB.prepare(`INSERT INTO assessment_reports(
        id, user_id, mode, status, started_at, completed_at, duration_seconds, score, payload
      ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(body.id, userId, body.mode, body.status, body.startedAt, body.completedAt, body.durationSeconds, body.score, serialized)
      .run();
  }
  return json({ ok: true });
}

async function interviewer(request: Request, env: Cloudflare.Env, userId: string) {
  if (bodyTooLarge(request, MAX_AI_BYTES)) return json({ error: 'Interviewer request is too large' }, 413);
  const body = await readJson(request) as Record<string, unknown> | null;
  if (!body
    || !shortText(body.sessionId, 80)
    || !shortText(body.taskId, 16)
    || !TASK_ID_PATTERN.test(String(body.taskId))
    || !shortText(body.title, 240)
    || !shortText(body.description, 2_000)
    || !shortText(body.topic, 160)
    || !shortText(body.sql, 8_000)
    || !shortText(body.question, 600)
    || !boundedInteger(body.attempts, 100)) return json({ error: 'Invalid interviewer request' }, 400);

  const fallback = interviewerFallback();
  const quota = await consumeAiQuota(env, userId);
  if (!quota.allowed) return json({ answer: fallback, fallback: true, reason: 'daily_limit' }, 429, { 'retry-after': '3600' });
  if (!env.AI) return json({ answer: fallback, fallback: true, reason: 'ai_binding_unavailable' });

  try {
    const response = await env.AI.run('@cf/qwen/qwen3-30b-a3b-fp8', {
      messages: [
        {
          role: 'system',
          content: 'Ты строгий SQL Interviewer. Отвечай по-русски. Можно только уточнять требования и задавать наводящие вопросы о форме результата. Никогда не выдавай готовый SQL, фрагменты решения, конкретный оператор или последовательность действий. Ответ — не более 90 слов.'
        },
        {
          role: 'user',
          content: `Задача: ${body.title}\nУсловие: ${body.description}\nТема: ${body.topic}\nТекущий SQL: ${body.sql}\nПопыток: ${body.attempts}\nВопрос кандидата: ${body.question}`
        }
      ],
      max_tokens: 220,
      temperature: 0.25
    }) as { response?: string };
    return json({ answer: response.response?.trim() || fallback, remaining: quota.remaining });
  } catch {
    return json({ answer: fallback, fallback: true, reason: 'ai_error' });
  }
}

async function debrief(request: Request, env: Cloudflare.Env, userId: string) {
  if (bodyTooLarge(request, MAX_REPORT_BYTES)) return json({ error: 'Debrief request is too large' }, 413);
  const body = await readJson(request);
  if (!validReport(body) || body.userId !== userId) return json({ error: 'Invalid assessment report' }, 400);
  const fallback = debriefFallback(body);
  const quota = await consumeAiQuota(env, userId);
  if (!quota.allowed) return json({ answer: fallback, fallback: true, reason: 'daily_limit' }, 429, { 'retry-after': '3600' });
  if (!env.AI) return json({ answer: fallback, fallback: true, reason: 'ai_binding_unavailable' });

  try {
    const compact = {
      mode: body.mode,
      score: body.score,
      accuracy: body.accuracy,
      firstAttemptRate: body.firstAttemptRate,
      independence: body.independence,
      readinessDelta: body.readinessDelta,
      strengths: body.strengths,
      weaknesses: body.weaknesses,
      taskScores: body.taskScores
    };
    const response = await env.AI.run('@cf/qwen/qwen3-30b-a3b-fp8', {
      messages: [
        {
          role: 'system',
          content: 'Ты проводишь профессиональный SQL debrief для 2nd Support Engineer. Отвечай по-русски. Дай: 1) объективный итог, 2) две сильные стороны, 3) две зоны риска, 4) конкретный план следующей 25-минутной сессии. Не выдавай готовые SQL-решения. До 260 слов.'
        },
        { role: 'user', content: JSON.stringify(compact) }
      ],
      max_tokens: 650,
      temperature: 0.3
    }) as { response?: string };
    return json({ answer: response.response?.trim() || fallback, remaining: quota.remaining });
  } catch {
    return json({ answer: fallback, fallback: true, reason: 'ai_error' });
  }
}

export async function handleAssessmentRequest(request: Request, env: Cloudflare.Env, userId: string): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith('/api/assessment')) return null;
  if (!env.DB) return json({ error: 'D1 binding is not configured' }, 503);

  if (url.pathname === '/api/assessment/reports') {
    if (request.method === 'GET') return listReports(env, userId);
    if (request.method === 'POST') return saveReport(request, env, userId);
    return json({ error: 'Method not allowed' }, 405, { allow: 'GET, POST' });
  }
  if (url.pathname === '/api/assessment/interviewer' && request.method === 'POST') return interviewer(request, env, userId);
  if (url.pathname === '/api/assessment/debrief' && request.method === 'POST') return debrief(request, env, userId);
  return json({ error: 'Not found' }, 404);
}
