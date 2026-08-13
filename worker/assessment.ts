type AssessmentMode = 'quick' | 'interview' | 'exam' | 'diagnostic' | 'production' | 'final';
type AssessmentStatus = 'completed' | 'expired' | 'abandoned';
type AbilityBand = 'low' | 'mid' | 'high';
type TelemetryExclusion = 'status' | 'not-attempted' | 'skipped' | 'interviewer' | 'technical-error' | null;

type AssessmentTaskScorePayload = {
  taskId: string;
  title: string;
  module: string;
  topic: string;
  correct: boolean;
  skipped: boolean;
  attempts: number;
  elapsedSeconds: number;
  interviewerUses: number;
  score: number;
  technicalErrors?: number;
  telemetryEligible?: boolean;
  telemetryExclusionReason?: TelemetryExclusion;
  abilityBand?: AbilityBand;
  itemVersion?: string;
  reasoningSkill?: string;
  errorClass?: string;
  expectedSeconds?: number;
};

type AssessmentMeasurementPayload = {
  version: 1;
  blueprintVersion: string;
  thresholdVersion: string;
  formId: string;
  eligibleItems: number;
  excludedItems: number;
  calibratedItems: number;
  accuracyInterval: { low: number; high: number; confidence: 90 };
  scoreBand: { low: number; high: number };
  reliability: 'limited' | 'emerging' | 'supported';
  explanation: string[];
};

type AdaptiveDiagnosticDecisionPayload = {
  version: 'adaptive-diagnostic-v1';
  completedCount: 3 | 5 | 7;
  correctCount: number;
  plannedCount: 3 | 5 | 7;
  shouldStop: boolean;
  stopReason: string;
  level: 'foundation' | 'developing' | 'working' | 'advanced';
  scoreBand: { low: number; high: number };
  confidenceLabel: string;
  explanation: string;
};

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
  grade?: 'strong' | 'ready' | 'developing' | 'foundation';
  accuracy: number;
  firstAttemptRate: number;
  independence: number;
  readinessDelta: number;
  strengths: string[];
  weaknesses: string[];
  localDebrief: string;
  aiDebrief?: string;
  taskScores: AssessmentTaskScorePayload[];
  moduleScores: unknown[];
  baselineReadiness?: number;
  formId?: string;
  blueprintVersion?: string;
  thresholdVersion?: string;
  measurement?: AssessmentMeasurementPayload;
  adaptiveDecision?: AdaptiveDiagnosticDecisionPayload;
};

const REPORT_ID_PATTERN = /^[a-f0-9-]{16,64}$/i;
const TASK_ID_PATTERN = /^task-[0-9]{3}$/;
const MODES = new Set<AssessmentMode>(['quick', 'interview', 'exam', 'diagnostic', 'production', 'final']);
const STATUSES = new Set<AssessmentStatus>(['completed', 'expired', 'abandoned']);
const ABILITY_BANDS = new Set<AbilityBand>(['low', 'mid', 'high']);
const EXCLUSIONS = new Set<Exclude<TelemetryExclusion, null>>(['status', 'not-attempted', 'skipped', 'interviewer', 'technical-error']);
const ADAPTIVE_STOP_REASONS = new Set(['minimum-probe-incomplete', 'foundation-observed', 'bridge-needed', 'challenge-needed', 'maximum-evidence-reached']);
const CURRENT_BLUEPRINT_VERSION = 'assessment-blueprint-v3';
const MAX_REPORT_BYTES = 220_000;
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
  try { return await request.json<unknown>(); } catch { return null; }
}

function bodyTooLarge(request: Request, maximum: number) {
  const length = Number(request.headers.get('content-length') || 0);
  return Number.isFinite(length) && length > maximum;
}

function boundedInteger(value: unknown, maximum: number) {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= maximum;
}

function shortText(value: unknown, maximum: number, minimum = 0) {
  return typeof value === 'string' && value.length >= minimum && value.length <= maximum;
}

function stringList(value: unknown, maximumItems: number, maximumLength: number) {
  return Array.isArray(value)
    && value.length <= maximumItems
    && value.every(item => typeof item === 'string' && item.length <= maximumLength);
}

function validTaskScore(value: unknown): value is AssessmentTaskScorePayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Partial<AssessmentTaskScorePayload>;
  return shortText(item.taskId, 16, 8)
    && TASK_ID_PATTERN.test(String(item.taskId))
    && shortText(item.title, 240)
    && shortText(item.module, 80, 1)
    && shortText(item.topic, 160)
    && typeof item.correct === 'boolean'
    && typeof item.skipped === 'boolean'
    && boundedInteger(item.attempts, 100)
    && boundedInteger(item.elapsedSeconds, 86_400)
    && boundedInteger(item.interviewerUses, 20)
    && boundedInteger(item.score, 100)
    && (item.technicalErrors === undefined || boundedInteger(item.technicalErrors, 100))
    && (item.telemetryEligible === undefined || typeof item.telemetryEligible === 'boolean')
    && (item.telemetryExclusionReason === undefined
      || item.telemetryExclusionReason === null
      || EXCLUSIONS.has(item.telemetryExclusionReason as Exclude<TelemetryExclusion, null>))
    && (item.abilityBand === undefined || ABILITY_BANDS.has(item.abilityBand as AbilityBand))
    && (item.itemVersion === undefined || shortText(item.itemVersion, 80, 8))
    && (item.reasoningSkill === undefined || shortText(item.reasoningSkill, 80, 1))
    && (item.errorClass === undefined || shortText(item.errorClass, 80, 1))
    && (item.expectedSeconds === undefined || boundedInteger(item.expectedSeconds, 86_400));
}

function validMeasurement(value: unknown): value is AssessmentMeasurementPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const measurement = value as Partial<AssessmentMeasurementPayload>;
  const interval = measurement.accuracyInterval as AssessmentMeasurementPayload['accuracyInterval'] | undefined;
  const band = measurement.scoreBand as AssessmentMeasurementPayload['scoreBand'] | undefined;
  return measurement.version === 1
    && shortText(measurement.blueprintVersion, 80, 8)
    && shortText(measurement.thresholdVersion, 80, 8)
    && shortText(measurement.formId, 120, 8)
    && boundedInteger(measurement.eligibleItems, 40)
    && boundedInteger(measurement.excludedItems, 40)
    && boundedInteger(measurement.calibratedItems, 40)
    && Boolean(interval)
    && boundedInteger(interval?.low, 100)
    && boundedInteger(interval?.high, 100)
    && interval!.low <= interval!.high
    && interval?.confidence === 90
    && Boolean(band)
    && boundedInteger(band?.low, 100)
    && boundedInteger(band?.high, 100)
    && band!.low <= band!.high
    && ['limited', 'emerging', 'supported'].includes(String(measurement.reliability))
    && stringList(measurement.explanation, 8, 400);
}

function validAdaptiveDecision(value: unknown): value is AdaptiveDiagnosticDecisionPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const decision = value as Partial<AdaptiveDiagnosticDecisionPayload>;
  const band = decision.scoreBand as AdaptiveDiagnosticDecisionPayload['scoreBand'] | undefined;
  return decision.version === 'adaptive-diagnostic-v1'
    && [3, 5, 7].includes(Number(decision.completedCount))
    && boundedInteger(decision.correctCount, Number(decision.completedCount))
    && [3, 5, 7].includes(Number(decision.plannedCount))
    && typeof decision.shouldStop === 'boolean'
    && typeof decision.stopReason === 'string'
    && ADAPTIVE_STOP_REASONS.has(decision.stopReason)
    && ['foundation', 'developing', 'working', 'advanced'].includes(String(decision.level))
    && Boolean(band)
    && boundedInteger(band?.low, 100)
    && boundedInteger(band?.high, 100)
    && band!.low <= band!.high
    && shortText(decision.confidenceLabel, 160, 8)
    && shortText(decision.explanation, 600, 24);
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
    && shortText(report.startedAt, 64, 8)
    && shortText(report.completedAt, 64, 8)
    && boundedInteger(report.durationSeconds, 86_400)
    && boundedInteger(report.score, 100)
    && (report.grade === undefined || ['strong', 'ready', 'developing', 'foundation'].includes(report.grade))
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
    && report.taskScores.length <= 40
    && report.taskScores.every(validTaskScore)
    && Array.isArray(report.moduleScores)
    && report.moduleScores.length <= 40
    && (report.baselineReadiness === undefined || boundedInteger(report.baselineReadiness, 100))
    && (report.formId === undefined || shortText(report.formId, 120, 8))
    && (report.blueprintVersion === undefined || shortText(report.blueprintVersion, 80, 8))
    && (report.thresholdVersion === undefined || shortText(report.thresholdVersion, 80, 8))
    && (report.measurement === undefined || validMeasurement(report.measurement))
    && (report.adaptiveDecision === undefined || report.mode === 'diagnostic' && validAdaptiveDecision(report.adaptiveDecision));
}

function immutableReport(report: AssessmentReportPayload) {
  const { aiDebrief: _aiDebrief, ...immutable } = report;
  return JSON.stringify(immutable);
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
  const band = report.measurement ? `${report.measurement.scoreBand.low}–${report.measurement.scoreBand.high}` : `${report.score}`;
  return `Итог: наблюдаемый score ${report.score}/100, измерительный диапазон ${band}; точность ${report.accuracy}%, самостоятельность ${report.independence}%.\nСильные стороны: ${strengths}.\nПриоритет развития: ${weaknesses}.\nСледующая сессия: реши две задачи из слабых модулей без подсказок, затем повтори одну задачу assessment с первой попытки.`;
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
    } catch { return []; }
  });
  return json({ reports });
}

function contribution(item: AssessmentTaskScorePayload, report: AssessmentReportPayload) {
  const technicalErrors = Math.max(0, item.technicalErrors || 0);
  const eligible = report.status === 'completed'
    && item.telemetryEligible === true
    && item.telemetryExclusionReason == null
    && item.attempts > 0
    && !item.skipped
    && item.interviewerUses === 0
    && technicalErrors === 0;
  const band = item.abilityBand;
  return {
    eligible: eligible ? 1 : 0,
    correct: eligible && item.correct ? 1 : 0,
    firstAttemptCorrect: eligible && item.correct && item.attempts === 1 ? 1 : 0,
    duration: eligible ? Math.min(86_400, item.elapsedSeconds) : 0,
    independence: eligible ? Math.min(100, report.independence) : 0,
    lowAttempts: eligible && band === 'low' ? 1 : 0,
    lowCorrect: eligible && band === 'low' && item.correct ? 1 : 0,
    highAttempts: eligible && band === 'high' ? 1 : 0,
    highCorrect: eligible && band === 'high' && item.correct ? 1 : 0,
    technicalErrors: technicalErrors > 0 ? 1 : 0
  };
}

async function contributeCalibration(env: Cloudflare.Env, report: AssessmentReportPayload) {
  const blueprintVersion = report.blueprintVersion || 'assessment-blueprint-v1';
  const receipt = await env.DB.prepare(`INSERT OR IGNORE INTO assessment_calibration_receipts(
      report_id, user_id, blueprint_version
    ) VALUES(?, ?, ?)`)
    .bind(report.id, report.userId, blueprintVersion)
    .run();
  if (Number(receipt.meta.changes || 0) === 0) return false;

  const statements = report.taskScores.map(item => {
    const value = contribution(item, report);
    return env.DB.prepare(`INSERT INTO assessment_item_aggregates(
        task_id, blueprint_version, eligible_attempts, correct_count, first_attempt_correct,
        duration_seconds_sum, independence_sum, low_attempts, low_correct, high_attempts,
        high_correct, technical_error_attempts, updated_at
      ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(task_id, blueprint_version) DO UPDATE SET
        eligible_attempts = eligible_attempts + excluded.eligible_attempts,
        correct_count = correct_count + excluded.correct_count,
        first_attempt_correct = first_attempt_correct + excluded.first_attempt_correct,
        duration_seconds_sum = duration_seconds_sum + excluded.duration_seconds_sum,
        independence_sum = independence_sum + excluded.independence_sum,
        low_attempts = low_attempts + excluded.low_attempts,
        low_correct = low_correct + excluded.low_correct,
        high_attempts = high_attempts + excluded.high_attempts,
        high_correct = high_correct + excluded.high_correct,
        technical_error_attempts = technical_error_attempts + excluded.technical_error_attempts,
        updated_at = datetime('now')`)
      .bind(
        item.taskId,
        blueprintVersion,
        value.eligible,
        value.correct,
        value.firstAttemptCorrect,
        value.duration,
        value.independence,
        value.lowAttempts,
        value.lowCorrect,
        value.highAttempts,
        value.highCorrect,
        value.technicalErrors
      );
  });
  if (statements.length) await env.DB.batch(statements);
  return true;
}

async function saveReport(request: Request, env: Cloudflare.Env, userId: string) {
  if (bodyTooLarge(request, MAX_REPORT_BYTES)) return json({ error: 'Assessment report is too large' }, 413);
  const body = await readJson(request);
  if (!validReport(body)) return json({ error: 'Invalid assessment report' }, 400);
  if (body.userId !== userId) return json({ error: 'Assessment owner mismatch' }, 403);
  const serialized = JSON.stringify(body);
  if (new TextEncoder().encode(serialized).byteLength > MAX_REPORT_BYTES) return json({ error: 'Assessment report is too large' }, 413);

  const existing = await env.DB.prepare('SELECT user_id, payload FROM assessment_reports WHERE id = ?')
    .bind(body.id)
    .first<{ user_id: string; payload: string }>();
  if (existing && existing.user_id !== userId) return json({ error: 'Assessment owner mismatch' }, 403);

  if (existing) {
    let previous: AssessmentReportPayload;
    try { previous = JSON.parse(existing.payload) as AssessmentReportPayload; } catch { return json({ error: 'Stored assessment report is invalid' }, 500); }
    if (!validReport(previous) || immutableReport(previous) !== immutableReport(body)) {
      return json({ error: 'Assessment report is immutable' }, 409);
    }
    if (serialized !== existing.payload) {
      await env.DB.prepare(`UPDATE assessment_reports SET payload = ?, updated_at = datetime('now')
        WHERE id = ? AND user_id = ?`)
        .bind(serialized, body.id, userId)
        .run();
    }
    return json({ ok: true, idempotent: serialized === existing.payload, telemetryContributed: false });
  }

  await env.DB.prepare(`INSERT INTO assessment_reports(
      id, user_id, mode, status, started_at, completed_at, duration_seconds, score, payload
    ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(body.id, userId, body.mode, body.status, body.startedAt, body.completedAt, body.durationSeconds, body.score, serialized)
    .run();
  const telemetryContributed = await contributeCalibration(env, body);
  return json({ ok: true, idempotent: false, telemetryContributed });
}

async function calibration(env: Cloudflare.Env, request: Request) {
  const url = new URL(request.url);
  const requested = url.searchParams.get('version') || CURRENT_BLUEPRINT_VERSION;
  if (!shortText(requested, 80, 8)) return json({ error: 'Invalid blueprint version' }, 400);
  const rows = await env.DB.prepare(`SELECT
      task_id, blueprint_version, eligible_attempts, correct_count, first_attempt_correct,
      duration_seconds_sum, independence_sum, low_attempts, low_correct, high_attempts,
      high_correct, technical_error_attempts, updated_at
    FROM assessment_item_aggregates
    WHERE blueprint_version = ?
    ORDER BY eligible_attempts DESC, task_id`)
    .bind(requested)
    .all<{
      task_id: string;
      blueprint_version: string;
      eligible_attempts: number;
      correct_count: number;
      first_attempt_correct: number;
      duration_seconds_sum: number;
      independence_sum: number;
      low_attempts: number;
      low_correct: number;
      high_attempts: number;
      high_correct: number;
      technical_error_attempts: number;
      updated_at: string;
    }>();
  return json({
    generatedAt: new Date().toISOString(),
    blueprintVersion: requested,
    aggregates: rows.results.map(row => ({
      taskId: row.task_id,
      blueprintVersion: row.blueprint_version,
      eligibleAttempts: row.eligible_attempts,
      correctCount: row.correct_count,
      firstAttemptCorrect: row.first_attempt_correct,
      durationSecondsSum: row.duration_seconds_sum,
      independenceSum: row.independence_sum,
      lowAttempts: row.low_attempts,
      lowCorrect: row.low_correct,
      highAttempts: row.high_attempts,
      highCorrect: row.high_correct,
      technicalErrorAttempts: row.technical_error_attempts,
      updatedAt: row.updated_at
    }))
  });
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
        { role: 'system', content: 'Ты строгий SQL Interviewer. Отвечай по-русски. Можно только уточнять требования и задавать наводящие вопросы о форме результата. Никогда не выдавай готовый SQL, фрагменты решения, конкретный оператор или последовательность действий. Ответ — не более 90 слов.' },
        { role: 'user', content: `Задача: ${body.title}\nУсловие: ${body.description}\nТема: ${body.topic}\nТекущий SQL: ${body.sql}\nПопыток: ${body.attempts}\nВопрос кандидата: ${body.question}` }
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
      scoreBand: body.measurement?.scoreBand,
      reliability: body.measurement?.reliability,
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
        { role: 'system', content: 'Ты проводишь профессиональный SQL debrief для 2nd Support Engineer. Отвечай по-русски. Не изображай ложную статистическую точность: упомяни measurement band и reliability. Дай: 1) объективный итог, 2) две сильные стороны, 3) две зоны риска, 4) конкретный план следующей 25-минутной сессии. Не выдавай готовые SQL-решения. До 260 слов.' },
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
  if (url.pathname === '/api/assessment/calibration') {
    if (request.method === 'GET') return calibration(env, request);
    return json({ error: 'Method not allowed' }, 405, { allow: 'GET' });
  }
  if (url.pathname === '/api/assessment/interviewer' && request.method === 'POST') return interviewer(request, env, userId);
  if (url.pathname === '/api/assessment/debrief' && request.method === 'POST') return debrief(request, env, userId);
  return json({ error: 'Not found' }, 404);
}
