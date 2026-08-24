type AssessmentStatus = 'completed' | 'expired' | 'abandoned';
type AbilityBand = 'low' | 'mid' | 'high';
type TelemetryExclusion = 'status' | 'not-attempted' | 'skipped' | 'interviewer' | 'technical-error' | null;

type AssessmentTaskScoreV2 = {
  taskId: string;
  title: string;
  module: string;
  topic: string;
  correct: boolean;
  skipped: boolean;
  attempts: number;
  elapsedSeconds: number;
  interviewerUses: number;
  hintsUsed: number;
  solutionViews: number;
  explanationRubric: {
    deterministicSqlPassed: boolean;
    explanationSubmitted: boolean;
    alternativeSubmitted: boolean;
    edgeCasesSubmitted: boolean;
    complete: boolean;
    reviewStatus: 'not-required' | 'missing' | 'awaiting-human-review';
    proseScore: null;
    authority: 'deterministic-sql-plus-human-prose-review';
  };
  score: number;
  technicalErrors: number;
  telemetryEligible: boolean;
  telemetryExclusionReason: TelemetryExclusion;
  abilityBand: AbilityBand;
  itemVersion: string;
  reasoningSkill: string;
  errorClass: string;
  expectedSeconds: number;
};

type AssessmentModuleScoreV2 = {
  module: string;
  title: string;
  score: number;
  correct: number;
  total: number;
};

type AssessmentMeasurementV2 = {
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

type AssessmentReportV2 = {
  version: 1;
  id: string;
  userId: string;
  mode: 'quick' | 'interview' | 'exam' | 'diagnostic' | 'production' | 'final';
  status: AssessmentStatus;
  startedAt: string;
  completedAt: string;
  durationSeconds: number;
  score: number;
  grade: 'strong' | 'ready' | 'developing' | 'foundation';
  accuracy: number;
  firstAttemptRate: number;
  independence: number;
  assistance: {
    interviewerUses: number;
    hintsUsed: number;
    solutionViews: number;
    independent: boolean;
  };
  explanationRubric?: {
    completed: number;
    total: number;
    awaitingHumanReview: number;
    authority: 'deterministic-sql-plus-human-prose-review';
  };
  readinessDelta: number;
  taskScores: AssessmentTaskScoreV2[];
  moduleScores: AssessmentModuleScoreV2[];
  strengths: string[];
  weaknesses: string[];
  localDebrief: string;
  aiDebrief?: string;
  baselineReadiness: number;
  formId: string;
  blueprintVersion: string;
  thresholdVersion: string;
  measurement: AssessmentMeasurementV2;
};

const CURRENT_BLUEPRINT_VERSION = 'assessment-blueprint-v4';
const CURRENT_THRESHOLD_VERSION = 'assessment-thresholds-v2';
const REPORT_ID_PATTERN = /^[a-f0-9-]{16,64}$/i;
const TASK_ID_PATTERN = /^task-[0-9]{3}$/;
const MODES = new Set(['quick', 'interview', 'exam', 'diagnostic', 'production', 'final']);
const STATUSES = new Set<AssessmentStatus>(['completed', 'expired', 'abandoned']);
const ABILITY_BANDS = new Set<AbilityBand>(['low', 'mid', 'high']);
const EXCLUSIONS = new Set<Exclude<TelemetryExclusion, null>>(['status', 'not-attempted', 'skipped', 'interviewer', 'technical-error']);
const MAX_REPORT_BYTES = 220_000;

const json = (data: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(data), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    ...headers
  }
});

function bodyTooLarge(request: Request) {
  const length = Number(request.headers.get('content-length') || 0);
  return Number.isFinite(length) && length > MAX_REPORT_BYTES;
}

function objectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []) {
  const allowed = new Set([...required, ...optional]);
  return required.every(key => Object.hasOwn(value, key))
    && Object.keys(value).every(key => allowed.has(key));
}

function boundedInteger(value: unknown, maximum: number, minimum = 0) {
  return typeof value === 'number' && Number.isInteger(value) && value >= minimum && value <= maximum;
}

function shortText(value: unknown, maximum: number, minimum = 0) {
  return typeof value === 'string' && value.length >= minimum && value.length <= maximum;
}

function stringList(value: unknown, maximumItems: number, maximumLength: number) {
  return Array.isArray(value)
    && value.length <= maximumItems
    && value.every(item => typeof item === 'string' && item.length <= maximumLength);
}

function abilityBand(readiness: number): AbilityBand {
  if (readiness >= 72) return 'high';
  if (readiness >= 45) return 'mid';
  return 'low';
}

function expectedExclusion(status: AssessmentStatus, item: AssessmentTaskScoreV2): TelemetryExclusion {
  if (status !== 'completed') return 'status';
  if (item.attempts <= 0) return 'not-attempted';
  if (item.skipped) return 'skipped';
  if (item.interviewerUses > 0) return 'interviewer';
  if (item.technicalErrors > 0) return 'technical-error';
  return null;
}

function validTaskScore(value: unknown, status: AssessmentStatus, baselineReadiness: number): value is AssessmentTaskScoreV2 {
  if (!objectRecord(value) || !exactKeys(value, [
    'taskId', 'title', 'module', 'topic', 'correct', 'skipped', 'attempts', 'elapsedSeconds',
    'interviewerUses', 'hintsUsed', 'solutionViews', 'explanationRubric', 'score', 'technicalErrors', 'telemetryEligible', 'telemetryExclusionReason',
    'abilityBand', 'itemVersion', 'reasoningSkill', 'errorClass', 'expectedSeconds'
  ])) return false;
  const item = value as AssessmentTaskScoreV2;
  if (!objectRecord(item.explanationRubric)
    || !exactKeys(item.explanationRubric, ['deterministicSqlPassed', 'explanationSubmitted', 'alternativeSubmitted', 'edgeCasesSubmitted', 'complete', 'reviewStatus', 'proseScore', 'authority'])
    || typeof item.explanationRubric.deterministicSqlPassed !== 'boolean'
    || typeof item.explanationRubric.explanationSubmitted !== 'boolean'
    || typeof item.explanationRubric.alternativeSubmitted !== 'boolean'
    || typeof item.explanationRubric.edgeCasesSubmitted !== 'boolean'
    || typeof item.explanationRubric.complete !== 'boolean'
    || !['not-required', 'missing', 'awaiting-human-review'].includes(item.explanationRubric.reviewStatus)
    || item.explanationRubric.proseScore !== null
    || item.explanationRubric.authority !== 'deterministic-sql-plus-human-prose-review'
    || !shortText(item.taskId, 16, 8)
    || !TASK_ID_PATTERN.test(item.taskId)
    || !shortText(item.title, 240, 1)
    || !shortText(item.module, 80, 1)
    || !shortText(item.topic, 160, 1)
    || typeof item.correct !== 'boolean'
    || typeof item.skipped !== 'boolean'
    || (item.correct && item.skipped)
    || !boundedInteger(item.attempts, 100)
    || !boundedInteger(item.elapsedSeconds, 86_400)
    || !boundedInteger(item.interviewerUses, 20)
    || !boundedInteger(item.hintsUsed, 20)
    || !boundedInteger(item.solutionViews, 20)
    || !boundedInteger(item.score, 100)
    || !boundedInteger(item.technicalErrors, 100)
    || typeof item.telemetryEligible !== 'boolean'
    || !(item.telemetryExclusionReason === null || EXCLUSIONS.has(item.telemetryExclusionReason as Exclude<TelemetryExclusion, null>))
    || !ABILITY_BANDS.has(item.abilityBand)
    || item.abilityBand !== abilityBand(baselineReadiness)
    || item.itemVersion !== CURRENT_BLUEPRINT_VERSION
    || !shortText(item.reasoningSkill, 80, 1)
    || !shortText(item.errorClass, 80, 1)
    || !boundedInteger(item.expectedSeconds, 86_400, 1)) return false;
  const exclusion = expectedExclusion(status, item);
  return item.telemetryExclusionReason === exclusion
    && item.telemetryEligible === (exclusion === null);
}

function validModuleScore(value: unknown): value is AssessmentModuleScoreV2 {
  if (!objectRecord(value) || !exactKeys(value, ['module', 'title', 'score', 'correct', 'total'])) return false;
  const item = value as AssessmentModuleScoreV2;
  return shortText(item.module, 80, 1)
    && shortText(item.title, 160, 1)
    && boundedInteger(item.score, 100)
    && boundedInteger(item.correct, 40)
    && boundedInteger(item.total, 40, 1)
    && item.correct <= item.total;
}

function validMeasurement(value: unknown, report: Pick<AssessmentReportV2, 'formId' | 'blueprintVersion' | 'thresholdVersion' | 'taskScores'>) {
  if (!objectRecord(value) || !exactKeys(value, [
    'version', 'blueprintVersion', 'thresholdVersion', 'formId', 'eligibleItems', 'excludedItems',
    'calibratedItems', 'accuracyInterval', 'scoreBand', 'reliability', 'explanation'
  ])) return false;
  const measurement = value as AssessmentMeasurementV2;
  if (!objectRecord(measurement.accuracyInterval)
    || !exactKeys(measurement.accuracyInterval, ['low', 'high', 'confidence'])
    || !objectRecord(measurement.scoreBand)
    || !exactKeys(measurement.scoreBand, ['low', 'high'])) return false;
  return measurement.version === 1
    && measurement.blueprintVersion === report.blueprintVersion
    && measurement.thresholdVersion === report.thresholdVersion
    && measurement.formId === report.formId
    && boundedInteger(measurement.eligibleItems, 40)
    && boundedInteger(measurement.excludedItems, 40)
    && measurement.eligibleItems + measurement.excludedItems === report.taskScores.length
    && boundedInteger(measurement.calibratedItems, measurement.eligibleItems)
    && boundedInteger(measurement.accuracyInterval.low, 100)
    && boundedInteger(measurement.accuracyInterval.high, 100)
    && measurement.accuracyInterval.low <= measurement.accuracyInterval.high
    && measurement.accuracyInterval.confidence === 90
    && boundedInteger(measurement.scoreBand.low, 100)
    && boundedInteger(measurement.scoreBand.high, 100)
    && measurement.scoreBand.low <= measurement.scoreBand.high
    && ['limited', 'emerging', 'supported'].includes(measurement.reliability)
    && stringList(measurement.explanation, 8, 400);
}

function containsForbiddenEvidenceKey(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsForbiddenEvidenceKey);
  if (!objectRecord(value)) return false;
  for (const [key, nested] of Object.entries(value)) {
    if (['sql', 'submissionSql', 'solution', 'sourceSql', 'queryText'].includes(key)) return true;
    if (containsForbiddenEvidenceKey(nested)) return true;
  }
  return false;
}

function validReportV2(value: unknown): value is AssessmentReportV2 {
  if (!objectRecord(value) || !exactKeys(value, [
    'version', 'id', 'userId', 'mode', 'status', 'startedAt', 'completedAt', 'durationSeconds',
    'score', 'grade', 'accuracy', 'firstAttemptRate', 'independence', 'assistance', 'readinessDelta', 'taskScores',
    'moduleScores', 'strengths', 'weaknesses', 'localDebrief', 'baselineReadiness', 'formId',
    'blueprintVersion', 'thresholdVersion', 'measurement'
  ], ['aiDebrief', 'explanationRubric'])) return false;
  if (containsForbiddenEvidenceKey(value)) return false;
  const report = value as AssessmentReportV2;
  if (!objectRecord(report.assistance)
    || !exactKeys(report.assistance, ['interviewerUses', 'hintsUsed', 'solutionViews', 'independent'])
    || !boundedInteger(report.assistance.interviewerUses, 800)
    || !boundedInteger(report.assistance.hintsUsed, 800)
    || !boundedInteger(report.assistance.solutionViews, 800)
    || typeof report.assistance.independent !== 'boolean'
    || (report.explanationRubric !== undefined && (!objectRecord(report.explanationRubric)
      || !exactKeys(report.explanationRubric, ['completed', 'total', 'awaitingHumanReview', 'authority'])
      || !boundedInteger(report.explanationRubric.completed, 40)
      || !boundedInteger(report.explanationRubric.total, 40)
      || !boundedInteger(report.explanationRubric.awaitingHumanReview, 40)
      || report.explanationRubric.completed > report.explanationRubric.total
      || report.explanationRubric.awaitingHumanReview > report.explanationRubric.total
      || report.explanationRubric.authority !== 'deterministic-sql-plus-human-prose-review'))
    || report.version !== 1
    || !REPORT_ID_PATTERN.test(report.id)
    || !shortText(report.userId, 80, 16)
    || !MODES.has(report.mode)
    || !STATUSES.has(report.status)
    || !shortText(report.startedAt, 64, 8)
    || !shortText(report.completedAt, 64, 8)
    || !Number.isFinite(Date.parse(report.startedAt))
    || !Number.isFinite(Date.parse(report.completedAt))
    || Date.parse(report.completedAt) < Date.parse(report.startedAt)
    || !boundedInteger(report.durationSeconds, 86_400, 1)
    || !boundedInteger(report.score, 100)
    || !['strong', 'ready', 'developing', 'foundation'].includes(report.grade)
    || !boundedInteger(report.accuracy, 100)
    || !boundedInteger(report.firstAttemptRate, 100)
    || !boundedInteger(report.independence, 100)
    || !boundedInteger(report.readinessDelta, 20, -20)
    || !Array.isArray(report.taskScores)
    || report.taskScores.length < 1
    || report.taskScores.length > 40
    || !boundedInteger(report.baselineReadiness, 100)
    || !shortText(report.formId, 160, 8)
    || report.blueprintVersion !== CURRENT_BLUEPRINT_VERSION
    || report.thresholdVersion !== CURRENT_THRESHOLD_VERSION
    || !stringList(report.strengths, 8, 120)
    || !stringList(report.weaknesses, 8, 120)
    || !shortText(report.localDebrief, 8_000, 1)
    || (report.aiDebrief !== undefined && !shortText(report.aiDebrief, 8_000, 1))
    || !Array.isArray(report.moduleScores)
    || report.moduleScores.length > 40
    || !report.moduleScores.every(validModuleScore)) return false;
  const taskIds = new Set<string>();
  for (const task of report.taskScores) {
    if (!validTaskScore(task, report.status, report.baselineReadiness) || taskIds.has(task.taskId)) return false;
    taskIds.add(task.taskId);
  }
  const correct = report.taskScores.filter(item => item.correct).length;
  const firstAttempt = report.taskScores.filter(item => item.correct && item.attempts === 1).length;
  const expectedAccuracy = Math.round(correct / report.taskScores.length * 100);
  const expectedFirstAttemptRate = Math.round(firstAttempt / Math.max(1, correct) * 100);
  const expectedIndependence = Math.round(report.taskScores.reduce(
    (sum, item) => sum + Math.max(0, 100 - item.interviewerUses * 30 - item.hintsUsed * 40 - item.solutionViews * 100), 0
  ) / report.taskScores.length);
  const expectedAssistance = {
    interviewerUses: report.taskScores.reduce((sum, item) => sum + item.interviewerUses, 0),
    hintsUsed: report.taskScores.reduce((sum, item) => sum + item.hintsUsed, 0),
    solutionViews: report.taskScores.reduce((sum, item) => sum + item.solutionViews, 0)
  };
  if (report.accuracy !== expectedAccuracy
    || report.firstAttemptRate !== expectedFirstAttemptRate
    || report.independence !== expectedIndependence
    || report.assistance.interviewerUses !== expectedAssistance.interviewerUses
    || report.assistance.hintsUsed !== expectedAssistance.hintsUsed
    || report.assistance.solutionViews !== expectedAssistance.solutionViews
    || report.assistance.independent !== (expectedAssistance.interviewerUses === 0 && expectedAssistance.hintsUsed === 0 && expectedAssistance.solutionViews === 0)) return false;
  return validMeasurement(report.measurement, report);
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (!objectRecord(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalValue(value[key])]));
}

function immutableReport(report: AssessmentReportV2) {
  const { aiDebrief: _aiDebrief, ...immutable } = report;
  return JSON.stringify(canonicalValue(immutable));
}

function contribution(item: AssessmentTaskScoreV2, report: AssessmentReportV2) {
  const eligible = item.telemetryEligible;
  return {
    eligible: eligible ? 1 : 0,
    correct: eligible && item.correct ? 1 : 0,
    firstAttemptCorrect: eligible && item.correct && item.attempts === 1 ? 1 : 0,
    duration: eligible ? item.elapsedSeconds : 0,
    independence: eligible ? report.independence : 0,
    lowAttempts: eligible && item.abilityBand === 'low' ? 1 : 0,
    lowCorrect: eligible && item.abilityBand === 'low' && item.correct ? 1 : 0,
    highAttempts: eligible && item.abilityBand === 'high' ? 1 : 0,
    highCorrect: eligible && item.abilityBand === 'high' && item.correct ? 1 : 0,
    technicalErrors: item.technicalErrors > 0 ? 1 : 0
  };
}

function aggregateStatements(env: Cloudflare.Env, report: AssessmentReportV2) {
  return report.taskScores.map(item => {
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
        report.blueprintVersion,
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
}

function reportInsertStatement(env: Cloudflare.Env, report: AssessmentReportV2, serialized: string) {
  return env.DB.prepare(`INSERT INTO assessment_reports(
      id, user_id, mode, status, started_at, completed_at, duration_seconds, score, payload
    ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(
      report.id,
      report.userId,
      report.mode,
      report.status,
      report.startedAt,
      report.completedAt,
      report.durationSeconds,
      report.score,
      serialized
    );
}

function receiptInsertStatement(env: Cloudflare.Env, report: AssessmentReportV2) {
  return env.DB.prepare(`INSERT INTO assessment_calibration_receipts(
      report_id, user_id, blueprint_version
    ) VALUES(?, ?, ?)`)
    .bind(report.id, report.userId, report.blueprintVersion);
}

async function existingReport(env: Cloudflare.Env, reportId: string) {
  return env.DB.prepare(`SELECT r.user_id, r.payload,
      EXISTS(SELECT 1 FROM assessment_calibration_receipts c WHERE c.report_id = r.id) AS has_receipt
    FROM assessment_reports r WHERE r.id = ?`)
    .bind(reportId)
    .first<{ user_id: string; payload: string; has_receipt: number }>();
}

async function persistExisting(
  env: Cloudflare.Env,
  incoming: AssessmentReportV2,
  serialized: string,
  existing: { user_id: string; payload: string; has_receipt: number },
  userId: string
) {
  if (existing.user_id !== userId) return json({ error: 'Assessment owner mismatch' }, 403);
  let stored: AssessmentReportV2;
  try { stored = JSON.parse(existing.payload) as AssessmentReportV2; } catch { return json({ error: 'Stored assessment report is invalid' }, 500); }
  if (!validReportV2(stored) || immutableReport(stored) !== immutableReport(incoming)) {
    return json({ error: 'Assessment report is immutable' }, 409);
  }
  const changed = serialized !== existing.payload;
  const statements: D1PreparedStatement[] = [];
  let telemetryContributed = false;
  if (!existing.has_receipt) {
    statements.push(receiptInsertStatement(env, incoming), ...aggregateStatements(env, incoming));
    telemetryContributed = true;
  }
  if (changed) {
    statements.push(env.DB.prepare(`UPDATE assessment_reports SET payload = ?, updated_at = datetime('now')
      WHERE id = ? AND user_id = ?`).bind(serialized, incoming.id, userId));
  }
  if (statements.length) await env.DB.batch(statements);
  return json({ ok: true, idempotent: !changed, telemetryContributed, recovered: telemetryContributed });
}

async function saveReportV2(request: Request, env: Cloudflare.Env, userId: string, report: AssessmentReportV2) {
  if (bodyTooLarge(request)) return json({ error: 'Assessment report is too large' }, 413);
  if (report.userId !== userId) return json({ error: 'Assessment owner mismatch' }, 403);
  const serialized = JSON.stringify(report);
  if (new TextEncoder().encode(serialized).byteLength > MAX_REPORT_BYTES) {
    return json({ error: 'Assessment report is too large' }, 413);
  }

  const existing = await existingReport(env, report.id);
  if (existing) return persistExisting(env, report, serialized, existing, userId);

  try {
    await env.DB.batch([
      reportInsertStatement(env, report, serialized),
      receiptInsertStatement(env, report),
      ...aggregateStatements(env, report)
    ]);
    return json({ ok: true, idempotent: false, telemetryContributed: true, recovered: false });
  } catch (error) {
    const raced = await existingReport(env, report.id);
    if (raced) return persistExisting(env, report, serialized, raced, userId);
    throw error;
  }
}

export async function handleAssessmentReportV2Request(
  request: Request,
  env: Cloudflare.Env,
  userId: string
): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== '/api/assessment/reports' || request.method !== 'POST') return null;
  let body: unknown;
  try { body = await request.clone().json<unknown>(); } catch { return null; }
  if (!objectRecord(body) || body.blueprintVersion !== CURRENT_BLUEPRINT_VERSION) return null;
  if (!validReportV2(body)) return json({ error: 'Invalid calibrated assessment report' }, 400);
  return saveReportV2(request, env, userId, body);
}
