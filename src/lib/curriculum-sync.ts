import { loadAuthSession } from './auth';
import {
  CurriculumProgressV1,
  loadCurriculumProgress,
  mergeCurriculumProgress,
  saveCurriculumProgress
} from './curriculum-progress';

export type CurriculumSyncStatus = 'idle' | 'syncing' | 'synced' | 'offline' | 'error';
export const CURRICULUM_SYNC_STATUS_EVENT = 'sql-academy-curriculum-sync-status';

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

function emit(status: CurriculumSyncStatus, message: string) {
  window.dispatchEvent(new CustomEvent(CURRICULUM_SYNC_STATUS_EVENT, { detail: { status, message } }));
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
    return { progress: loadCurriculumProgress(), changed: false, status: 'offline' as const };
  }

  emit('syncing', 'Синхронизирую уроки и Project Lab…');
  let local = loadCurriculumProgress();
  let cloud = await fetchCloudCurriculum();

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const merged = mergeCurriculumProgress(local, cloud.progress || local);
    const localChanged = fingerprint(local) !== fingerprint(merged);
    const remoteChanged = fingerprint(cloud.progress) !== fingerprint(merged);

    if (!remoteChanged && cloud.progress) {
      const saved = localChanged ? saveCurriculumProgress(merged) : local;
      emit('synced', localChanged ? 'Curriculum объединён с облачной копией.' : 'Curriculum синхронизирован.');
      return { progress: saved, changed: localChanged, status: 'synced' as const };
    }

    try {
      await putCloudCurriculum(merged, cloud.updatedAt);
      const saved = saveCurriculumProgress(merged);
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
