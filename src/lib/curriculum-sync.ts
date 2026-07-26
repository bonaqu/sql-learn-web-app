import { loadAuthSession } from './auth';
import type { CurriculumProgressV1 } from './curriculum-progress';

export type CurriculumSyncStatus = 'idle' | 'syncing' | 'synced' | 'offline' | 'error';
export const CURRICULUM_SYNC_STATUS_EVENT = 'sql-academy-curriculum-sync-status';
export const CURRICULUM_PROGRESS_CHANGED_EVENT = 'sql-academy-curriculum-progress-changed';

const STORAGE_PREFIX = 'sql-academy-curriculum-progress-v1';

type CloudCurriculum = {
  progress: CurriculumProgressV1 | null;
  updatedAt: string | null;
  error?: string;
};

type SavedCurriculum = {
  ok: true;
  version: 1;
  updatedAt: string;
};

type Answer = CurriculumProgressV1['answers'][string];
type Draft = CurriculumProgressV1['projectDrafts'][string];

function emit(status: CurriculumSyncStatus, message: string) {
  window.dispatchEvent(new CustomEvent(CURRICULUM_SYNC_STATUS_EVENT, { detail: { status, message } }));
}

function now() {
  return new Date().toISOString();
}

function ownerId() {
  const session = loadAuthSession();
  return session?.userId || session?.username || 'local';
}

function storageKey() {
  return `${STORAGE_PREFIX}:${ownerId()}`;
}

function emptyProgress(): CurriculumProgressV1 {
  return {
    version: 1,
    completedSections: [],
    completedLessons: [],
    completedProjects: [],
    answers: {},
    projectDrafts: {},
    bookmark: null,
    updatedAt: now()
  };
}

function uniqueStrings(value: unknown, max: number) {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.filter((item): item is string => typeof item === 'string' && item.length > 0 && item.length <= 100))).slice(0, max);
}

function safeTimestamp(value: unknown, fallback = now()) {
  return typeof value === 'string' && value.length <= 80 && Number.isFinite(Date.parse(value)) ? value : fallback;
}

function safeProjectFiles(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const files: Record<string, string> = {};
  for (const [id, sql] of Object.entries(value).slice(0, 8)) {
    if (!/^[a-z0-9][a-z0-9.-]{2,99}$/i.test(id) || typeof sql !== 'string') continue;
    files[id] = sql.slice(0, 40_000);
  }
  return files;
}

function sanitizeEnvelope(value: unknown): CurriculumProgressV1 {
  const source = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Partial<CurriculumProgressV1>
    : {};
  const answers: Record<string, Answer> = {};
  if (source.answers && typeof source.answers === 'object' && !Array.isArray(source.answers)) {
    for (const [id, raw] of Object.entries(source.answers).slice(0, 220)) {
      if (!id || id.length > 100 || !raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
      const answer = raw as Partial<Answer>;
      const optionIndex = Number(answer.optionIndex);
      if (!Number.isInteger(optionIndex) || optionIndex < 0 || optionIndex > 12 || typeof answer.correct !== 'boolean') continue;
      answers[id] = { optionIndex, correct: answer.correct, answeredAt: safeTimestamp(answer.answeredAt) };
    }
  }

  const projectDrafts: Record<string, Draft> = {};
  if (source.projectDrafts && typeof source.projectDrafts === 'object' && !Array.isArray(source.projectDrafts)) {
    for (const [id, raw] of Object.entries(source.projectDrafts).slice(0, 12)) {
      if (!id || id.length > 100 || !raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
      const draft = raw as Partial<Draft>;
      const updatedAt = safeTimestamp(draft.updatedAt);
      const guidanceUses = Number(draft.guidanceUses);
      projectDrafts[id] = {
        sql: typeof draft.sql === 'string' ? draft.sql.slice(0, 40_000) : '',
        files: safeProjectFiles(draft.files),
        notes: typeof draft.notes === 'string' ? draft.notes.slice(0, 12_000) : '',
        completedDeliverables: uniqueStrings(draft.completedDeliverables, 24),
        startedAt: safeTimestamp(draft.startedAt, updatedAt),
        guidanceUses: Number.isInteger(guidanceUses) && guidanceUses >= 0 && guidanceUses <= 1_000 ? guidanceUses : 0,
        updatedAt
      };
    }
  }

  const bookmark = source.bookmark
    && typeof source.bookmark === 'object'
    && typeof source.bookmark.lessonId === 'string'
    && typeof source.bookmark.sectionId === 'string'
    ? {
        lessonId: source.bookmark.lessonId.slice(0, 100),
        sectionId: source.bookmark.sectionId.slice(0, 100),
        updatedAt: safeTimestamp(source.bookmark.updatedAt)
      }
    : null;

  return {
    version: 1,
    completedSections: uniqueStrings(source.completedSections, 240),
    completedLessons: uniqueStrings(source.completedLessons, 80),
    completedProjects: uniqueStrings(source.completedProjects, 12),
    answers,
    projectDrafts,
    bookmark,
    updatedAt: safeTimestamp(source.updatedAt)
  };
}

function loadLocalCurriculum() {
  try {
    const raw = localStorage.getItem(storageKey());
    return raw ? sanitizeEnvelope(JSON.parse(raw)) : emptyProgress();
  } catch {
    return emptyProgress();
  }
}

function saveLocalCurriculum(progress: CurriculumProgressV1) {
  const next = sanitizeEnvelope({ ...progress, updatedAt: now() });
  localStorage.setItem(storageKey(), JSON.stringify(next));
  window.dispatchEvent(new CustomEvent(CURRICULUM_PROGRESS_CHANGED_EVENT, { detail: next }));
  return next;
}

function mergeCurriculum(local: CurriculumProgressV1, remote: CurriculumProgressV1) {
  const answers = { ...local.answers };
  for (const [id, answer] of Object.entries(remote.answers)) {
    const current = answers[id];
    if (!current || answer.answeredAt >= current.answeredAt || answer.correct) answers[id] = answer;
  }

  const projectDrafts = { ...local.projectDrafts };
  for (const [id, draft] of Object.entries(remote.projectDrafts)) {
    const current = projectDrafts[id];
    if (!current || draft.updatedAt >= current.updatedAt) projectDrafts[id] = draft;
  }

  const bookmark = !local.bookmark
    ? remote.bookmark
    : !remote.bookmark
      ? local.bookmark
      : remote.bookmark.updatedAt >= local.bookmark.updatedAt ? remote.bookmark : local.bookmark;

  return sanitizeEnvelope({
    version: 1,
    completedSections: [...local.completedSections, ...remote.completedSections],
    completedLessons: [...local.completedLessons, ...remote.completedLessons],
    completedProjects: [...local.completedProjects, ...remote.completedProjects],
    answers,
    projectDrafts,
    bookmark,
    updatedAt: local.updatedAt >= remote.updatedAt ? local.updatedAt : remote.updatedAt
  });
}

async function parseResponse<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => ({ error: `HTTP ${response.status}` })) as T & { error?: string };
  if (!response.ok) {
    const error = new Error(payload.error || `HTTP ${response.status}`) as Error & {
      status?: number;
      payload?: T & { error?: string };
    };
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

function fingerprint(progress: CurriculumProgressV1 | null) {
  if (!progress) return 'null';
  return JSON.stringify({
    version: progress.version,
    completedSections: [...progress.completedSections].sort(),
    completedLessons: [...progress.completedLessons].sort(),
    completedProjects: [...progress.completedProjects].sort(),
    answers: Object.fromEntries(Object.entries(progress.answers).sort(([left], [right]) => left.localeCompare(right))),
    projectDrafts: Object.fromEntries(Object.entries(progress.projectDrafts).sort(([left], [right]) => left.localeCompare(right))),
    bookmark: progress.bookmark
  });
}

async function fetchCloudCurriculum() {
  return parseResponse<CloudCurriculum>(await fetch('/api/curriculum/progress'));
}

async function putCloudCurriculum(progress: CurriculumProgressV1, baseUpdatedAt: string | null) {
  return parseResponse<SavedCurriculum>(await fetch('/api/curriculum/progress', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ progress, baseUpdatedAt })
  }));
}

export async function syncCurriculumProgress() {
  if (!loadAuthSession()) throw new Error('Необходим вход');
  if (!navigator.onLine) {
    emit('offline', 'Curriculum сохранён локально. Синхронизация продолжится после подключения.');
    return { progress: loadLocalCurriculum(), changed: false, status: 'offline' as const };
  }

  emit('syncing', 'Синхронизирую уроки и Project Lab…');
  let local = loadLocalCurriculum();
  let cloud = await fetchCloudCurriculum();

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const merged = mergeCurriculum(local, cloud.progress || local);
    const localChanged = fingerprint(local) !== fingerprint(merged);
    const remoteChanged = fingerprint(cloud.progress) !== fingerprint(merged);

    if (!remoteChanged && cloud.progress) {
      const saved = localChanged ? saveLocalCurriculum(merged) : local;
      emit('synced', localChanged ? 'Curriculum объединён с облачной копией.' : 'Curriculum синхронизирован.');
      return { progress: saved, changed: localChanged, status: 'synced' as const };
    }

    try {
      await putCloudCurriculum(merged, cloud.updatedAt);
      const saved = saveLocalCurriculum(merged);
      emit('synced', cloud.progress ? 'Локальные и облачные изменения объединены.' : 'Curriculum сохранён в облаке.');
      return { progress: saved, changed: localChanged, status: 'synced' as const };
    } catch (reason) {
      const error = reason as Error & { status?: number; payload?: CloudCurriculum };
      if (error.status !== 409 || attempt >= 2) throw error;
      cloud = {
        progress: error.payload?.progress || null,
        updatedAt: error.payload?.updatedAt || null
      };
      local = merged;
    }
  }

  throw new Error('Не удалось синхронизировать curriculum после конфликта');
}

export async function syncCurriculumWithStatus() {
  try {
    return await syncCurriculumProgress();
  } catch (reason) {
    const message = reason instanceof Error ? reason.message : String(reason);
    emit('error', `Curriculum не синхронизирован: ${message}`);
    throw reason;
  }
}
