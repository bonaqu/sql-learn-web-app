import {
  preservesTaskCounterComponents,
  validTaskCounterComponents,
  type TaskCounterComponents
} from '../src/lib/progress-counters';

type AttemptErrorKind =
  | 'syntax'
  | 'schema'
  | 'runtime'
  | 'result-shape'
  | 'row-set'
  | 'ordering'
  | 'values'
  | 'null-filter'
  | 'aggregation'
  | 'join-cardinality';

type TaskStatsPayload = {
  attempts: number;
  incorrect: number;
  hintsUsed: number;
  solutionViews?: number;
  solutionViewedAt?: string;
  assistedPasses?: number;
  lastAssistedAt?: string;
  retrievalDueAt?: string;
  retrievalEvidenceVersion?: string;
  retrievalSourceTaskId?: string;
  retrievalScheduledAt?: string;
  retrievalIntervalDays?: number;
  retrievalSuccesses?: number;
  retrievalLapses?: number;
  lastRetrievalAt?: string;
  lastRetrievalPassed?: boolean;
  durableEvidenceAt?: string;
  durableUntil?: string;
  independentPasses?: number;
  lastIndependentAt?: string;
  errorKinds?: Partial<Record<AttemptErrorKind, number>>;
  counterComponents?: TaskCounterComponents;
  lastAttemptAt?: string;
  completedAt?: string;
  evidenceContractVersion?: string;
  evaluationContractId?: string;
  evaluationContractVersion?: string;
  validatedFixtureIds?: string[];
  hiddenFixtureIds?: string[];
};

type ProgressPayload = {
  version: 4;
  completed: string[];
  taskStats: Record<string, TaskStatsPayload>;
  xp: number;
  streak: number;
  history: Array<{ day: string; solved: number }>;
  lastTask?: string;
  lastStudyDate?: string;
};

export type AuthenticatedUser = {
  userId: string;
  username: string;
  sessionId: string;
  deviceName: string;
  expiresAt: string;
  displayName: string;
  dailyMinutes: 15 | 25 | 40;
  locale: 'ru-RU' | 'en-US';
  theme: 'dark' | 'light' | 'system';
};

type UserRow = {
  user_id: string;
  username: string;
  password_salt: string;
  password_hash: string;
  password_iterations: number;
  failed_login_count: number;
  locked_until: string | null;
  recovery_generation: number;
  recovery_generated_at: string;
  created_at: string;
  password_changed_at: string;
};

type SessionRow = {
  session_id: string;
  user_id: string;
  username: string;
  device_name: string;
  created_at: string;
  last_seen_at: string;
  expires_at: string;
  display_name: string;
  daily_minutes: number;
  locale: string;
  theme: string;
};

const USERNAME_PATTERN = /^[a-z0-9](?:[a-z0-9._-]{1,30}[a-z0-9])?$/;
const RESERVED_USERNAMES = new Set(['admin', 'administrator', 'root', 'system', 'support', 'sqlacademy', 'sql-academy', 'api', 'security']);
const SESSION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const TASK_ID_PATTERN = /^task-[0-9]{3}$/;
const ATTEMPT_ERROR_KINDS = new Set<AttemptErrorKind>([
  'syntax',
  'schema',
  'runtime',
  'result-shape',
  'row-set',
  'ordering',
  'values',
  'null-filter',
  'aggregation',
  'join-cardinality'
]);
const RECOVERY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const RECOVERY_RAW_LENGTH = 24;
const PASSWORD_MIN_LENGTH = 15;
const PASSWORD_MAX_LENGTH = 128;
const PASSWORD_ITERATIONS = 600_000;
const MAX_PROGRESS_BYTES = 200_000;
const SESSION_HOURS = 12;
const LOGIN_FAILURE_LIMIT = 5;
const LOGIN_LOCK_MINUTES = 15;
const RECOVERY_CODE_COUNT = 8;
const PROFILE_MINUTES = new Set([15, 25, 40]);
const PROFILE_THEMES = new Set(['dark', 'light', 'system']);
const PROFILE_LOCALES = new Set(['ru-RU', 'en-US']);

const json = (data: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(data), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    ...headers
  }
});

const boundedInteger = (value: unknown, max = 1_000_000) =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= max;

const boundedString = (value: unknown, max: number) => typeof value === 'string' && value.length <= max;
const validFixtureIds = (value: unknown) => value === undefined || (Array.isArray(value)
  && value.length <= 12
  && value.every(item => boundedString(item, 96))
  && new Set(value).size === value.length);

function validErrorKinds(value: unknown) {
  if (value === undefined) return true;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.entries(value).every(([kind, count]) =>
    ATTEMPT_ERROR_KINDS.has(kind as AttemptErrorKind) && boundedInteger(count, 10_000));
}

function validRetrievalState(stats: Partial<TaskStatsPayload>, taskId: string) {
  if (stats.retrievalEvidenceVersion === undefined) {
    return stats.retrievalSourceTaskId === undefined
      && stats.retrievalScheduledAt === undefined
      && stats.lastRetrievalAt === undefined
      && stats.lastRetrievalPassed === undefined
      && stats.durableEvidenceAt === undefined
      && stats.durableUntil === undefined;
  }
  if (stats.retrievalEvidenceVersion !== 'durable-mastery-v1'
    || !stats.retrievalSourceTaskId
    || !TASK_ID_PATTERN.test(stats.retrievalSourceTaskId)
    || stats.retrievalSourceTaskId === taskId
    || !boundedString(stats.retrievalScheduledAt, 80)
    || !boundedString(stats.retrievalDueAt, 80)
    || !Number.isFinite(Date.parse(stats.retrievalScheduledAt!))
    || !Number.isFinite(Date.parse(stats.retrievalDueAt!))) return false;
  const scheduledAt = Date.parse(stats.retrievalScheduledAt!);
  const dueAt = Date.parse(stats.retrievalDueAt!);
  if (scheduledAt > dueAt || typeof stats.lastRetrievalPassed !== 'boolean') return false;
  if (stats.lastRetrievalPassed === true) {
    const successes = Number(stats.retrievalSuccesses);
    const expectedInterval = successes <= 1 ? 1 : successes === 2 ? 3 : Math.min(30, 3 * (2 ** (successes - 2)));
    const lastRetrievalAt = Date.parse(stats.lastRetrievalAt!);
    const durableEvidenceAt = Date.parse(stats.durableEvidenceAt!);
    const durableUntil = Date.parse(stats.durableUntil!);
    return successes >= 1
      && boundedInteger(stats.retrievalIntervalDays, 30)
      && Number(stats.retrievalIntervalDays) === expectedInterval
      && boundedString(stats.lastRetrievalAt, 80)
      && boundedString(stats.durableEvidenceAt, 80)
      && boundedString(stats.durableUntil, 80)
      && Number.isFinite(lastRetrievalAt)
      && Number.isFinite(durableEvidenceAt)
      && lastRetrievalAt === durableEvidenceAt
      && dueAt === durableUntil
      && durableUntil - durableEvidenceAt === expectedInterval * 86_400_000;
  }
  const lastRetrievalAt = stats.lastRetrievalAt ? Date.parse(stats.lastRetrievalAt) : scheduledAt;
  const retryMinutes = (dueAt - Math.max(scheduledAt, lastRetrievalAt)) / 60_000;
  return Number(stats.retrievalIntervalDays || 0) === 0
    && Number.isFinite(lastRetrievalAt)
    && [10, 30, 90, 270, 810, 1_440].includes(retryMinutes)
    && stats.durableEvidenceAt === undefined
    && stats.durableUntil === undefined;
}

function validTaskStats(value: unknown, taskId: string): value is TaskStatsPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const stats = value as Partial<TaskStatsPayload>;
  return boundedInteger(stats.attempts, 10_000)
    && boundedInteger(stats.incorrect, 10_000)
    && boundedInteger(stats.hintsUsed, 10_000)
    && (stats.solutionViews === undefined || boundedInteger(stats.solutionViews, 10_000))
    && (stats.solutionViewedAt === undefined || boundedString(stats.solutionViewedAt, 80))
    && (stats.assistedPasses === undefined || boundedInteger(stats.assistedPasses, 10_000))
    && (stats.lastAssistedAt === undefined || boundedString(stats.lastAssistedAt, 80))
    && (stats.retrievalDueAt === undefined || boundedString(stats.retrievalDueAt, 80))
    && (stats.retrievalEvidenceVersion === undefined || stats.retrievalEvidenceVersion === 'durable-mastery-v1')
    && (stats.retrievalSourceTaskId === undefined || TASK_ID_PATTERN.test(stats.retrievalSourceTaskId))
    && (stats.retrievalScheduledAt === undefined || boundedString(stats.retrievalScheduledAt, 80))
    && (stats.retrievalIntervalDays === undefined || boundedInteger(stats.retrievalIntervalDays, 30))
    && (stats.retrievalSuccesses === undefined || boundedInteger(stats.retrievalSuccesses, 10_000))
    && (stats.retrievalLapses === undefined || boundedInteger(stats.retrievalLapses, 10_000))
    && (stats.lastRetrievalAt === undefined || boundedString(stats.lastRetrievalAt, 80))
    && (stats.lastRetrievalPassed === undefined || typeof stats.lastRetrievalPassed === 'boolean')
    && (stats.durableEvidenceAt === undefined || boundedString(stats.durableEvidenceAt, 80))
    && (stats.durableUntil === undefined || boundedString(stats.durableUntil, 80))
    && (stats.independentPasses === undefined || boundedInteger(stats.independentPasses, 10_000))
    && (stats.lastIndependentAt === undefined || boundedString(stats.lastIndependentAt, 80))
    && validErrorKinds(stats.errorKinds)
    && validTaskCounterComponents(stats)
    && (stats.lastAttemptAt === undefined || typeof stats.lastAttemptAt === 'string')
    && (stats.completedAt === undefined || typeof stats.completedAt === 'string')
    && (stats.evidenceContractVersion === undefined || boundedString(stats.evidenceContractVersion, 96))
    && (stats.evaluationContractId === undefined || boundedString(stats.evaluationContractId, 160))
    && (stats.evaluationContractVersion === undefined || boundedString(stats.evaluationContractVersion, 96))
    && validFixtureIds(stats.validatedFixtureIds)
    && validFixtureIds(stats.hiddenFixtureIds)
    && validRetrievalState(stats, taskId);
}

function validProgress(payload: unknown): payload is ProgressPayload {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false;
  const value = payload as Partial<ProgressPayload>;
  if (value.version !== 4
    || !Array.isArray(value.completed)
    || !value.completed.every(item => typeof item === 'string' && TASK_ID_PATTERN.test(item))
    || !value.taskStats
    || typeof value.taskStats !== 'object'
    || Array.isArray(value.taskStats)
    || !boundedInteger(value.xp)
    || !boundedInteger(value.streak, 100_000)
    || !Array.isArray(value.history)
    || value.history.length > 31) return false;

  return value.history.every(point => point
      && typeof point.day === 'string'
      && point.day.length <= 16
      && boundedInteger(point.solved, 10_000))
    && Object.entries(value.taskStats).every(([taskId, stats]) => TASK_ID_PATTERN.test(taskId) && validTaskStats(stats, taskId))
    && (value.lastTask === undefined || TASK_ID_PATTERN.test(value.lastTask))
    && (value.lastStudyDate === undefined || typeof value.lastStudyDate === 'string');
}

function preservesStoredCounters(previous: ProgressPayload, next: ProgressPayload) {
  return Object.entries(previous.taskStats).every(([taskId, stats]) =>
    preservesTaskCounterComponents(stats, next.taskStats[taskId] || {}));
}

function normalizeUsername(value: unknown) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function validUsername(username: string) {
  return USERNAME_PATTERN.test(username) && !RESERVED_USERNAMES.has(username);
}

function passwordLength(password: string) {
  return Array.from(password).length;
}

function validPassword(password: unknown): password is string {
  if (typeof password !== 'string') return false;
  const length = passwordLength(password);
  return length >= PASSWORD_MIN_LENGTH
    && length <= PASSWORD_MAX_LENGTH
    && new TextEncoder().encode(password).byteLength <= 512;
}

function cleanDisplayName(value: unknown) {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, 48) : '';
}

function cleanDeviceName(value: unknown) {
  const cleaned = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, 64) : '';
  return cleaned || 'Браузер';
}

function sqliteTime(date = new Date()) {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

function parseSqliteTime(value: string | null | undefined) {
  if (!value) return 0;
  return Date.parse(value.includes('T') ? value : `${value.replace(' ', 'T')}Z`);
}

function randomBytes(length: number) {
  return crypto.getRandomValues(new Uint8Array(length));
}

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlToBytes(value: string) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  const binary = atob(padded);
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

function ownedBuffer(bytes: Uint8Array) {
  const owned = new Uint8Array(bytes.byteLength);
  owned.set(bytes);
  return owned.buffer;
}

async function sha256(value: string | Uint8Array) {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  return new Uint8Array(await crypto.subtle.digest('SHA-256', ownedBuffer(bytes)));
}

const PASSWORD_PBKDF2_CHUNK = 100_000;
const PASSWORD_HASH_SCHEME = 'pbkdf2-sha256-chain-v1';

function concatenateBytes(...parts: Uint8Array[]) {
  const output = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }
  return output;
}

async function passwordHash(password: string, saltBase64: string, iterations = PASSWORD_ITERATIONS) {
  if (!Number.isSafeInteger(iterations) || iterations < 1 || iterations > 1_000_000) {
    throw new RangeError('Invalid password KDF iteration count');
  }

  const encoder = new TextEncoder();
  const baseSalt = base64UrlToBytes(saltBase64);
  let material = encoder.encode(password);
  let remaining = iterations;
  let stage = 0;

  while (remaining > 0) {
    const stageIterations = Math.min(PASSWORD_PBKDF2_CHUNK, remaining);
    const stageDomain = encoder.encode(`sql-academy/password-chain/v1:${iterations}:${stage}:`);
    const stageSalt = await sha256(concatenateBytes(stageDomain, baseSalt));
    const key = await crypto.subtle.importKey('raw', ownedBuffer(material), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt: ownedBuffer(stageSalt),
      iterations: stageIterations
    }, key, 256);
    material = new Uint8Array(bits);
    remaining -= stageIterations;
    stage += 1;
  }

  return `${PASSWORD_HASH_SCHEME}:${iterations}:${bytesToBase64Url(material)}`;
}

function constantTimeEqual(left: string, right: string) {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  let difference = leftBytes.length ^ rightBytes.length;
  const length = Math.max(leftBytes.length, rightBytes.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (leftBytes[index] || 0) ^ (rightBytes[index] || 0);
  }
  return difference === 0;
}

function bearerToken(request: Request) {
  const authorization = request.headers.get('authorization') || '';
  const match = authorization.match(/^Bearer\s+([A-Za-z0-9_-]+)$/i);
  return match && SESSION_TOKEN_PATTERN.test(match[1]) ? match[1] : null;
}

async function sessionVerifier(token: string) {
  return bytesToHex(await sha256(`sql-academy/session/v2:${token}`));
}

function encodeRecovery(bytes: Uint8Array) {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += RECOVERY_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
      value &= bits ? (1 << bits) - 1 : 0;
    }
  }
  if (bits) output += RECOVERY_ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

function normalizeRecoveryCode(value: unknown) {
  if (typeof value !== 'string') return '';
  const normalized = value.toUpperCase().replace(/[^A-Z2-9]/g, '');
  return normalized.startsWith('SQLR') ? normalized.slice(4) : normalized;
}

function formatRecoveryCode(raw: string) {
  return `SQLR-${raw.match(/.{1,4}/g)?.join('-') || raw}`;
}

function generateRecoveryCodes() {
  return Array.from({ length: RECOVERY_CODE_COUNT }, () => {
    const raw = encodeRecovery(randomBytes(15)).slice(0, RECOVERY_RAW_LENGTH);
    return formatRecoveryCode(raw);
  });
}

async function recoveryVerifier(code: unknown) {
  const normalized = normalizeRecoveryCode(code);
  if (normalized.length !== RECOVERY_RAW_LENGTH) return null;
  for (const character of normalized) if (!RECOVERY_ALPHABET.includes(character)) return null;
  return bytesToHex(await sha256(`sql-academy/recovery/v1:${normalized}`));
}

async function readJson(request: Request) {
  try {
    return await request.json<unknown>();
  } catch {
    return null;
  }
}

function recoveryStatements(env: Cloudflare.Env, userId: string, generation: number, codes: string[]) {
  return Promise.all(codes.map(async (code, index) => env.DB.prepare(`INSERT INTO recovery_codes(
      user_id, code_id, code_verifier, generation, created_at
    ) VALUES(?, ?, ?, ?, ?)`).bind(
      userId,
      `${generation}-${index + 1}`,
      await recoveryVerifier(code),
      generation,
      sqliteTime()
    )));
}

function newSession(userId: string, deviceName: string) {
  const token = bytesToBase64Url(randomBytes(32));
  const expires = new Date(Date.now() + SESSION_HOURS * 3_600_000);
  return {
    token,
    sessionId: crypto.randomUUID(),
    userId,
    deviceName,
    expiresAt: sqliteTime(expires)
  };
}

async function insertSession(env: Cloudflare.Env, session: ReturnType<typeof newSession>) {
  await env.DB.prepare(`INSERT INTO auth_sessions(
    session_id, user_id, token_verifier, device_name, expires_at
  ) VALUES(?, ?, ?, ?, ?)`).bind(
    session.sessionId,
    session.userId,
    await sessionVerifier(session.token),
    session.deviceName,
    session.expiresAt
  ).run();
}

function publicUser(row: SessionRow | UserRow, profile?: { display_name?: string; daily_minutes?: number; locale?: string; theme?: string }) {
  const source = 'display_name' in row ? row : profile || {};
  return {
    id: row.user_id,
    username: row.username,
    displayName: source.display_name || '',
    dailyMinutes: PROFILE_MINUTES.has(Number(source.daily_minutes)) ? Number(source.daily_minutes) : 25,
    locale: PROFILE_LOCALES.has(String(source.locale)) ? source.locale : 'ru-RU',
    theme: PROFILE_THEMES.has(String(source.theme)) ? source.theme : 'dark'
  };
}

async function recoverySummary(env: Cloudflare.Env, userId: string) {
  const user = await env.DB.prepare(`SELECT recovery_generation, recovery_generated_at
    FROM users WHERE user_id = ?`).bind(userId)
    .first<{ recovery_generation: number; recovery_generated_at: string }>();
  const remaining = await env.DB.prepare(`SELECT COUNT(*) AS count FROM recovery_codes
    WHERE user_id = ? AND generation = ? AND used_at IS NULL`).bind(userId, user?.recovery_generation || 0)
    .first<{ count: number }>();
  const next = new Date(parseSqliteTime(user?.recovery_generated_at) + 86_400_000);
  return {
    remaining: Number(remaining?.count) || 0,
    generatedAt: user?.recovery_generated_at || null,
    canRegenerateAt: Number.isFinite(next.getTime()) ? sqliteTime(next) : null
  };
}

async function progressRevision(env: Cloudflare.Env, userId: string) {
  const progress = await env.DB.prepare('SELECT revision FROM progress WHERE profile_id = ?')
    .bind(userId).first<{ revision: number }>();
  return progress?.revision || 0;
}

function authPayload(row: SessionRow | UserRow, session: ReturnType<typeof newSession>, revision: number, profile?: { display_name?: string; daily_minutes?: number; locale?: string; theme?: string }) {
  return {
    session: {
      token: session.token,
      id: session.sessionId,
      expiresAt: session.expiresAt,
      deviceName: session.deviceName,
      revision
    },
    user: publicUser(row, profile)
  };
}

export async function authenticateSession(request: Request, env: Cloudflare.Env): Promise<AuthenticatedUser | Response> {
  const token = bearerToken(request);
  if (!token) return json({ error: 'Authentication is required' }, 401);
  const verifier = await sessionVerifier(token);
  const row = await env.DB.prepare(`SELECT
      s.session_id, s.user_id, s.device_name, s.created_at, s.last_seen_at, s.expires_at,
      u.username, p.display_name, p.daily_minutes, p.locale, p.theme
    FROM auth_sessions s
    JOIN users u ON u.user_id = s.user_id
    JOIN user_profiles p ON p.user_id = s.user_id
    WHERE s.token_verifier = ?`).bind(verifier).first<SessionRow>();
  if (!row) return json({ error: 'Authentication is required' }, 401);
  if (parseSqliteTime(row.expires_at) <= Date.now()) {
    await env.DB.prepare('DELETE FROM auth_sessions WHERE session_id = ?').bind(row.session_id).run();
    return json({ error: 'Session expired' }, 401);
  }
  if (parseSqliteTime(row.last_seen_at) < Date.now() - 600_000) {
    await env.DB.prepare(`UPDATE auth_sessions SET last_seen_at = ? WHERE session_id = ?`)
      .bind(sqliteTime(), row.session_id).run();
  }
  return {
    userId: row.user_id,
    username: row.username,
    sessionId: row.session_id,
    deviceName: row.device_name,
    expiresAt: row.expires_at,
    displayName: row.display_name || '',
    dailyMinutes: PROFILE_MINUTES.has(row.daily_minutes) ? row.daily_minutes as 15 | 25 | 40 : 25,
    locale: PROFILE_LOCALES.has(row.locale) ? row.locale as 'ru-RU' | 'en-US' : 'ru-RU',
    theme: PROFILE_THEMES.has(row.theme) ? row.theme as 'dark' | 'light' | 'system' : 'dark'
  };
}

async function register(request: Request, env: Cloudflare.Env) {
  const body = await readJson(request) as {
    username?: unknown;
    password?: unknown;
    displayName?: unknown;
    deviceName?: unknown;
  } | null;
  const username = normalizeUsername(body?.username);
  const password = body?.password;
  if (!validUsername(username)) return json({ error: 'Логин должен содержать 3–32 символа: a–z, 0–9, точка, дефис или подчёркивание.' }, 400);
  if (!validPassword(password)) return json({ error: `Пароль должен содержать от ${PASSWORD_MIN_LENGTH} до ${PASSWORD_MAX_LENGTH} символов.` }, 400);

  const existing = await env.DB.prepare('SELECT 1 AS found FROM users WHERE username = ? COLLATE NOCASE')
    .bind(username).first<{ found: number }>();
  if (existing) return json({ error: 'Этот логин уже занят.' }, 409);

  const userId = crypto.randomUUID();
  const salt = bytesToBase64Url(randomBytes(16));
  const hash = await passwordHash(password, salt);
  const codes = generateRecoveryCodes();
  const generation = 1;
  const session = newSession(userId, cleanDeviceName(body?.deviceName));
  const codeStatements = await recoveryStatements(env, userId, generation, codes);
  const now = sqliteTime();
  const sessionVerifierValue = await sessionVerifier(session.token);

  try {
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO users(
        user_id, username, password_salt, password_hash, password_iterations,
        recovery_generation, recovery_generated_at, created_at, updated_at, password_changed_at
      ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
        userId, username, salt, hash, PASSWORD_ITERATIONS, generation, now, now, now, now
      ),
      env.DB.prepare(`INSERT INTO user_profiles(user_id, display_name) VALUES(?, ?)`)
        .bind(userId, cleanDisplayName(body?.displayName)),
      ...codeStatements,
      env.DB.prepare(`INSERT INTO auth_sessions(
        session_id, user_id, token_verifier, device_name, created_at, last_seen_at, expires_at
      ) VALUES(?, ?, ?, ?, ?, ?, ?)`).bind(
        session.sessionId, userId, sessionVerifierValue, session.deviceName, now, now, session.expiresAt
      )
    ]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.toLowerCase().includes('unique')) return json({ error: 'Этот логин уже занят.' }, 409);
    return json({ error: 'Не удалось создать аккаунт.' }, 500);
  }

  return json({
    ...authPayload({ user_id: userId, username } as UserRow, session, 0, {
      display_name: cleanDisplayName(body?.displayName), daily_minutes: 25, locale: 'ru-RU', theme: 'dark'
    }),
    recoveryCodes: codes,
    recovery: { remaining: RECOVERY_CODE_COUNT, generatedAt: now, canRegenerateAt: sqliteTime(new Date(Date.now() + 86_400_000)) }
  }, 201);
}

const DUMMY_SALT = bytesToBase64Url(new Uint8Array(16).fill(73));

async function login(request: Request, env: Cloudflare.Env) {
  const body = await readJson(request) as { username?: unknown; password?: unknown; deviceName?: unknown } | null;
  const username = normalizeUsername(body?.username);
  const password = typeof body?.password === 'string' ? body.password : '';
  const user = await env.DB.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE')
    .bind(username).first<UserRow>();

  if (user?.locked_until && parseSqliteTime(user.locked_until) > Date.now()) {
    const seconds = Math.max(1, Math.ceil((parseSqliteTime(user.locked_until) - Date.now()) / 1000));
    return json({ error: 'Не удалось войти. Проверь данные или попробуй позже.' }, 429, { 'retry-after': String(seconds) });
  }

  const computed = await passwordHash(password, user?.password_salt || DUMMY_SALT, user?.password_iterations || PASSWORD_ITERATIONS);
  if (!user || !validPassword(password) || !constantTimeEqual(computed, user.password_hash)) {
    if (user) {
      const failures = user.failed_login_count + 1;
      const lockedUntil = failures >= LOGIN_FAILURE_LIMIT
        ? sqliteTime(new Date(Date.now() + LOGIN_LOCK_MINUTES * 60_000))
        : null;
      await env.DB.prepare(`UPDATE users SET failed_login_count = ?, locked_until = ?, updated_at = ? WHERE user_id = ?`)
        .bind(failures, lockedUntil, sqliteTime(), user.user_id).run();
    }
    return json({ error: 'Не удалось войти. Проверь логин и пароль.' }, 401);
  }

  await env.DB.prepare(`UPDATE users SET failed_login_count = 0, locked_until = NULL, updated_at = ? WHERE user_id = ?`)
    .bind(sqliteTime(), user.user_id).run();
  const session = newSession(user.user_id, cleanDeviceName(body?.deviceName));
  await insertSession(env, session);
  const profile = await env.DB.prepare('SELECT display_name, daily_minutes, locale, theme FROM user_profiles WHERE user_id = ?')
    .bind(user.user_id).first<{ display_name: string; daily_minutes: number; locale: string; theme: string }>();
  return json({
    ...authPayload(user, session, await progressRevision(env, user.user_id), profile || undefined),
    recovery: await recoverySummary(env, user.user_id)
  });
}

async function resetPassword(request: Request, env: Cloudflare.Env) {
  const body = await readJson(request) as { username?: unknown; recoveryCode?: unknown; newPassword?: unknown } | null;
  const username = normalizeUsername(body?.username);
  const newPassword = body?.newPassword;
  if (!validPassword(newPassword)) return json({ error: `Новый пароль должен содержать от ${PASSWORD_MIN_LENGTH} до ${PASSWORD_MAX_LENGTH} символов.` }, 400);
  const verifier = await recoveryVerifier(body?.recoveryCode);
  const user = await env.DB.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE')
    .bind(username).first<UserRow>();
  if (!user || !verifier) return json({ error: 'Логин или recovery-код не подошёл.' }, 400);
  const code = await env.DB.prepare(`SELECT code_id FROM recovery_codes
    WHERE user_id = ? AND generation = ? AND code_verifier = ? AND used_at IS NULL`)
    .bind(user.user_id, user.recovery_generation, verifier).first<{ code_id: string }>();
  if (!code) return json({ error: 'Логин или recovery-код не подошёл.' }, 400);

  const consumed = await env.DB.prepare(`UPDATE recovery_codes SET used_at = ?
    WHERE user_id = ? AND code_id = ? AND used_at IS NULL`).bind(sqliteTime(), user.user_id, code.code_id).run();
  if ((consumed.meta.changes || 0) !== 1) return json({ error: 'Recovery-код уже использован.' }, 409);

  const salt = bytesToBase64Url(randomBytes(16));
  const hash = await passwordHash(newPassword, salt);
  const now = sqliteTime();
  await env.DB.batch([
    env.DB.prepare(`UPDATE users SET password_salt = ?, password_hash = ?, password_iterations = ?,
      password_changed_at = ?, updated_at = ?, failed_login_count = 0, locked_until = NULL WHERE user_id = ?`)
      .bind(salt, hash, PASSWORD_ITERATIONS, now, now, user.user_id),
    env.DB.prepare('DELETE FROM auth_sessions WHERE user_id = ?').bind(user.user_id)
  ]);
  return json({ ok: true, message: 'Пароль изменён. Войди с новым паролем.' });
}

async function sessionInfo(request: Request, env: Cloudflare.Env, auth: AuthenticatedUser) {
  return json({
    user: {
      id: auth.userId,
      username: auth.username,
      displayName: auth.displayName,
      dailyMinutes: auth.dailyMinutes,
      locale: auth.locale,
      theme: auth.theme
    },
    session: {
      id: auth.sessionId,
      deviceName: auth.deviceName,
      expiresAt: auth.expiresAt,
      revision: await progressRevision(env, auth.userId)
    },
    recovery: await recoverySummary(env, auth.userId)
  });
}

async function logout(env: Cloudflare.Env, auth: AuthenticatedUser) {
  await env.DB.prepare('DELETE FROM auth_sessions WHERE session_id = ?').bind(auth.sessionId).run();
  return json({ ok: true });
}

async function listSessions(env: Cloudflare.Env, auth: AuthenticatedUser) {
  const rows = await env.DB.prepare(`SELECT session_id, device_name, created_at, last_seen_at, expires_at
    FROM auth_sessions WHERE user_id = ? ORDER BY last_seen_at DESC`).bind(auth.userId)
    .all<{ session_id: string; device_name: string; created_at: string; last_seen_at: string; expires_at: string }>();
  return json({ sessions: rows.results.map(row => ({
    id: row.session_id,
    deviceName: row.device_name,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
    expiresAt: row.expires_at,
    current: row.session_id === auth.sessionId
  })) });
}

async function revokeSession(env: Cloudflare.Env, auth: AuthenticatedUser, sessionId: string) {
  const result = await env.DB.prepare('DELETE FROM auth_sessions WHERE user_id = ? AND session_id = ?')
    .bind(auth.userId, sessionId).run();
  if ((result.meta.changes || 0) !== 1) return json({ error: 'Сессия не найдена.' }, 404);
  return json({ ok: true, currentSessionRevoked: sessionId === auth.sessionId });
}

async function verifyCurrentPassword(env: Cloudflare.Env, auth: AuthenticatedUser, password: unknown) {
  if (typeof password !== 'string') return null;
  const user = await env.DB.prepare('SELECT * FROM users WHERE user_id = ?').bind(auth.userId).first<UserRow>();
  if (!user) return null;
  const computed = await passwordHash(password, user.password_salt, user.password_iterations);
  return constantTimeEqual(computed, user.password_hash) ? user : null;
}

async function changePassword(request: Request, env: Cloudflare.Env, auth: AuthenticatedUser) {
  const body = await readJson(request) as { currentPassword?: unknown; recoveryCode?: unknown; newPassword?: unknown } | null;
  if (!validPassword(body?.newPassword)) return json({ error: `Новый пароль должен содержать от ${PASSWORD_MIN_LENGTH} до ${PASSWORD_MAX_LENGTH} символов.` }, 400);
  const user = await verifyCurrentPassword(env, auth, body?.currentPassword);
  const verifier = await recoveryVerifier(body?.recoveryCode);
  if (!user || !verifier) return json({ error: 'Текущий пароль или recovery-код не подошёл.' }, 400);
  const currentHash = await passwordHash(body.newPassword, user.password_salt, user.password_iterations);
  if (constantTimeEqual(currentHash, user.password_hash)) return json({ error: 'Новый пароль должен отличаться от текущего.' }, 400);
  const code = await env.DB.prepare(`SELECT code_id FROM recovery_codes
    WHERE user_id = ? AND generation = ? AND code_verifier = ? AND used_at IS NULL`)
    .bind(user.user_id, user.recovery_generation, verifier).first<{ code_id: string }>();
  if (!code) return json({ error: 'Текущий пароль или recovery-код не подошёл.' }, 400);
  const consumed = await env.DB.prepare(`UPDATE recovery_codes SET used_at = ?
    WHERE user_id = ? AND code_id = ? AND used_at IS NULL`).bind(sqliteTime(), user.user_id, code.code_id).run();
  if ((consumed.meta.changes || 0) !== 1) return json({ error: 'Recovery-код уже использован.' }, 409);

  const salt = bytesToBase64Url(randomBytes(16));
  const hash = await passwordHash(body.newPassword, salt);
  const now = sqliteTime();
  await env.DB.batch([
    env.DB.prepare(`UPDATE users SET password_salt = ?, password_hash = ?, password_iterations = ?,
      password_changed_at = ?, updated_at = ?, failed_login_count = 0, locked_until = NULL WHERE user_id = ?`)
      .bind(salt, hash, PASSWORD_ITERATIONS, now, now, user.user_id),
    env.DB.prepare('DELETE FROM auth_sessions WHERE user_id = ?').bind(user.user_id)
  ]);
  return json({ ok: true, message: 'Пароль изменён. Все устройства отключены.' });
}

async function regenerateRecoveryCodes(request: Request, env: Cloudflare.Env, auth: AuthenticatedUser) {
  const body = await readJson(request) as { currentPassword?: unknown } | null;
  const user = await verifyCurrentPassword(env, auth, body?.currentPassword);
  if (!user) return json({ error: 'Текущий пароль не подошёл.' }, 400);
  const nextAllowed = parseSqliteTime(user.recovery_generated_at) + 86_400_000;
  if (nextAllowed > Date.now()) {
    return json({
      error: 'Новый комплект recovery-кодов можно создать только один раз в сутки.',
      canRegenerateAt: sqliteTime(new Date(nextAllowed))
    }, 429, { 'retry-after': String(Math.ceil((nextAllowed - Date.now()) / 1000)) });
  }

  const generation = user.recovery_generation + 1;
  const codes = generateRecoveryCodes();
  const now = sqliteTime();
  const updated = await env.DB.prepare(`UPDATE users SET recovery_generation = ?, recovery_generated_at = ?, updated_at = ?
    WHERE user_id = ? AND recovery_generation = ?`).bind(generation, now, now, auth.userId, user.recovery_generation).run();
  if ((updated.meta.changes || 0) !== 1) return json({ error: 'Комплект уже был обновлён. Обнови страницу.' }, 409);
  const statements = await recoveryStatements(env, auth.userId, generation, codes);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM recovery_codes WHERE user_id = ?').bind(auth.userId),
    ...statements
  ]);
  return json({
    recoveryCodes: codes,
    recovery: {
      remaining: RECOVERY_CODE_COUNT,
      generatedAt: now,
      canRegenerateAt: sqliteTime(new Date(Date.now() + 86_400_000))
    }
  });
}

async function profile(request: Request, env: Cloudflare.Env, auth: AuthenticatedUser) {
  if (request.method === 'GET') return sessionInfo(request, env, auth);
  if (request.method !== 'PUT') return json({ error: 'Method not allowed' }, 405, { allow: 'GET, PUT, DELETE' });
  const body = await readJson(request) as { displayName?: unknown; dailyMinutes?: unknown; locale?: unknown; theme?: unknown } | null;
  const displayName = cleanDisplayName(body?.displayName);
  const dailyMinutes = Number(body?.dailyMinutes);
  const locale = String(body?.locale || '');
  const theme = String(body?.theme || '');
  if (!PROFILE_MINUTES.has(dailyMinutes) || !PROFILE_LOCALES.has(locale) || !PROFILE_THEMES.has(theme)) {
    return json({ error: 'Некорректные настройки профиля.' }, 400);
  }
  await env.DB.prepare(`UPDATE user_profiles SET display_name = ?, daily_minutes = ?, locale = ?, theme = ?, updated_at = ?
    WHERE user_id = ?`).bind(displayName, dailyMinutes, locale, theme, sqliteTime(), auth.userId).run();
  return json({ ok: true, user: { id: auth.userId, username: auth.username, displayName, dailyMinutes, locale, theme } });
}

async function deleteProfile(request: Request, env: Cloudflare.Env, auth: AuthenticatedUser) {
  const body = await readJson(request) as { currentPassword?: unknown; recoveryCode?: unknown; confirm?: unknown } | null;
  if (body?.confirm !== 'DELETE') return json({ error: 'Нужно подтверждение DELETE.' }, 400);
  const user = await verifyCurrentPassword(env, auth, body?.currentPassword);
  const verifier = await recoveryVerifier(body?.recoveryCode);
  if (!user || !verifier) return json({ error: 'Пароль или recovery-код не подошёл.' }, 400);
  const code = await env.DB.prepare(`SELECT code_id FROM recovery_codes
    WHERE user_id = ? AND generation = ? AND code_verifier = ? AND used_at IS NULL`)
    .bind(auth.userId, user.recovery_generation, verifier).first<{ code_id: string }>();
  if (!code) return json({ error: 'Пароль или recovery-код не подошёл.' }, 400);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM progress WHERE profile_id = ?').bind(auth.userId),
    env.DB.prepare('DELETE FROM auth_sessions WHERE user_id = ?').bind(auth.userId),
    env.DB.prepare('DELETE FROM recovery_codes WHERE user_id = ?').bind(auth.userId),
    env.DB.prepare('DELETE FROM user_profiles WHERE user_id = ?').bind(auth.userId),
    env.DB.prepare('DELETE FROM users WHERE user_id = ?').bind(auth.userId)
  ]);
  await env.SETTINGS?.delete(`settings:${auth.userId}`);
  return json({ ok: true });
}

async function userProgress(request: Request, env: Cloudflare.Env, auth: AuthenticatedUser) {
  if (request.method === 'GET') {
    const row = await env.DB.prepare('SELECT payload, revision, updated_at FROM progress WHERE profile_id = ?')
      .bind(auth.userId).first<{ payload: string; revision: number; updated_at: string }>();
    if (!row) return json({ progress: null, revision: 0, updatedAt: null });
    try {
      return json({ progress: JSON.parse(row.payload), revision: row.revision || 0, updatedAt: row.updated_at });
    } catch {
      return json({ error: 'Stored progress is corrupted' }, 500);
    }
  }
  if (request.method !== 'PUT') return json({ error: 'Method not allowed' }, 405, { allow: 'GET, PUT' });
  const body = await readJson(request) as { progress?: unknown; baseRevision?: unknown } | null;
  if (!body || !validProgress(body.progress) || !boundedInteger(body.baseRevision, 1_000_000)) {
    return json({ error: 'Invalid progress sync payload' }, 400);
  }
  const serialized = JSON.stringify(body.progress);
  if (new TextEncoder().encode(serialized).byteLength > MAX_PROGRESS_BYTES) return json({ error: 'Progress payload is too large' }, 413);

  if (body.baseRevision === 0) {
    const inserted = await env.DB.prepare(`INSERT OR IGNORE INTO progress(profile_id, payload, updated_at, revision)
      VALUES(?, ?, ?, 1)`).bind(auth.userId, serialized, sqliteTime()).run();
    if ((inserted.meta.changes || 0) !== 1) {
      const current = await env.DB.prepare('SELECT revision, updated_at FROM progress WHERE profile_id = ?')
        .bind(auth.userId).first<{ revision: number; updated_at: string }>();
      return json({ error: 'Progress conflict', revision: current?.revision || 0, updatedAt: current?.updated_at || null }, 409);
    }
  } else {
    const existing = await env.DB.prepare('SELECT payload, revision, updated_at FROM progress WHERE profile_id = ?')
      .bind(auth.userId).first<{ payload: string; revision: number; updated_at: string }>();
    if (!existing || existing.revision !== body.baseRevision) {
      return json({ error: 'Progress conflict', revision: existing?.revision || 0, updatedAt: existing?.updated_at || null }, 409);
    }
    let previous: ProgressPayload;
    try {
      previous = JSON.parse(existing.payload) as ProgressPayload;
    } catch {
      return json({ error: 'Stored progress is corrupted' }, 500);
    }
    if (!preservesStoredCounters(previous, body.progress)) {
      return json({
        error: 'Progress counter components are stale',
        code: 'PROGRESS_COUNTERS_STALE',
        revision: existing.revision,
        updatedAt: existing.updated_at
      }, 409);
    }
    const updated = await env.DB.prepare(`UPDATE progress SET payload = ?, updated_at = ?, revision = revision + 1
      WHERE profile_id = ? AND revision = ?`).bind(serialized, sqliteTime(), auth.userId, body.baseRevision).run();
    if ((updated.meta.changes || 0) !== 1) {
      const current = await env.DB.prepare('SELECT revision, updated_at FROM progress WHERE profile_id = ?')
        .bind(auth.userId).first<{ revision: number; updated_at: string }>();
      return json({ error: 'Progress conflict', revision: current?.revision || 0, updatedAt: current?.updated_at || null }, 409);
    }
  }
  const current = await env.DB.prepare('SELECT revision, updated_at FROM progress WHERE profile_id = ?')
    .bind(auth.userId).first<{ revision: number; updated_at: string }>();
  return json({ ok: true, revision: current?.revision || 0, updatedAt: current?.updated_at || null });
}

export async function handleAuthRequest(request: Request, env: Cloudflare.Env): Promise<Response | null> {
  const url = new URL(request.url);
  const authPath = url.pathname.startsWith('/api/auth');
  const profilePath = url.pathname === '/api/profile';
  const progressPath = url.pathname === '/api/user/progress';
  if (!authPath && !profilePath && !progressPath) return null;
  if (!env.DB) return json({ error: 'D1 binding is not configured' }, 503);

  if (url.pathname === '/api/auth/register' && request.method === 'POST') return register(request, env);
  if (url.pathname === '/api/auth/login' && request.method === 'POST') return login(request, env);
  if (url.pathname === '/api/auth/password/reset' && request.method === 'POST') return resetPassword(request, env);

  const auth = await authenticateSession(request, env);
  if (auth instanceof Response) return auth;

  if (url.pathname === '/api/auth/session' && request.method === 'GET') return sessionInfo(request, env, auth);
  if (url.pathname === '/api/auth/logout' && request.method === 'POST') return logout(env, auth);
  if (url.pathname === '/api/auth/sessions' && request.method === 'GET') return listSessions(env, auth);
  if (url.pathname.startsWith('/api/auth/sessions/') && request.method === 'DELETE') {
    return revokeSession(env, auth, decodeURIComponent(url.pathname.slice('/api/auth/sessions/'.length)));
  }
  if (url.pathname === '/api/auth/password/change' && request.method === 'POST') return changePassword(request, env, auth);
  if (url.pathname === '/api/auth/recovery/regenerate' && request.method === 'POST') return regenerateRecoveryCodes(request, env, auth);
  if (profilePath && request.method === 'DELETE') return deleteProfile(request, env, auth);
  if (profilePath) return profile(request, env, auth);
  if (progressPath) return userProgress(request, env, auth);
  return json({ error: 'Not found' }, 404);
}
