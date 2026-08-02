import { dialectLabManifests, type DialectExecutionMode, type SqlDialect } from '../data/dialect-lab-manifests';
import { loadAuthSession } from './auth';
import type { DialectLabExecution } from './dialect-lab-runtime';

export const DIALECT_LAB_PROGRESS_CHANGED_EVENT = 'sql-academy-dialect-lab-progress-changed';

export type DialectLabEvidence = {
  version: 1;
  labId: string;
  dialect: SqlDialect;
  manifestVersion: 1;
  executionMode: DialectExecutionMode;
  passed: boolean;
  evidenceEligible: boolean;
  independent: boolean;
  attempts: number;
  bestDurationMs: number | null;
  resultDigest: string | null;
  completedAt: string | null;
  lastAttemptAt: string;
};

export type DialectLabProgress = {
  version: 1;
  userId: string;
  revision: number;
  evidence: Record<string, DialectLabEvidence>;
  updatedAt: string;
};

export type DialectHydrationOptions = {
  failOnUnavailable?: boolean;
};

function storageKey(userId: string) {
  return `sql-academy-dialect-lab-progress-v1:${userId}`;
}

function evidenceKey(labId: string, dialect: SqlDialect) {
  return `${labId}:${dialect}`;
}

function nowIso() {
  return new Date().toISOString();
}

export function emptyDialectLabProgress(userId: string): DialectLabProgress {
  return { version: 1, userId, revision: 0, evidence: {}, updatedAt: nowIso() };
}

function sanitizeEvidence(value: unknown): DialectLabEvidence | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const item = value as Partial<DialectLabEvidence>;
  const lab = dialectLabManifests.find(candidate => candidate.id === item.labId);
  if (!lab || !['sqlite', 'postgresql', 'mysql'].includes(String(item.dialect))) return null;
  const dialect = item.dialect as SqlDialect;
  if (!lab.behaviors.some(behavior => behavior.dialect === dialect)) return null;
  const attempts = Math.max(0, Math.min(10_000, Number(item.attempts) || 0));
  return {
    version: 1,
    labId: lab.id,
    dialect,
    manifestVersion: 1,
    executionMode: item.executionMode === 'local-sqlite' || item.executionMode === 'deterministic-simulation' ? item.executionMode : 'remote-sandbox',
    passed: item.passed === true,
    evidenceEligible: item.evidenceEligible === true,
    independent: item.independent === true,
    attempts,
    bestDurationMs: typeof item.bestDurationMs === 'number' && Number.isFinite(item.bestDurationMs)
      ? Math.max(1, Math.min(60_000, Math.round(item.bestDurationMs)))
      : null,
    resultDigest: typeof item.resultDigest === 'string' && /^fnv1a-[a-f0-9]{8}$/.test(item.resultDigest) ? item.resultDigest : null,
    completedAt: typeof item.completedAt === 'string' && item.completedAt.length <= 64 ? item.completedAt : null,
    lastAttemptAt: typeof item.lastAttemptAt === 'string' && item.lastAttemptAt.length <= 64 ? item.lastAttemptAt : nowIso()
  };
}

export function sanitizeDialectLabProgress(value: unknown, userId: string): DialectLabProgress {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return emptyDialectLabProgress(userId);
  const source = value as Partial<DialectLabProgress>;
  const evidence: Record<string, DialectLabEvidence> = {};
  if (source.evidence && typeof source.evidence === 'object' && !Array.isArray(source.evidence)) {
    for (const candidate of Object.values(source.evidence)) {
      const sanitized = sanitizeEvidence(candidate);
      if (sanitized) evidence[evidenceKey(sanitized.labId, sanitized.dialect)] = sanitized;
    }
  }
  return {
    version: 1,
    userId,
    revision: Math.max(0, Math.min(1_000_000, Number(source.revision) || 0)),
    evidence,
    updatedAt: typeof source.updatedAt === 'string' && source.updatedAt.length <= 64 ? source.updatedAt : nowIso()
  };
}

export function loadDialectLabProgress(userId = loadAuthSession()?.userId): DialectLabProgress | null {
  if (!userId) return null;
  try {
    return sanitizeDialectLabProgress(JSON.parse(localStorage.getItem(storageKey(userId)) || 'null'), userId);
  } catch {
    return emptyDialectLabProgress(userId);
  }
}

export function saveDialectLabProgress(progress: DialectLabProgress) {
  const next = sanitizeDialectLabProgress({ ...progress, updatedAt: nowIso() }, progress.userId);
  localStorage.setItem(storageKey(progress.userId), JSON.stringify(next));
  window.dispatchEvent(new CustomEvent(DIALECT_LAB_PROGRESS_CHANGED_EVENT, { detail: next }));
  return next;
}

function newer(left: DialectLabEvidence, right: DialectLabEvidence) {
  return new Date(left.lastAttemptAt).getTime() >= new Date(right.lastAttemptAt).getTime() ? left : right;
}

function mergeEvidence(left: DialectLabEvidence | undefined, right: DialectLabEvidence | undefined) {
  if (!left) return right;
  if (!right) return left;
  const latest = newer(left, right);
  const passed = left.passed || right.passed;
  const eligible = left.evidenceEligible || right.evidenceEligible;
  const independent = left.independent || right.independent;
  const durations = [left.bestDurationMs, right.bestDurationMs].filter((value): value is number => typeof value === 'number');
  const completedCandidates = [left.completedAt, right.completedAt].filter((value): value is string => Boolean(value));
  return {
    ...latest,
    passed,
    evidenceEligible: eligible,
    independent,
    attempts: Math.max(left.attempts, right.attempts),
    bestDurationMs: durations.length ? Math.min(...durations) : null,
    resultDigest: passed ? (right.passed ? right.resultDigest : left.resultDigest) : latest.resultDigest,
    completedAt: completedCandidates.sort().at(-1) || null
  } satisfies DialectLabEvidence;
}

export function mergeDialectLabProgress(local: DialectLabProgress, remote: DialectLabProgress) {
  const userId = local.userId;
  const evidence: Record<string, DialectLabEvidence> = {};
  const keys = new Set([...Object.keys(local.evidence), ...Object.keys(remote.evidence)]);
  for (const key of keys) {
    const merged = mergeEvidence(local.evidence[key], remote.evidence[key]);
    if (merged) evidence[key] = merged;
  }
  return sanitizeDialectLabProgress({
    version: 1,
    userId,
    revision: Math.max(local.revision, remote.revision),
    evidence,
    updatedAt: new Date(Math.max(new Date(local.updatedAt).getTime() || 0, new Date(remote.updatedAt).getTime() || 0)).toISOString()
  }, userId);
}

export function recordDialectLabExecution(
  progress: DialectLabProgress,
  execution: DialectLabExecution,
  independent: boolean
) {
  const key = evidenceKey(execution.labId, execution.dialect);
  const previous = progress.evidence[key];
  const eligiblePass = execution.passed && execution.evidenceEligible && independent && !execution.offlinePreview;
  const attemptedAt = nowIso();
  const nextEvidence: DialectLabEvidence = {
    version: 1,
    labId: execution.labId,
    dialect: execution.dialect,
    manifestVersion: 1,
    executionMode: execution.executionMode,
    passed: Boolean(previous?.passed || eligiblePass),
    evidenceEligible: Boolean(previous?.evidenceEligible || (execution.evidenceEligible && !execution.offlinePreview)),
    independent: Boolean(previous?.independent || eligiblePass),
    attempts: Math.min(10_000, (previous?.attempts || 0) + 1),
    bestDurationMs: eligiblePass
      ? Math.min(previous?.bestDurationMs || Number.POSITIVE_INFINITY, execution.durationMs)
      : previous?.bestDurationMs || null,
    resultDigest: eligiblePass ? execution.resultDigest : previous?.resultDigest || null,
    completedAt: eligiblePass ? attemptedAt : previous?.completedAt || null,
    lastAttemptAt: attemptedAt
  };
  return sanitizeDialectLabProgress({
    ...progress,
    evidence: { ...progress.evidence, [key]: nextEvidence },
    updatedAt: attemptedAt
  }, progress.userId);
}

export function dialectLabCompletion(progress: DialectLabProgress, labId: string) {
  const manifest = dialectLabManifests.find(item => item.id === labId);
  if (!manifest) return { passed: 0, required: 0, complete: false };
  const required = manifest.portabilityChallenge.requiredDialects;
  const passed = required.filter(dialect => {
    const evidence = progress.evidence[evidenceKey(labId, dialect)];
    return evidence?.passed && evidence.independent && evidence.evidenceEligible;
  }).length;
  return { passed, required: manifest.evidence.minimumPassingDialects, complete: passed >= manifest.evidence.minimumPassingDialects };
}

export async function syncDialectLabProgress(progress: DialectLabProgress, conflictAttempts = 0): Promise<DialectLabProgress> {
  const response = await fetch('/api/dialect-labs/progress', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ progress, baseRevision: progress.revision })
  });
  const payload = await response.json() as { progress?: DialectLabProgress; revision?: number; error?: string };
  if (response.status === 409 && payload.progress) {
    if (conflictAttempts >= 3) throw new Error('Dialect progress changed repeatedly on another device');
    const merged = mergeDialectLabProgress(progress, sanitizeDialectLabProgress(payload.progress, progress.userId));
    return syncDialectLabProgress({ ...merged, revision: Number(payload.revision) || merged.revision }, conflictAttempts + 1);
  }
  if (!response.ok || !payload.progress) throw new Error(payload.error || 'Dialect progress sync failed');
  return saveDialectLabProgress(sanitizeDialectLabProgress(payload.progress, progress.userId));
}

export async function hydrateDialectLabProgress(
  userId = loadAuthSession()?.userId,
  options: DialectHydrationOptions = {}
) {
  if (!userId) return null;
  const initialLocal = loadDialectLabProgress(userId) || emptyDialectLabProgress(userId);
  const response = await fetch('/api/dialect-labs/progress');
  if (!response.ok) {
    if (options.failOnUnavailable) throw new Error(`Dialect progress hydration failed with HTTP ${response.status}`);
    return initialLocal;
  }
  const payload = await response.json() as { progress?: DialectLabProgress | null; revision?: number };
  const remote = payload.progress
    ? sanitizeDialectLabProgress(payload.progress, userId)
    : emptyDialectLabProgress(userId);
  const latestLocal = loadDialectLabProgress(userId) || initialLocal;
  const merged = mergeDialectLabProgress(latestLocal, { ...remote, revision: Number(payload.revision) || remote.revision });
  return saveDialectLabProgress(merged);
}
