import { authenticateSession, type AuthenticatedUser } from './auth';
import {
  contactVerificationReady,
  verifyContactVerificationTicket,
  type ContactVerificationEnvironment,
  type ContactVerificationTicketPayload
} from './contact-verification';

type UserRow = {
  user_id: string;
  username: string;
  password_salt: string;
  password_hash: string;
  password_iterations: number;
  recovery_generation: number;
  recovery_generated_at: string;
};

type ChallengeRow = {
  masked_destination: string;
  confirmed_at: string;
};

type VerifiedContactRow = {
  contact_id: string;
  channel: 'email' | 'sms';
  masked_destination: string;
  verified_at: string;
  created_at: string;
};

type PreparedTicket = ContactVerificationTicketPayload & {
  maskedDestination: string;
  verifiedAt: string;
};

const USERNAME_PATTERN = /^[a-z0-9](?:[a-z0-9._-]{1,30}[a-z0-9])?$/;
const RESERVED_USERNAMES = new Set(['admin', 'administrator', 'root', 'system', 'support', 'sqlacademy', 'sql-academy', 'api', 'security']);
const RECOVERY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const RECOVERY_RAW_LENGTH = 24;
const RECOVERY_CODE_COUNT = 8;
const PASSWORD_MIN_LENGTH = 15;
const PASSWORD_MAX_LENGTH = 128;
const PASSWORD_ITERATIONS = 600_000;
const PASSWORD_PBKDF2_CHUNK = 100_000;
const PASSWORD_HASH_SCHEME = 'pbkdf2-sha256-chain-v1';
const SESSION_DAYS = 30;
const MAX_JSON_BYTES = 12_000;

const json = (data: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(data), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'x-contact-account-contract': 'contact-account-v1',
    ...headers
  }
});

function sqliteTime(date = new Date()) {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

function normalizeUsername(value: unknown) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function validUsername(username: string) {
  return USERNAME_PATTERN.test(username) && !RESERVED_USERNAMES.has(username);
}

function validPassword(password: unknown): password is string {
  if (typeof password !== 'string') return false;
  const length = Array.from(password).length;
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

async function readJson(request: Request) {
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
  for (let index = 0; index < length; index += 1) difference |= (leftBytes[index] || 0) ^ (rightBytes[index] || 0);
  return difference === 0;
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

function formatRecoveryCode(raw: string) {
  return `SQLR-${raw.match(/.{1,4}/g)?.join('-') || raw}`;
}

function generateRecoveryCodes() {
  return Array.from({ length: RECOVERY_CODE_COUNT }, () =>
    formatRecoveryCode(encodeRecovery(randomBytes(15)).slice(0, RECOVERY_RAW_LENGTH)));
}

async function recoveryVerifier(code: string) {
  const normalized = code.toUpperCase().replace(/[^A-Z2-9]/g, '').replace(/^SQLR/, '');
  return bytesToHex(await sha256(`sql-academy/recovery/v1:${normalized}`));
}

async function recoveryStatements(env: ContactVerificationEnvironment, userId: string, generation: number, codes: string[], now: string) {
  return Promise.all(codes.map(async (code, index) => env.DB.prepare(`INSERT INTO recovery_codes(
      user_id, code_id, code_verifier, generation, created_at
    ) VALUES(?, ?, ?, ?, ?)`).bind(
      userId,
      `${generation}-${index + 1}`,
      await recoveryVerifier(code),
      generation,
      now
    )));
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

function anyContactReady(env: ContactVerificationEnvironment) {
  return contactVerificationReady('email', env) || contactVerificationReady('sms', env);
}

async function prepareTicket(
  ticket: unknown,
  purpose: ContactVerificationTicketPayload['purpose'],
  env: ContactVerificationEnvironment
): Promise<PreparedTicket | null> {
  const payload = await verifyContactVerificationTicket(ticket, env, { purpose });
  if (!payload || !contactVerificationReady(payload.channel, env)) return null;
  const row = await env.DB.prepare(`SELECT masked_destination, confirmed_at
    FROM contact_verification_challenges
    WHERE challenge_id = ? AND channel = ? AND purpose = ? AND destination_digest = ?
      AND provider_message_id IS NOT NULL AND confirmed_at IS NOT NULL AND consumed_at IS NULL`)
    .bind(payload.challengeId, payload.channel, payload.purpose, payload.destinationDigest)
    .first<ChallengeRow>();
  if (!row) return null;
  return {
    ...payload,
    maskedDestination: row.masked_destination,
    verifiedAt: row.confirmed_at
  };
}

function consumptionStatement(
  env: ContactVerificationEnvironment,
  userId: string,
  ticket: PreparedTicket,
  now: string
) {
  return env.DB.prepare(`INSERT INTO contact_ticket_consumptions(
    challenge_id, user_id, channel, purpose, destination_digest, consumed_at
  ) VALUES(
    (SELECT challenge_id FROM contact_verification_challenges
      WHERE challenge_id = ? AND channel = ? AND purpose = ? AND destination_digest = ?
        AND provider_message_id IS NOT NULL AND confirmed_at IS NOT NULL AND consumed_at IS NULL
        AND datetime(confirmed_at, '+10 minutes') > datetime(?)),
    ?, ?, ?, ?, ?
  )`).bind(
      ticket.challengeId,
      ticket.channel,
      ticket.purpose,
      ticket.destinationDigest,
      now,
      userId,
      ticket.channel,
      ticket.purpose,
      ticket.destinationDigest,
      now
    );
}

function challengeConsumptionStatement(
  env: ContactVerificationEnvironment,
  ticket: PreparedTicket,
  now: string
) {
  return env.DB.prepare(`UPDATE contact_verification_challenges
    SET consumed_at = ?, updated_at = ?
    WHERE challenge_id = ? AND channel = ? AND purpose = ? AND destination_digest = ?
      AND provider_message_id IS NOT NULL AND confirmed_at IS NOT NULL AND consumed_at IS NULL`)
    .bind(
      now,
      now,
      ticket.challengeId,
      ticket.channel,
      ticket.purpose,
      ticket.destinationDigest
    );
}

function contactStatement(
  env: ContactVerificationEnvironment,
  userId: string,
  ticket: PreparedTicket,
  now: string
) {
  return env.DB.prepare(`INSERT INTO verified_contacts(
    contact_id, user_id, channel, destination_digest, masked_destination,
    verified_at, source_challenge_id, created_at, updated_at
  ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
      crypto.randomUUID(),
      userId,
      ticket.channel,
      ticket.destinationDigest,
      ticket.maskedDestination,
      ticket.verifiedAt,
      ticket.challengeId,
      now,
      now
    );
}

function publicContact(row: VerifiedContactRow) {
  return {
    id: row.contact_id,
    channel: row.channel,
    maskedDestination: row.masked_destination,
    verifiedAt: row.verified_at,
    createdAt: row.created_at
  };
}

async function contactsForUser(env: ContactVerificationEnvironment, userId: string) {
  const rows = await env.DB.prepare(`SELECT contact_id, channel, masked_destination, verified_at, created_at
    FROM verified_contacts WHERE user_id = ? ORDER BY channel, created_at`).bind(userId).all<VerifiedContactRow>();
  return rows.results.map(publicContact);
}

function mappedBindingFailure(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  if (message.includes('users.username')) return json({ error: 'Этот логин уже занят.' }, 409);
  if (message.includes('verified_contacts.channel') && message.includes('destination_digest')) {
    return json({ error: 'Этот контакт уже привязан к другому аккаунту.' }, 409);
  }
  if (message.includes('verified_contacts.user_id') && message.includes('channel')) {
    return json({ error: 'Контакт этого типа уже привязан к аккаунту.' }, 409);
  }
  if (message.includes('contact_ticket_invalid') || message.includes('contact_ticket_consumptions.challenge_id')) {
    return json({ error: 'Подтверждение уже использовано или истекло.' }, 409);
  }
  console.error('contact_account_operation_failed', {
    name: error instanceof Error ? error.name.slice(0, 80) : 'UnknownError'
  });
  return json({ error: fallback }, 500);
}

async function registerWithContact(request: Request, env: ContactVerificationEnvironment) {
  const body = await readJson(request) as {
    username?: unknown;
    password?: unknown;
    displayName?: unknown;
    deviceName?: unknown;
    contactTicket?: unknown;
  } | null;
  const username = normalizeUsername(body?.username);
  const password = body?.password;
  if (!validUsername(username)) return json({ error: 'Логин должен содержать 3–32 символа: a–z, 0–9, точка, дефис или подчёркивание.' }, 400);
  if (!validPassword(password)) return json({ error: `Пароль должен содержать от ${PASSWORD_MIN_LENGTH} до ${PASSWORD_MAX_LENGTH} символов.` }, 400);
  const ticket = await prepareTicket(body?.contactTicket, 'register', env);
  if (!ticket) return json({ error: 'Подтверждение контакта не подошло или истекло.' }, 400);

  const existing = await env.DB.prepare('SELECT 1 AS found FROM users WHERE username = ? COLLATE NOCASE')
    .bind(username).first<{ found: number }>();
  if (existing) return json({ error: 'Этот логин уже занят.' }, 409);

  const userId = crypto.randomUUID();
  const salt = bytesToBase64Url(randomBytes(16));
  const hash = await passwordHash(password, salt);
  const recoveryCodes = generateRecoveryCodes();
  const generation = 1;
  const session = newSession(userId, body?.deviceName);
  const now = sqliteTime();
  const recovery = await recoveryStatements(env, userId, generation, recoveryCodes, now);

  try {
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO users(
        user_id, username, password_salt, password_hash, password_iterations,
        recovery_generation, recovery_generated_at, created_at, updated_at, password_changed_at
      ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
        userId, username, salt, hash, PASSWORD_ITERATIONS, generation, now, now, now, now
      ),
      env.DB.prepare('INSERT INTO user_profiles(user_id, display_name) VALUES(?, ?)')
        .bind(userId, cleanDisplayName(body?.displayName)),
      ...recovery,
      env.DB.prepare(`INSERT INTO auth_sessions(
        session_id, user_id, token_verifier, device_name, created_at, last_seen_at, expires_at
      ) VALUES(?, ?, ?, ?, ?, ?, ?)`).bind(
        session.sessionId,
        userId,
        await sessionVerifier(session.token),
        session.deviceName,
        now,
        now,
        session.expiresAt
      ),
      consumptionStatement(env, userId, ticket, now),
      challengeConsumptionStatement(env, ticket, now),
      contactStatement(env, userId, ticket, now)
    ]);
  } catch (error) {
    return mappedBindingFailure(error, 'Не удалось создать аккаунт с подтверждённым контактом.');
  }

  return json({
    session: {
      token: session.token,
      id: session.sessionId,
      expiresAt: session.expiresAt,
      deviceName: session.deviceName,
      revision: 0
    },
    user: {
      id: userId,
      username,
      displayName: cleanDisplayName(body?.displayName),
      dailyMinutes: 25,
      locale: 'ru-RU',
      theme: 'dark'
    },
    recoveryCodes,
    recovery: {
      remaining: RECOVERY_CODE_COUNT,
      generatedAt: now,
      canRegenerateAt: sqliteTime(new Date(Date.now() + 86_400_000))
    },
    contacts: [{
      channel: ticket.channel,
      maskedDestination: ticket.maskedDestination,
      verifiedAt: ticket.verifiedAt
    }]
  }, 201);
}

async function resetPasswordWithContact(request: Request, env: ContactVerificationEnvironment) {
  const body = await readJson(request) as { contactTicket?: unknown; newPassword?: unknown } | null;
  if (!validPassword(body?.newPassword)) {
    return json({ error: `Новый пароль должен содержать от ${PASSWORD_MIN_LENGTH} до ${PASSWORD_MAX_LENGTH} символов.` }, 400);
  }
  const ticket = await prepareTicket(body?.contactTicket, 'password-reset', env);
  if (!ticket) return json({ error: 'Подтверждение контакта не подошло или истекло.' }, 400);
  const user = await env.DB.prepare(`SELECT users.* FROM verified_contacts
    JOIN users ON users.user_id = verified_contacts.user_id
    WHERE verified_contacts.channel = ? AND verified_contacts.destination_digest = ?`)
    .bind(ticket.channel, ticket.destinationDigest).first<UserRow>();
  if (!user) return json({ error: 'Подтверждение контакта не подошло или истекло.' }, 400);

  const currentHash = await passwordHash(body.newPassword, user.password_salt, user.password_iterations);
  if (constantTimeEqual(currentHash, user.password_hash)) return json({ error: 'Новый пароль должен отличаться от текущего.' }, 400);
  const salt = bytesToBase64Url(randomBytes(16));
  const hash = await passwordHash(body.newPassword, salt);
  const now = sqliteTime();
  try {
    await env.DB.batch([
      consumptionStatement(env, user.user_id, ticket, now),
      challengeConsumptionStatement(env, ticket, now),
      env.DB.prepare(`UPDATE users SET password_salt = ?, password_hash = ?, password_iterations = ?,
        password_changed_at = ?, updated_at = ?, failed_login_count = 0, locked_until = NULL
        WHERE user_id = ?`).bind(salt, hash, PASSWORD_ITERATIONS, now, now, user.user_id),
      env.DB.prepare('DELETE FROM auth_sessions WHERE user_id = ?').bind(user.user_id)
    ]);
  } catch (error) {
    return mappedBindingFailure(error, 'Не удалось изменить пароль.');
  }
  return json({ ok: true, message: 'Пароль изменён. Все старые сессии отключены.' });
}

async function verifyCurrentPassword(
  env: ContactVerificationEnvironment,
  auth: AuthenticatedUser,
  password: unknown
) {
  if (typeof password !== 'string') return false;
  const user = await env.DB.prepare(`SELECT password_salt, password_hash, password_iterations
    FROM users WHERE user_id = ?`).bind(auth.userId)
    .first<Pick<UserRow, 'password_salt' | 'password_hash' | 'password_iterations'>>();
  if (!user) return false;
  const computed = await passwordHash(password, user.password_salt, user.password_iterations);
  return constantTimeEqual(computed, user.password_hash);
}

async function attachContact(
  request: Request,
  env: ContactVerificationEnvironment,
  auth: AuthenticatedUser
) {
  const body = await readJson(request) as { contactTicket?: unknown; currentPassword?: unknown } | null;
  if (!await verifyCurrentPassword(env, auth, body?.currentPassword)) {
    return json({ error: 'Текущий пароль не подошёл.' }, 400);
  }
  const ticket = await prepareTicket(body?.contactTicket, 'sensitive-action', env);
  if (!ticket) return json({ error: 'Подтверждение контакта не подошло или истекло.' }, 400);
  const now = sqliteTime();
  try {
    await env.DB.batch([
      consumptionStatement(env, auth.userId, ticket, now),
      challengeConsumptionStatement(env, ticket, now),
      contactStatement(env, auth.userId, ticket, now)
    ]);
  } catch (error) {
    return mappedBindingFailure(error, 'Не удалось привязать контакт.');
  }
  return json({ ok: true, contacts: await contactsForUser(env, auth.userId) });
}

export async function handleContactAccountRequest(
  request: Request,
  env: ContactVerificationEnvironment
): Promise<Response | null> {
  const url = new URL(request.url);
  const registerPath = url.pathname === '/api/auth/contact/register';
  const resetPath = url.pathname === '/api/auth/contact/password/reset';
  const listPath = url.pathname === '/api/auth/contacts';
  const attachPath = url.pathname === '/api/auth/contact/attach';
  if (!registerPath && !resetPath && !listPath && !attachPath) return null;
  if (!anyContactReady(env)) return json({ error: 'Not found' }, 404);
  if ((registerPath || resetPath || attachPath) && request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405, { allow: 'POST, OPTIONS' });
  }
  if (listPath && request.method !== 'GET') return json({ error: 'Method not allowed' }, 405, { allow: 'GET, OPTIONS' });
  if (!env.DB) return json({ error: 'Verification storage is unavailable' }, 503);

  if (registerPath) return registerWithContact(request, env);
  if (resetPath) return resetPasswordWithContact(request, env);

  const auth = await authenticateSession(request, env);
  if (auth instanceof Response) return auth;
  if (listPath) return json({ contacts: await contactsForUser(env, auth.userId) });
  return attachContact(request, env, auth);
}
