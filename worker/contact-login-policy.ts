import {
  configuredContactRegistrationPolicy,
  contactRegistrationPolicyReady,
  type CommercialEnvironment
} from './commercial-capabilities';
import {
  contactDestinationDigest,
  contactVerificationReady,
  type ContactVerificationEnvironment
} from './contact-verification';

type ContactLoginEnvironment = CommercialEnvironment & ContactVerificationEnvironment;
type ContactIdentifierType = 'email' | 'sms';

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
};

type ProfileRow = {
  display_name: string;
  daily_minutes: number;
  locale: string;
  theme: string;
};

const PASSWORD_MIN_LENGTH = 15;
const PASSWORD_MAX_LENGTH = 128;
const PASSWORD_ITERATIONS = 600_000;
const PASSWORD_PBKDF2_CHUNK = 100_000;
const PASSWORD_HASH_SCHEME = 'pbkdf2-sha256-chain-v1';
const LOGIN_FAILURE_LIMIT = 5;
const LOGIN_LOCK_MINUTES = 15;
const SESSION_DAYS = 30;
const MAX_JSON_BYTES = 4_096;
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
    'x-contact-login-contract': 'contact-login-v1',
    ...headers
  }
});

function sqliteTime(date = new Date()) {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

function parseSqliteTime(value: string | null | undefined) {
  if (!value) return 0;
  return Date.parse(value.includes('T') ? value : `${value.replace(' ', 'T')}Z`);
}

function cleanDeviceName(value: unknown) {
  const cleaned = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, 64) : '';
  return cleaned || 'Браузер';
}

function validPassword(password: unknown): password is string {
  if (typeof password !== 'string') return false;
  const length = Array.from(password).length;
  return length >= PASSWORD_MIN_LENGTH
    && length <= PASSWORD_MAX_LENGTH
    && new TextEncoder().encode(password).byteLength <= 512;
}

async function boundedJson(request: Request) {
  const declared = Number(request.headers.get('content-length') || 0);
  if (Number.isFinite(declared) && declared > MAX_JSON_BYTES) return null;
  try {
    const text = await request.text();
    if (new TextEncoder().encode(text).byteLength > MAX_JSON_BYTES) return null;
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
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
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function concatenateBytes(...parts: Uint8Array[]) {
  const output = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }
  return output;
}

async function sha256(value: string | Uint8Array) {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  return new Uint8Array(await crypto.subtle.digest('SHA-256', ownedBuffer(bytes)));
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

function newSession(userId: string, deviceNameValue: unknown) {
  const token = bytesToBase64Url(randomBytes(32));
  return {
    token,
    sessionId: crypto.randomUUID(),
    userId,
    deviceName: cleanDeviceName(deviceNameValue),
    expiresAt: sqliteTime(new Date(Date.now() + SESSION_DAYS * 86_400_000))
  };
}

async function sessionVerifier(token: string) {
  return bytesToHex(await sha256(`sql-academy/session/v2:${token}`));
}

async function insertSession(env: ContactLoginEnvironment, session: ReturnType<typeof newSession>) {
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

async function progressRevision(env: ContactLoginEnvironment, userId: string) {
  const row = await env.DB.prepare('SELECT revision FROM progress WHERE profile_id = ?')
    .bind(userId).first<{ revision: number }>();
  return row?.revision || 0;
}

async function recoverySummary(env: ContactLoginEnvironment, user: UserRow) {
  const remaining = await env.DB.prepare(`SELECT COUNT(*) AS count FROM recovery_codes
    WHERE user_id = ? AND generation = ? AND used_at IS NULL`)
    .bind(user.user_id, user.recovery_generation).first<{ count: number }>();
  const next = new Date(parseSqliteTime(user.recovery_generated_at) + 86_400_000);
  return {
    remaining: Number(remaining?.count) || 0,
    generatedAt: user.recovery_generated_at || null,
    canRegenerateAt: Number.isFinite(next.getTime()) ? sqliteTime(next) : null
  };
}

function publicUser(user: UserRow, profile: ProfileRow | null) {
  return {
    id: user.user_id,
    username: user.username,
    displayName: profile?.display_name || '',
    dailyMinutes: PROFILE_MINUTES.has(Number(profile?.daily_minutes)) ? Number(profile?.daily_minutes) : 25,
    locale: PROFILE_LOCALES.has(String(profile?.locale)) ? profile?.locale : 'ru-RU',
    theme: PROFILE_THEMES.has(String(profile?.theme)) ? profile?.theme : 'dark'
  };
}

async function userByVerifiedContact(
  channel: ContactIdentifierType,
  identifier: unknown,
  env: ContactLoginEnvironment
) {
  if (!contactVerificationReady(channel, env)) return null;
  const digest = await contactDestinationDigest(channel, identifier, env);
  if (!digest) return null;
  return env.DB.prepare(`SELECT u.* FROM verified_contacts c
    JOIN users u ON u.user_id = c.user_id
    WHERE c.channel = ? AND c.destination_digest = ?
    LIMIT 1`).bind(channel, digest).first<UserRow>();
}

async function loginWithVerifiedContact(
  body: { identifierType?: unknown; identifier?: unknown; password?: unknown; deviceName?: unknown },
  env: ContactLoginEnvironment
) {
  const channel = body.identifierType as ContactIdentifierType;
  const password = typeof body.password === 'string' ? body.password : '';
  const user = await userByVerifiedContact(channel, body.identifier, env);

  if (user?.locked_until && parseSqliteTime(user.locked_until) > Date.now()) {
    const seconds = Math.max(1, Math.ceil((parseSqliteTime(user.locked_until) - Date.now()) / 1000));
    return json({ error: 'Не удалось войти. Проверь данные или попробуй позже.' }, 429, { 'retry-after': String(seconds) });
  }

  const dummySalt = bytesToBase64Url(new Uint8Array(16).fill(73));
  const computed = await passwordHash(password, user?.password_salt || dummySalt, user?.password_iterations || PASSWORD_ITERATIONS);
  if (!user || !validPassword(password) || !constantTimeEqual(computed, user.password_hash)) {
    if (user) {
      const failures = user.failed_login_count + 1;
      const lockedUntil = failures >= LOGIN_FAILURE_LIMIT
        ? sqliteTime(new Date(Date.now() + LOGIN_LOCK_MINUTES * 60_000))
        : null;
      await env.DB.prepare(`UPDATE users SET failed_login_count = ?, locked_until = ?, updated_at = ? WHERE user_id = ?`)
        .bind(failures, lockedUntil, sqliteTime(), user.user_id).run();
    }
    return json({ error: 'Не удалось войти. Проверь идентификатор и пароль.' }, 401);
  }

  await env.DB.prepare(`UPDATE users SET failed_login_count = 0, locked_until = NULL, updated_at = ? WHERE user_id = ?`)
    .bind(sqliteTime(), user.user_id).run();
  const session = newSession(user.user_id, body.deviceName);
  await insertSession(env, session);
  const profile = await env.DB.prepare('SELECT display_name, daily_minutes, locale, theme FROM user_profiles WHERE user_id = ?')
    .bind(user.user_id).first<ProfileRow>();
  return json({
    session: {
      token: session.token,
      id: session.sessionId,
      expiresAt: session.expiresAt,
      deviceName: session.deviceName,
      revision: await progressRevision(env, user.user_id)
    },
    user: publicUser(user, profile || null),
    recovery: await recoverySummary(env, user)
  });
}

export async function handleContactLoginPolicyRequest(
  request: Request,
  env: ContactLoginEnvironment
): Promise<Response | null> {
  const url = new URL(request.url);

  if (url.pathname === '/api/auth/register' && request.method === 'POST') {
    const policy = configuredContactRegistrationPolicy(env);
    if (policy === 'optional') return null;
    if (!contactRegistrationPolicyReady(env)) {
      return json({
        error: 'Регистрация временно недоступна: политика подтверждённого контакта настроена не полностью.',
        code: 'CONTACT_REGISTRATION_POLICY_UNAVAILABLE'
      }, 503);
    }
    return json({
      error: 'Для нового аккаунта требуется подтверждённый email или телефон.',
      code: 'VERIFIED_CONTACT_REQUIRED',
      registrationEndpoint: '/api/contact/account/register'
    }, 409);
  }

  if (url.pathname !== '/api/auth/login' || request.method !== 'POST') return null;
  const body = await boundedJson(request.clone()) as {
    identifierType?: unknown;
    identifier?: unknown;
    password?: unknown;
    deviceName?: unknown;
  } | null;
  if (!body || (body.identifierType !== 'email' && body.identifierType !== 'sms')) return null;
  return loginWithVerifiedContact(body, env);
}
