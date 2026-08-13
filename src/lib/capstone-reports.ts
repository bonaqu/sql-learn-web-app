import { clearAuthSession, loadAuthSession } from './auth';
import type { CapstoneReport } from './capstone-evaluator';

export const CAPSTONE_REPORTS_CHANGED_EVENT = 'sql-academy-capstone-reports-changed';
const STORAGE_PREFIX = 'sql-academy-capstone-reports-v1';
const PROJECT_IDS = new Set(['project-incident-command', 'project-data-trust', 'project-executive-mart', 'project-analytics-decision', 'project-backend-integrity']);
const MAX_REPORTS = 30;

function storageKey(userId: string) {
  return `${STORAGE_PREFIX}:${userId}`;
}

function ownerId() {
  const auth = loadAuthSession();
  return auth?.userId || null;
}

function safeTimestamp(value: unknown) {
  return typeof value === 'string' && value.length >= 10 && value.length <= 64 && Number.isFinite(Date.parse(value));
}

function boundedInteger(value: unknown, min: number, max: number) {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}

function validSubmissionFiles(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const entries = Object.entries(value);
  return entries.length >= 1
    && entries.length <= 8
    && entries.every(([id, sql]) => /^[a-z0-9][a-z0-9.-]{2,99}$/i.test(id)
      && typeof sql === 'string'
      && sql.length <= 40_000);
}

export function validCapstoneReport(report: unknown, userId?: string): report is CapstoneReport {
  if (!report || typeof report !== 'object' || Array.isArray(report)) return false;
  const value = report as Partial<CapstoneReport>;
  return value.version === 1
    && typeof value.id === 'string'
    && value.id.length >= 8
    && value.id.length <= 100
    && typeof value.userId === 'string'
    && (!userId || value.userId === userId)
    && typeof value.projectId === 'string'
    && PROJECT_IDS.has(value.projectId)
    && (value.status === 'passed' || value.status === 'failed')
    && safeTimestamp(value.startedAt)
    && safeTimestamp(value.completedAt)
    && boundedInteger(value.durationSeconds, 0, 86_400)
    && boundedInteger(value.attemptNumber, 1, 1000)
    && boundedInteger(value.score, 0, 100)
    && boundedInteger(value.bestScore, 0, 100)
    && boundedInteger(value.passingScore, 0, 100)
    && typeof value.passed === 'boolean'
    && (value.provenance === 'independent' || value.provenance === 'guided' || value.provenance === 'solution-assisted')
    && boundedInteger(value.independence, 0, 100)
    && boundedInteger(value.guidanceUses, 0, 1000)
    && boundedInteger(value.solutionViews, 0, 1000)
    && Array.isArray(value.files)
    && value.files.length >= 1
    && value.files.length <= 8
    && validSubmissionFiles(value.submissionFiles)
    && Array.isArray(value.checks)
    && value.checks.length >= 1
    && value.checks.length <= 64
    && typeof value.reflection === 'string'
    && value.reflection.length <= 12_000
    && Array.isArray(value.remediation)
    && value.remediation.length <= 32;
}

export function loadLocalCapstoneReports(userId = ownerId()): CapstoneReport[] {
  if (!userId || typeof localStorage === 'undefined') return [];
  try {
    const raw = JSON.parse(localStorage.getItem(storageKey(userId)) || '[]') as unknown;
    if (!Array.isArray(raw)) return [];
    return raw
      .filter(report => validCapstoneReport(report, userId))
      .sort((left, right) => right.completedAt.localeCompare(left.completedAt))
      .slice(0, MAX_REPORTS);
  } catch {
    return [];
  }
}

export function saveLocalCapstoneReport(report: CapstoneReport) {
  if (!validCapstoneReport(report, report.userId)) throw new Error('Invalid capstone report');
  const previous = loadLocalCapstoneReports(report.userId).filter(item => item.id !== report.id);
  const next = [report, ...previous]
    .sort((left, right) => right.completedAt.localeCompare(left.completedAt))
    .slice(0, MAX_REPORTS);
  localStorage.setItem(storageKey(report.userId), JSON.stringify(next));
  window.dispatchEvent(new CustomEvent(CAPSTONE_REPORTS_CHANGED_EVENT, { detail: next }));
  return next;
}

export function mergeCapstoneReports(local: CapstoneReport[], remote: CapstoneReport[]) {
  const byId = new Map<string, CapstoneReport>();
  for (const report of [...remote, ...local]) {
    const current = byId.get(report.id);
    if (!current || report.completedAt >= current.completedAt) byId.set(report.id, report);
  }
  return [...byId.values()]
    .sort((left, right) => right.completedAt.localeCompare(left.completedAt))
    .slice(0, MAX_REPORTS);
}

async function parseResponse<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => ({ error: `HTTP ${response.status}` })) as T & { error?: string };
  if (!response.ok) {
    const error = new Error(payload.error || `HTTP ${response.status}`) as Error & { status?: number };
    error.status = response.status;
    throw error;
  }
  return payload;
}

export async function fetchCloudCapstoneReports() {
  const auth = loadAuthSession();
  if (!auth) return [];
  try {
    const payload = await parseResponse<{ reports: unknown[] }>(await fetch('/api/capstones/reports'));
    return (Array.isArray(payload.reports) ? payload.reports : [])
      .filter(report => validCapstoneReport(report, auth.userId))
      .slice(0, MAX_REPORTS);
  } catch (reason) {
    if ((reason as Error & { status?: number }).status === 401) clearAuthSession();
    throw reason;
  }
}

export async function uploadCapstoneReport(report: CapstoneReport) {
  const auth = loadAuthSession();
  if (!auth || report.userId !== auth.userId) throw new Error('Необходим вход владельца отчёта');
  try {
    await parseResponse<{ ok: true }>(await fetch('/api/capstones/reports', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ report })
    }));
  } catch (reason) {
    if ((reason as Error & { status?: number }).status === 401) clearAuthSession();
    throw reason;
  }
}

export async function syncCapstoneReports() {
  const auth = loadAuthSession();
  if (!auth) return [];
  if (!navigator.onLine) return loadLocalCapstoneReports(auth.userId);
  const local = loadLocalCapstoneReports(auth.userId);
  const remote = await fetchCloudCapstoneReports();
  const remoteIds = new Set(remote.map(report => report.id));
  for (const report of local.filter(item => !remoteIds.has(item.id))) await uploadCapstoneReport(report);
  const merged = mergeCapstoneReports(local, remote);
  localStorage.setItem(storageKey(auth.userId), JSON.stringify(merged));
  window.dispatchEvent(new CustomEvent(CAPSTONE_REPORTS_CHANGED_EVENT, { detail: merged }));
  return merged;
}
