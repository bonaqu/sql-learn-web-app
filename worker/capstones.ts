type CapstoneStatus = 'passed' | 'failed';
type CapstoneProvenance = 'independent' | 'guided' | 'solution-assisted';
type CapstoneFileKind = 'query' | 'schema' | 'mutation' | 'plan';
type CapstoneCheckKind = 'result-contract' | 'hidden-data' | 'schema-invariant' | 'state-invariant' | 'plan-shape' | 'reflection';

type CapstoneFileEvidence = {
  fileId: string;
  title: string;
  kind: CapstoneFileKind;
  passed: boolean;
  score: number;
  maxScore: number;
  checks: string[];
};

type CapstoneCheckResult = {
  id: string;
  fileId: string | null;
  datasetId: string | null;
  kind: CapstoneCheckKind;
  title: string;
  passed: boolean;
  score: number;
  maxScore: number;
  message: string;
  remediation: string | null;
  hidden: boolean;
};

type CapstoneReportPayload = {
  version: 1;
  id: string;
  userId: string;
  projectId: string;
  status: CapstoneStatus;
  startedAt: string;
  completedAt: string;
  durationSeconds: number;
  attemptNumber: number;
  score: number;
  bestScore: number;
  passingScore: number;
  passed: boolean;
  provenance: CapstoneProvenance;
  independence: number;
  guidanceUses: number;
  solutionViews: number;
  files: CapstoneFileEvidence[];
  submissionFiles: Record<string, string>;
  checks: CapstoneCheckResult[];
  reflection: string;
  remediation: string[];
};

type StoredReport = { user_id: string; payload: string };

const PROJECT_FILES: Record<string, string[]> = {
  'project-incident-command': ['incident-base.sql', 'incident-metrics.sql', 'incident-ranking.sql'],
  'project-data-trust': ['trust-profile.sql', 'trust-normalize.sql', 'trust-schema.sql'],
  'project-executive-mart': ['mart-pipeline.sql', 'mart-trend.sql', 'mart-plan.sql'],
  'project-analytics-decision': ['analytics-cohort.sql', 'analytics-funnel.sql', 'analytics-trend.sql'],
  'project-backend-integrity': ['backend-mutation.sql', 'backend-schema.sql', 'backend-plan.sql']
};
const REPORT_ID_PATTERN = /^[a-f0-9-]{16,64}$/i;
const USER_ID_PATTERN = /^[a-f0-9-]{16,80}$/i;
const FILE_ID_PATTERN = /^[a-z0-9][a-z0-9.-]{2,99}$/i;
const DATASET_ID_PATTERN = /^[a-z0-9][a-z0-9-]{2,80}$/;
const CHECK_ID_PATTERN = /^[a-z0-9][a-z0-9:.-]{2,180}$/i;
const MAX_REPORT_BYTES = 240_000;

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

async function readJson(request: Request) {
  try {
    return await request.json<unknown>();
  } catch {
    return null;
  }
}

function boundedNumber(value: unknown, minimum: number, maximum: number) {
  return typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum;
}

function boundedInteger(value: unknown, minimum: number, maximum: number) {
  return boundedNumber(value, minimum, maximum) && Number.isInteger(value);
}

function shortText(value: unknown, maximum: number, allowEmpty = false) {
  return typeof value === 'string' && value.length <= maximum && (allowEmpty || value.trim().length > 0);
}

function validIsoDate(value: unknown) {
  return shortText(value, 64) && Number.isFinite(Date.parse(value as string));
}

function unique(values: string[]) {
  return new Set(values).size === values.length;
}

function sameStringSet(left: string[], right: string[]) {
  return left.length === right.length && [...left].sort().every((item, index) => item === [...right].sort()[index]);
}

function validFileEvidence(value: unknown, allowedFiles: Set<string>): value is CapstoneFileEvidence {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const file = value as Partial<CapstoneFileEvidence>;
  return typeof file.fileId === 'string'
    && allowedFiles.has(file.fileId)
    && shortText(file.title, 180)
    && (file.kind === 'query' || file.kind === 'schema' || file.kind === 'mutation' || file.kind === 'plan')
    && typeof file.passed === 'boolean'
    && boundedInteger(file.score, 0, 100)
    && boundedInteger(file.maxScore, 1, 100)
    && (file.score ?? 0) <= (file.maxScore ?? 0)
    && Array.isArray(file.checks)
    && file.checks.length >= 1
    && file.checks.length <= 8
    && file.checks.every(item => typeof item === 'string' && CHECK_ID_PATTERN.test(item))
    && unique(file.checks);
}

function validCheck(value: unknown, allowedFiles: Set<string>): value is CapstoneCheckResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const check = value as Partial<CapstoneCheckResult>;
  const fileIdValid = check.fileId === null || (typeof check.fileId === 'string' && allowedFiles.has(check.fileId));
  const datasetValid = check.datasetId === null || (typeof check.datasetId === 'string' && DATASET_ID_PATTERN.test(check.datasetId));
  return typeof check.id === 'string'
    && CHECK_ID_PATTERN.test(check.id)
    && fileIdValid
    && datasetValid
    && (check.kind === 'result-contract'
      || check.kind === 'hidden-data'
      || check.kind === 'schema-invariant'
      || check.kind === 'state-invariant'
      || check.kind === 'plan-shape'
      || check.kind === 'reflection')
    && shortText(check.title, 240)
    && typeof check.passed === 'boolean'
    && boundedNumber(check.score, 0, 100)
    && boundedNumber(check.maxScore, 0.1, 100)
    && (check.score ?? 0) <= (check.maxScore ?? 0) + 0.001
    && shortText(check.message, 1_200)
    && (check.remediation === null || shortText(check.remediation, 1_200))
    && typeof check.hidden === 'boolean'
    && (check.kind !== 'reflection' || (check.fileId === null && check.datasetId === null))
    && (check.kind === 'reflection' || check.fileId !== null);
}

function validSubmissionFiles(value: unknown, expectedFiles: string[]) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const entries = Object.entries(value);
  return sameStringSet(entries.map(([id]) => id), expectedFiles)
    && entries.every(([id, sql]) => FILE_ID_PATTERN.test(id)
      && typeof sql === 'string'
      && sql.length <= 40_000);
}

function validReport(value: unknown): value is CapstoneReportPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const report = value as Partial<CapstoneReportPayload>;
  const expectedFiles = typeof report.projectId === 'string' ? PROJECT_FILES[report.projectId] : undefined;
  if (!expectedFiles) return false;
  const allowedFiles = new Set(expectedFiles);
  if (!Array.isArray(report.files)
    || report.files.length !== expectedFiles.length
    || !report.files.every(file => validFileEvidence(file, allowedFiles))) return false;
  if (!sameStringSet(report.files.map(file => file.fileId), expectedFiles)) return false;
  if (!validSubmissionFiles(report.submissionFiles, expectedFiles)) return false;
  const checks = report.checks;
  if (!Array.isArray(checks)
    || checks.length < expectedFiles.length + 1
    || checks.length > 32
    || !checks.every(check => validCheck(check, allowedFiles))) return false;
  if (!unique(checks.map(check => check.id))) return false;
  if (!Array.isArray(report.remediation)
    || report.remediation.length > 32
    || !report.remediation.every(item => shortText(item, 1_200))) return false;

  const startedAt = typeof report.startedAt === 'string' ? Date.parse(report.startedAt) : NaN;
  const completedAt = typeof report.completedAt === 'string' ? Date.parse(report.completedAt) : NaN;
  const fileChecksComplete = report.files.every(file => {
    const relatedChecks = checks.filter(check => check.fileId === file.fileId);
    return relatedChecks.length === file.checks.length
      && sameStringSet(relatedChecks.map(check => check.id), file.checks)
      && file.passed === relatedChecks.every(check => check.passed);
  });
  const reflection = checks.find(check => check.kind === 'reflection');
  const expectedPassed = (report.score ?? 0) >= (report.passingScore ?? 101)
    && report.files.every(file => file.passed)
    && Boolean(reflection?.passed)
    && (report.independence ?? 0) >= 60;

  return report.version === 1
    && typeof report.id === 'string'
    && REPORT_ID_PATTERN.test(report.id)
    && typeof report.userId === 'string'
    && USER_ID_PATTERN.test(report.userId)
    && typeof report.projectId === 'string'
    && (report.status === 'passed' || report.status === 'failed')
    && validIsoDate(report.startedAt)
    && validIsoDate(report.completedAt)
    && completedAt >= startedAt
    && boundedInteger(report.durationSeconds, 0, 86_400)
    && boundedInteger(report.attemptNumber, 1, 1_000)
    && boundedInteger(report.score, 0, 100)
    && boundedInteger(report.bestScore, 0, 100)
    && (report.bestScore ?? 0) >= (report.score ?? 0)
    && boundedInteger(report.passingScore, 60, 100)
    && typeof report.passed === 'boolean'
    && report.passed === expectedPassed
    && report.status === (report.passed ? 'passed' : 'failed')
    && (report.provenance === 'independent' || report.provenance === 'guided' || report.provenance === 'solution-assisted')
    && boundedInteger(report.independence, 0, 100)
    && boundedInteger(report.guidanceUses, 0, 1_000)
    && boundedInteger(report.solutionViews, 0, 1_000)
    && fileChecksComplete
    && typeof report.reflection === 'string'
    && report.reflection.length <= 12_000;
}

async function listReports(env: Cloudflare.Env, userId: string) {
  const rows = await env.DB.prepare(`SELECT payload FROM capstone_reports
    WHERE user_id = ? ORDER BY completed_at DESC LIMIT 30`)
    .bind(userId)
    .all<{ payload: string }>();
  const reports = rows.results.flatMap(row => {
    try {
      const parsed = JSON.parse(row.payload) as CapstoneReportPayload;
      return validReport(parsed) ? [parsed] : [];
    } catch {
      return [];
    }
  });
  return json({ reports });
}

async function saveReport(request: Request, env: Cloudflare.Env, userId: string) {
  if (bodyTooLarge(request)) return json({ error: 'Capstone report is too large' }, 413);
  const body = await readJson(request) as { report?: unknown } | null;
  if (!validReport(body?.report)) return json({ error: 'Invalid capstone report' }, 400);
  const report = body.report;
  if (report.userId !== userId) return json({ error: 'Capstone owner mismatch' }, 403);
  const serialized = JSON.stringify(report);
  if (new TextEncoder().encode(serialized).byteLength > MAX_REPORT_BYTES) return json({ error: 'Capstone report is too large' }, 413);

  const existing = await env.DB.prepare('SELECT user_id, payload FROM capstone_reports WHERE id = ?')
    .bind(report.id)
    .first<StoredReport>();
  if (existing && existing.user_id !== userId) return json({ error: 'Capstone owner mismatch' }, 403);
  if (existing) {
    if (existing.payload !== serialized) return json({ error: 'Capstone reports are immutable' }, 409);
    return json({ ok: true, idempotent: true });
  }

  await env.DB.prepare(`INSERT INTO capstone_reports(
    id, user_id, project_id, status, started_at, completed_at, duration_seconds,
    attempt_number, score, best_score, passed, provenance, payload
  ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(
      report.id,
      userId,
      report.projectId,
      report.status,
      report.startedAt,
      report.completedAt,
      report.durationSeconds,
      report.attemptNumber,
      report.score,
      report.bestScore,
      report.passed ? 1 : 0,
      report.provenance,
      serialized
    )
    .run();
  return json({ ok: true, idempotent: false }, 201);
}

export async function handleCapstoneRequest(request: Request, env: Cloudflare.Env, userId: string): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith('/api/capstones')) return null;
  if (!env.DB) return json({ error: 'D1 binding is not configured' }, 503);

  if (url.pathname === '/api/capstones/reports') {
    if (request.method === 'GET') return listReports(env, userId);
    if (request.method === 'POST') return saveReport(request, env, userId);
    return json({ error: 'Method not allowed' }, 405, { allow: 'GET, POST' });
  }
  return json({ error: 'Not found' }, 404);
}
