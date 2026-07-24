import { tasks } from '../data/course';
import { loadProgress, Progress, STORAGE_KEY, TaskStats } from './progress';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const RECOVERY_PREFIX = 'SQLA';
const RECOVERY_PAYLOAD_BYTES = 20;
const RECOVERY_CHECKSUM_BYTES = 2;
const SESSION_KEY = 'sql-academy-account-session-v1';

export type AccountSession = {
  version: 1;
  accountId: string;
  deviceId: string;
  deviceName: string;
  deviceToken: string;
  revision: number;
  lastSyncAt?: string;
};

export type AccountDevice = {
  id: string;
  name: string;
  createdAt: string;
  lastSeenAt: string;
  current: boolean;
};

export type AccountMetadata = {
  account: {
    idHint: string;
    createdAt?: string;
    lastSeenAt?: string;
    revision: number;
    progressUpdatedAt: string | null;
  };
  currentDeviceId: string;
  devices: AccountDevice[];
};

type IssuedDevice = {
  accountId: string;
  deviceId: string;
  deviceName: string;
  deviceToken: string;
  created: boolean;
  revision: number;
  progressUpdatedAt: string | null;
};

type CloudProgress = {
  progress: Progress | null;
  revision: number;
  updatedAt: string | null;
};

export type SyncResult = {
  session: AccountSession;
  progress: Progress;
  localChanged: boolean;
  revision: number;
};

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function digest(value: Uint8Array | string) {
  const source = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  const owned = new Uint8Array(source.byteLength);
  owned.set(source);
  return new Uint8Array(await crypto.subtle.digest('SHA-256', owned.buffer));
}

function base32Encode(bytes: Uint8Array) {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
      value &= bits ? (1 << bits) - 1 : 0;
    }
  }
  if (bits) output += ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

function base32Decode(value: string) {
  let bits = 0;
  let buffer = 0;
  const output: number[] = [];
  for (const character of value) {
    const index = ALPHABET.indexOf(character);
    if (index < 0) throw new Error('Недопустимый символ recovery-кода');
    buffer = (buffer << 5) | index;
    bits += 5;
    while (bits >= 8) {
      output.push((buffer >>> (bits - 8)) & 255);
      bits -= 8;
      buffer &= bits ? (1 << bits) - 1 : 0;
    }
  }
  return new Uint8Array(output);
}

function formatRecovery(raw: string) {
  return `${RECOVERY_PREFIX}-${raw.match(/.{1,4}/g)?.join('-') || raw}`;
}

function normalizeRecovery(value: string) {
  const normalized = value.toUpperCase().replace(/[^A-Z2-9]/g, '');
  return normalized.startsWith(RECOVERY_PREFIX) ? normalized.slice(RECOVERY_PREFIX.length) : normalized;
}

export async function generateRecoveryCode() {
  const payload = crypto.getRandomValues(new Uint8Array(RECOVERY_PAYLOAD_BYTES));
  const checksum = (await digest(payload)).slice(0, RECOVERY_CHECKSUM_BYTES);
  const full = new Uint8Array(payload.length + checksum.length);
  full.set(payload);
  full.set(checksum, payload.length);
  return formatRecovery(base32Encode(full));
}

export async function validateRecoveryCode(value: string) {
  try {
    const raw = normalizeRecovery(value);
    if (raw.length !== 36) return false;
    const decoded = base32Decode(raw);
    if (decoded.length !== RECOVERY_PAYLOAD_BYTES + RECOVERY_CHECKSUM_BYTES) return false;
    const payload = decoded.slice(0, RECOVERY_PAYLOAD_BYTES);
    const expected = (await digest(payload)).slice(0, RECOVERY_CHECKSUM_BYTES);
    return expected.every((byte, index) => byte === decoded[RECOVERY_PAYLOAD_BYTES + index]);
  } catch {
    return false;
  }
}

export async function deriveAccountCredentials(recoveryCode: string) {
  const raw = normalizeRecovery(recoveryCode);
  if (!await validateRecoveryCode(recoveryCode)) throw new Error('Recovery-код повреждён или введён с ошибкой');
  const accountDigest = await digest(`sql-academy/account/v1:${raw}`);
  const masterDigest = await digest(`sql-academy/master/v1:${raw}`);
  return {
    accountId: bytesToHex(accountDigest),
    masterToken: bytesToBase64Url(masterDigest),
    canonicalRecoveryCode: formatRecovery(raw)
  };
}

export function loadAccountSession(): AccountSession | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null') as Partial<AccountSession> | null;
    if (!parsed || parsed.version !== 1 || !parsed.accountId || !parsed.deviceId || !parsed.deviceToken) return null;
    return {
      version: 1,
      accountId: parsed.accountId,
      deviceId: parsed.deviceId,
      deviceName: parsed.deviceName || 'Устройство',
      deviceToken: parsed.deviceToken,
      revision: Math.max(0, Number(parsed.revision) || 0),
      lastSyncAt: parsed.lastSyncAt
    };
  } catch {
    return null;
  }
}

export function saveAccountSession(session: AccountSession) {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  window.dispatchEvent(new CustomEvent('sql-academy-account-session', { detail: session }));
}

export function clearAccountSession() {
  localStorage.removeItem(SESSION_KEY);
  window.dispatchEvent(new CustomEvent('sql-academy-account-session', { detail: null }));
}

function sessionHeaders(session: AccountSession) {
  return {
    authorization: `Bearer ${session.deviceToken}`,
    'x-account-id': session.accountId,
    'x-device-id': session.deviceId
  };
}

async function parseResponse<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => ({ error: `HTTP ${response.status}` })) as T & { error?: string };
  if (!response.ok) {
    const error = new Error(payload.error || `HTTP ${response.status}`) as Error & { status?: number; payload?: unknown };
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

function deviceNameFallback(deviceId: string) {
  return `Устройство ${deviceId.slice(0, 4).toUpperCase()}`;
}

async function issueDevice(recoveryCode: string, deviceName: string, connect: boolean) {
  const credentials = await deriveAccountCredentials(recoveryCode);
  const deviceId = crypto.randomUUID();
  const response = await fetch(connect ? '/api/account/connect' : '/api/account/register', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${credentials.masterToken}`,
      'content-type': 'application/json',
      'x-account-id': credentials.accountId
    },
    body: JSON.stringify({
      deviceId,
      deviceName: deviceName.trim() || deviceNameFallback(deviceId),
      legacyProfileId: localStorage.getItem('sql-academy-profile-id')
    })
  });
  const issued = await parseResponse<IssuedDevice>(response);
  const session: AccountSession = {
    version: 1,
    accountId: issued.accountId,
    deviceId: issued.deviceId,
    deviceName: issued.deviceName,
    deviceToken: issued.deviceToken,
    revision: issued.revision
  };
  saveAccountSession(session);
  return { session, canonicalRecoveryCode: credentials.canonicalRecoveryCode };
}

export const registerAccount = (recoveryCode: string, deviceName: string) => issueDevice(recoveryCode, deviceName, false);
export const connectAccount = (recoveryCode: string, deviceName: string) => issueDevice(recoveryCode, deviceName, true);

export async function fetchAccountMetadata(session = loadAccountSession()) {
  if (!session) throw new Error('Аккаунт не подключён');
  return parseResponse<AccountMetadata>(await fetch('/api/account', { headers: sessionHeaders(session) }));
}

export async function fetchCloudProgress(session = loadAccountSession()) {
  if (!session) throw new Error('Аккаунт не подключён');
  return parseResponse<CloudProgress>(await fetch('/api/account/progress', { headers: sessionHeaders(session) }));
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

function saveMergedProgress(progress: Progress) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
}

async function putProgress(session: AccountSession, progress: Progress, baseRevision: number) {
  return parseResponse<{ ok: true; revision: number; updatedAt: string | null }>(await fetch('/api/account/progress', {
    method: 'PUT',
    headers: { ...sessionHeaders(session), 'content-type': 'application/json' },
    body: JSON.stringify({ progress, baseRevision })
  }));
}

export async function syncAccountProgress(session = loadAccountSession()): Promise<SyncResult> {
  if (!session) throw new Error('Аккаунт не подключён');
  let cloud = await fetchCloudProgress(session);
  const local = loadProgress();
  let merged = mergeProgress(local, cloud.progress);
  let localChanged = JSON.stringify(local) !== JSON.stringify(merged);

  try {
    const saved = await putProgress(session, merged, cloud.revision);
    session = { ...session, revision: saved.revision, lastSyncAt: new Date().toISOString() };
  } catch (error) {
    if ((error as Error & { status?: number }).status !== 409) throw error;
    cloud = await fetchCloudProgress(session);
    merged = mergeProgress(merged, cloud.progress);
    localChanged = JSON.stringify(local) !== JSON.stringify(merged);
    const saved = await putProgress(session, merged, cloud.revision);
    session = { ...session, revision: saved.revision, lastSyncAt: new Date().toISOString() };
  }

  if (localChanged) saveMergedProgress(merged);
  saveAccountSession(session);
  return { session, progress: merged, localChanged, revision: session.revision };
}

export async function revokeAccountDevice(targetDeviceId: string, session = loadAccountSession()) {
  if (!session) throw new Error('Аккаунт не подключён');
  return parseResponse<{ ok: true; currentDeviceRevoked: boolean }>(await fetch(`/api/account/devices/${encodeURIComponent(targetDeviceId)}`, {
    method: 'DELETE',
    headers: sessionHeaders(session)
  }));
}

export async function deleteCloudAccount(session = loadAccountSession()) {
  if (!session) throw new Error('Аккаунт не подключён');
  const result = await parseResponse<{ ok: true }>(await fetch('/api/account', {
    method: 'DELETE',
    headers: { ...sessionHeaders(session), 'content-type': 'application/json' },
    body: JSON.stringify({ confirm: 'DELETE' })
  }));
  clearAccountSession();
  return result;
}

export function recoveryCodeDownload(code: string) {
  const text = `SQL Academy recovery code\n\n${code}\n\nЭтот код — единственный способ подключить новое устройство. Не публикуй его и не отправляй посторонним.`;
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'sql-academy-recovery-code.txt';
  link.click();
  URL.revokeObjectURL(url);
}
