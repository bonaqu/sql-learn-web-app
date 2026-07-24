import { tasks } from '../data/course';
import { loadProgress, Progress, STORAGE_KEY, TaskStats } from './progress';

export const AUTH_SESSION_KEY = 'sql-academy-auth-session-v2';
export const AUTH_CHANGED_EVENT = 'sql-academy-auth-changed';

export type AuthSession = {
  version: 2;
  token: string;
  id: string;
  userId: string;
  username: string;
  displayName: string;
  dailyMinutes: 15 | 25 | 40;
  locale: 'ru-RU' | 'en-US';
  theme: 'dark' | 'light' | 'system';
  expiresAt: string;
  deviceName: string;
  revision: number;
  lastSyncAt?: string;
};

export type RecoverySummary = {
  remaining: number;
  generatedAt: string | null;
  canRegenerateAt: string | null;
};

export type AuthResponse = {
  session: {
    token: string;
    id: string;
    expiresAt: string;
    deviceName: string;
    revision: number;
  };
  user: {
    id: string;
    username: string;
    displayName: string;
    dailyMinutes: number;
    locale: string;
    theme: string;
  };
  recovery: RecoverySummary;
  recoveryCodes?: string[];
};

export type UserSessionInfo = {
  user: AuthResponse['user'];
  session: Omit<AuthResponse['session'], 'token'>;
  recovery: RecoverySummary;
};

export type UserProfile = {
  displayName: string;
  dailyMinutes: 15 | 25 | 40;
  locale: 'ru-RU' | 'en-US';
  theme: 'dark' | 'light' | 'system';
};

export type UserDeviceSession = {
  id: string;
  deviceName: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  current: boolean;
};

type CloudProgress = {
  progress: Progress | null;
  revision: number;
  updatedAt: string | null;
};

function parseMinutes(value: number): 15 | 25 | 40 {
  return value === 15 || value === 40 ? value : 25;
}

function parseLocale(value: string): 'ru-RU' | 'en-US' {
  return value === 'en-US' ? 'en-US' : 'ru-RU';
}

function parseTheme(value: string): 'dark' | 'light' | 'system' {
  return value === 'light' || value === 'system' ? value : 'dark';
}

export function sessionFromResponse(response: AuthResponse): AuthSession {
  return {
    version: 2,
    token: response.session.token,
    id: response.session.id,
    userId: response.user.id,
    username: response.user.username,
    displayName: response.user.displayName || '',
    dailyMinutes: parseMinutes(response.user.dailyMinutes),
    locale: parseLocale(response.user.locale),
    theme: parseTheme(response.user.theme),
    expiresAt: response.session.expiresAt,
    deviceName: response.session.deviceName,
    revision: Math.max(0, Number(response.session.revision) || 0)
  };
}

export function loadAuthSession(): AuthSession | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(AUTH_SESSION_KEY) || 'null') as Partial<AuthSession> | null;
    if (!parsed || parsed.version !== 2 || !parsed.token || !parsed.id || !parsed.userId || !parsed.username) return null;
    return {
      version: 2,
      token: parsed.token,
      id: parsed.id,
      userId: parsed.userId,
      username: parsed.username,
      displayName: parsed.displayName || '',
      dailyMinutes: parseMinutes(Number(parsed.dailyMinutes)),
      locale: parseLocale(String(parsed.locale || '')),
      theme: parseTheme(String(parsed.theme || '')),
      expiresAt: parsed.expiresAt || '',
      deviceName: parsed.deviceName || 'Браузер',
      revision: Math.max(0, Number(parsed.revision) || 0),
      lastSyncAt: parsed.lastSyncAt
    };
  } catch {
    return null;
  }
}

export function saveAuthSession(session: AuthSession) {
  localStorage.setItem(AUTH_SESSION_KEY, JSON.stringify(session));
  window.dispatchEvent(new CustomEvent(AUTH_CHANGED_EVENT, { detail: session }));
}

export function clearAuthSession() {
  localStorage.removeItem(AUTH_SESSION_KEY);
  localStorage.removeItem('sql-academy-account-session-v1');
  window.dispatchEvent(new CustomEvent(AUTH_CHANGED_EVENT, { detail: null }));
}

async function parseResponse<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => ({ error: `HTTP ${response.status}` })) as T & {
    error?: string;
    canRegenerateAt?: string;
  };
  if (!response.ok) {
    const error = new Error(payload.error || `HTTP ${response.status}`) as Error & {
      status?: number;
      payload?: unknown;
      retryAfter?: number;
    };
    error.status = response.status;
    error.payload = payload;
    error.retryAfter = Number(response.headers.get('retry-after')) || undefined;
    throw error;
  }
  return payload;
}

function deviceName() {
  const platform = navigator.userAgentData?.platform || navigator.platform || 'Браузер';
  const mobile = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
  return `${mobile ? 'Телефон' : 'ПК'} · ${platform}`.slice(0, 64);
}

export async function registerUser(input: { username: string; password: string; displayName?: string }) {
  return parseResponse<AuthResponse>(await fetch('/api/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...input, deviceName: deviceName() })
  }));
}

export async function loginUser(username: string, password: string) {
  const response = await parseResponse<AuthResponse>(await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password, deviceName: deviceName() })
  }));
  const session = sessionFromResponse(response);
  saveAuthSession(session);
  return { response, session };
}

export async function validateSession() {
  const info = await parseResponse<UserSessionInfo>(await fetch('/api/auth/session'));
  const current = loadAuthSession();
  if (!current) throw new Error('Сессия отсутствует');
  const session: AuthSession = {
    ...current,
    username: info.user.username,
    displayName: info.user.displayName || '',
    dailyMinutes: parseMinutes(info.user.dailyMinutes),
    locale: parseLocale(info.user.locale),
    theme: parseTheme(info.user.theme),
    expiresAt: info.session.expiresAt,
    deviceName: info.session.deviceName,
    revision: Math.max(0, Number(info.session.revision) || 0)
  };
  saveAuthSession(session);
  return { info, session };
}

export async function logoutUser() {
  try {
    await fetch('/api/auth/logout', { method: 'POST' });
  } finally {
    clearAuthSession();
  }
}

export async function resetPassword(username: string, recoveryCode: string, newPassword: string) {
  return parseResponse<{ ok: true; message: string }>(await fetch('/api/auth/password/reset', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, recoveryCode, newPassword })
  }));
}

export async function changePassword(currentPassword: string, recoveryCode: string, newPassword: string) {
  const result = await parseResponse<{ ok: true; message: string }>(await fetch('/api/auth/password/change', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ currentPassword, recoveryCode, newPassword })
  }));
  clearAuthSession();
  return result;
}

export async function regenerateRecoveryCodes(currentPassword: string) {
  return parseResponse<{ recoveryCodes: string[]; recovery: RecoverySummary }>(await fetch('/api/auth/recovery/regenerate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ currentPassword })
  }));
}

export async function fetchUserSessions() {
  return parseResponse<{ sessions: UserDeviceSession[] }>(await fetch('/api/auth/sessions'));
}

export async function revokeUserSession(sessionId: string) {
  const result = await parseResponse<{ ok: true; currentSessionRevoked: boolean }>(await fetch(`/api/auth/sessions/${encodeURIComponent(sessionId)}`, {
    method: 'DELETE'
  }));
  if (result.currentSessionRevoked) clearAuthSession();
  return result;
}

export async function updateUserProfile(profile: UserProfile) {
  const result = await parseResponse<{ ok: true; user: AuthResponse['user'] }>(await fetch('/api/profile', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(profile)
  }));
  const session = loadAuthSession();
  if (session) {
    saveAuthSession({
      ...session,
      displayName: result.user.displayName || '',
      dailyMinutes: parseMinutes(result.user.dailyMinutes),
      locale: parseLocale(result.user.locale),
      theme: parseTheme(result.user.theme)
    });
  }
  return result;
}

export async function deleteUserAccount(currentPassword: string, recoveryCode: string) {
  const result = await parseResponse<{ ok: true }>(await fetch('/api/profile', {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ currentPassword, recoveryCode, confirm: 'DELETE' })
  }));
  clearAuthSession();
  return result;
}

function latestTimestamp(left?: string, right?: string) {
  if (!left) return right;
  if (!right) return left;
  return new Date(left).getTime() >= new Date(right).getTime() ? left : right;
}

function earliestTimestamp(left?: string, right?: string) {
  if (!left) return right;
  if (!right) return left;
  return new Date(left).getTime() <= new Date(right).getTime() ? left : right;
}

function mergeTaskStats(left: TaskStats = { attempts: 0, incorrect: 0, hintsUsed: 0 }, right: TaskStats = { attempts: 0, incorrect: 0, hintsUsed: 0 }): TaskStats {
  return {
    attempts: Math.max(left.attempts, right.attempts),
    incorrect: Math.max(left.incorrect, right.incorrect),
    hintsUsed: Math.max(left.hintsUsed, right.hintsUsed),
    lastAttemptAt: latestTimestamp(left.lastAttemptAt, right.lastAttemptAt),
    completedAt: earliestTimestamp(left.completedAt, right.completedAt)
  };
}

export function mergeProgress(local: Progress, cloud: Progress | null): Progress {
  if (!cloud) return local;
  const completed = Array.from(new Set([...local.completed, ...cloud.completed])).sort();
  const taskIds = new Set([...Object.keys(local.taskStats), ...Object.keys(cloud.taskStats)]);
  const taskStats = Object.fromEntries(Array.from(taskIds, id => [id, mergeTaskStats(local.taskStats[id], cloud.taskStats[id])]));
  const xp = tasks.filter(task => completed.includes(task.id)).reduce((total, task) => total + task.xp, 0);
  const historyDays = new Set([...local.history.map(point => point.day), ...cloud.history.map(point => point.day)]);
  const history = Array.from(historyDays, day => ({
    day,
    solved: Math.max(
      local.history.find(point => point.day === day)?.solved || 0,
      cloud.history.find(point => point.day === day)?.solved || 0
    )
  }));
  const localDate = local.lastStudyDate || '';
  const cloudDate = cloud.lastStudyDate || '';
  return {
    version: 4,
    completed,
    taskStats,
    xp,
    streak: Math.max(local.streak, cloud.streak),
    history,
    lastTask: localDate >= cloudDate ? local.lastTask || cloud.lastTask : cloud.lastTask || local.lastTask,
    lastStudyDate: localDate >= cloudDate ? local.lastStudyDate || cloud.lastStudyDate : cloud.lastStudyDate || local.lastStudyDate
  };
}

function progressFingerprint(progress: Progress | null) {
  if (!progress) return 'null';
  return JSON.stringify({
    ...progress,
    completed: [...progress.completed].sort(),
    taskStats: Object.fromEntries(Object.entries(progress.taskStats).sort(([left], [right]) => left.localeCompare(right))),
    history: [...progress.history].sort((left, right) => left.day.localeCompare(right.day))
  });
}

async function fetchCloudProgress() {
  return parseResponse<CloudProgress>(await fetch('/api/user/progress'));
}

async function putProgress(progress: Progress, baseRevision: number) {
  return parseResponse<{ ok: true; revision: number; updatedAt: string | null }>(await fetch('/api/user/progress', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ progress, baseRevision })
  }));
}

export async function syncUserProgress(session = loadAuthSession()) {
  if (!session) throw new Error('Необходим вход');
  let cloud = await fetchCloudProgress();
  const local = loadProgress();
  let merged = mergeProgress(local, cloud.progress);
  let localChanged = progressFingerprint(local) !== progressFingerprint(merged);
  const syncedAt = new Date().toISOString();

  if (cloud.progress && progressFingerprint(cloud.progress) === progressFingerprint(merged)) {
    const next = { ...session, revision: cloud.revision, lastSyncAt: syncedAt };
    if (localChanged) localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
    saveAuthSession(next);
    return { session: next, progress: merged, localChanged, revision: next.revision };
  }

  try {
    const saved = await putProgress(merged, cloud.revision);
    session = { ...session, revision: saved.revision, lastSyncAt: syncedAt };
  } catch (error) {
    if ((error as Error & { status?: number }).status !== 409) throw error;
    cloud = await fetchCloudProgress();
    merged = mergeProgress(merged, cloud.progress);
    localChanged = progressFingerprint(local) !== progressFingerprint(merged);
    if (cloud.progress && progressFingerprint(cloud.progress) === progressFingerprint(merged)) {
      session = { ...session, revision: cloud.revision, lastSyncAt: syncedAt };
    } else {
      const saved = await putProgress(merged, cloud.revision);
      session = { ...session, revision: saved.revision, lastSyncAt: syncedAt };
    }
  }

  if (localChanged) localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
  saveAuthSession(session);
  return { session, progress: merged, localChanged, revision: session.revision };
}

export function recoveryCodesDownload(codes: string[]) {
  const text = [
    'SQL Academy — recovery codes',
    '',
    ...codes.map((code, index) => `${index + 1}. ${code}`),
    '',
    'Каждый код одноразовый. Он нужен для сброса или смены пароля.',
    'Храни файл офлайн и не отправляй посторонним.'
  ].join('\n');
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'sql-academy-recovery-codes.txt';
  link.click();
  URL.revokeObjectURL(url);
}
