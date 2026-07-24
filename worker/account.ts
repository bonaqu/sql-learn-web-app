type TaskStatsPayload = {
  attempts: number;
  incorrect: number;
  hintsUsed: number;
  lastAttemptAt?: string;
  completedAt?: string;
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

type DeviceSession = {
  accountId: string;
  deviceId: string;
  deviceName: string;
};

const ACCOUNT_ID_PATTERN = /^[a-f0-9]{64}$/;
const DEVICE_ID_PATTERN = /^[a-f0-9-]{16,64}$/i;
const LEGACY_PROFILE_PATTERN = /^[a-zA-Z0-9_-]{8,80}$/;
const TOKEN_PATTERN = /^[a-zA-Z0-9_-]{40,128}$/;
const TASK_ID_PATTERN = /^task-[0-9]{3}$/;
const MAX_PROGRESS_BYTES = 200_000;
const MAX_DEVICE_NAME = 48;

const json = (data: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(data), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    ...headers
  }
});

const boundedInteger = (value: unknown, max = 1_000_000) =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= max;

function validTaskStats(value: unknown): value is TaskStatsPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const stats = value as Partial<TaskStatsPayload>;
  return boundedInteger(stats.attempts, 10_000)
    && boundedInteger(stats.incorrect, 10_000)
    && boundedInteger(stats.hintsUsed, 10_000)
    && (stats.lastAttemptAt === undefined || typeof stats.lastAttemptAt === 'string')
    && (stats.completedAt === undefined || typeof stats.completedAt === 'string');
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
    && Object.entries(value.taskStats).every(([taskId, stats]) => TASK_ID_PATTERN.test(taskId) && validTaskStats(stats))
    && (value.lastTask === undefined || TASK_ID_PATTERN.test(value.lastTask))
    && (value.lastStudyDate === undefined || typeof value.lastStudyDate === 'string');
}

function accountId(request: Request) {
  const value = request.headers.get('x-account-id')?.trim().toLowerCase() || '';
  return ACCOUNT_ID_PATTERN.test(value) ? value : null;
}

function deviceId(request: Request) {
  const value = request.headers.get('x-device-id')?.trim() || '';
  return DEVICE_ID_PATTERN.test(value) ? value : null;
}

function bearerToken(request: Request) {
  const authorization = request.headers.get('authorization') || '';
  const match = authorization.match(/^Bearer\s+([a-zA-Z0-9_-]+)$/i);
  return match && TOKEN_PATTERN.test(match[1]) ? match[1] : null;
}

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

async function tokenVerifier(token: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`sql-academy/device-verifier/v1:${token}`));
  return bytesToHex(new Uint8Array(digest));
}

function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function cleanDeviceName(value: unknown) {
  const name = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
  return (name || 'Новое устройство').slice(0, MAX_DEVICE_NAME);
}

async function readJson(request: Request) {
  try {
    return await request.json<unknown>();
  } catch {
    return null;
  }
}

async function authenticateDevice(request: Request, env: Cloudflare.Env): Promise<DeviceSession | Response> {
  const account = accountId(request);
  const device = deviceId(request);
  const token = bearerToken(request);
  if (!account || !device || !token) return json({ error: 'Account authentication is required' }, 401);

  const row = await env.DB.prepare(`SELECT device_name, token_verifier
    FROM sync_devices WHERE account_id = ? AND device_id = ?`)
    .bind(account, device)
    .first<{ device_name: string; token_verifier: string }>();
  if (!row || row.token_verifier !== await tokenVerifier(token)) return json({ error: 'Invalid or revoked device session' }, 401);

  await env.DB.batch([
    env.DB.prepare(`UPDATE sync_devices SET last_seen_at = datetime('now')
      WHERE account_id = ? AND device_id = ? AND last_seen_at < datetime('now', '-10 minutes')`).bind(account, device),
    env.DB.prepare(`UPDATE sync_accounts SET last_seen_at = datetime('now')
      WHERE account_id = ? AND last_seen_at < datetime('now', '-10 minutes')`).bind(account)
  ]);

  return { accountId: account, deviceId: device, deviceName: row.device_name };
}

async function issueDevice(
  request: Request,
  env: Cloudflare.Env,
  requireExisting: boolean
) {
  const account = accountId(request);
  const masterToken = bearerToken(request);
  if (!account || !masterToken) return json({ error: 'A valid account ID and recovery proof are required' }, 400);

  const body = await readJson(request) as { deviceId?: unknown; deviceName?: unknown; legacyProfileId?: unknown } | null;
  const requestedDevice = typeof body?.deviceId === 'string' ? body.deviceId.trim() : '';
  if (!DEVICE_ID_PATTERN.test(requestedDevice)) return json({ error: 'A valid device ID is required' }, 400);

  const masterVerifier = await tokenVerifier(`master:${masterToken}`);
  const existing = await env.DB.prepare('SELECT master_verifier, created_at FROM sync_accounts WHERE account_id = ?')
    .bind(account)
    .first<{ master_verifier: string; created_at: string }>();

  if (requireExisting && !existing) return json({ error: 'Sync account not found' }, 404);
  if (existing && existing.master_verifier !== masterVerifier) return json({ error: 'Recovery code is incorrect' }, 401);

  if (!existing) {
    await env.DB.prepare(`INSERT INTO sync_accounts(account_id, master_verifier)
      VALUES(?, ?)`).bind(account, masterVerifier).run();
  }

  const deviceToken = randomToken();
  const deviceVerifier = await tokenVerifier(deviceToken);
  const name = cleanDeviceName(body?.deviceName);
  await env.DB.prepare(`INSERT INTO sync_devices(account_id, device_id, device_name, token_verifier)
    VALUES(?, ?, ?, ?)
    ON CONFLICT(account_id, device_id) DO UPDATE SET
      device_name = excluded.device_name,
      token_verifier = excluded.token_verifier,
      last_seen_at = datetime('now')`)
    .bind(account, requestedDevice, name, deviceVerifier)
    .run();

  const legacyProfileId = typeof body?.legacyProfileId === 'string' && LEGACY_PROFILE_PATTERN.test(body.legacyProfileId)
    ? body.legacyProfileId
    : null;
  if (legacyProfileId) {
    await env.DB.prepare(`INSERT INTO progress(profile_id, payload, updated_at, revision)
      SELECT ?, payload, updated_at, revision FROM progress WHERE profile_id = ?
      ON CONFLICT(profile_id) DO NOTHING`)
      .bind(account, legacyProfileId)
      .run();
  }

  const progress = await env.DB.prepare('SELECT revision, updated_at FROM progress WHERE profile_id = ?')
    .bind(account)
    .first<{ revision: number; updated_at: string }>();

  return json({
    accountId: account,
    deviceId: requestedDevice,
    deviceName: name,
    deviceToken,
    created: !existing,
    revision: progress?.revision || 0,
    progressUpdatedAt: progress?.updated_at || null
  }, existing ? 200 : 201);
}

async function accountMetadata(request: Request, env: Cloudflare.Env, session: DeviceSession) {
  const account = await env.DB.prepare('SELECT created_at, last_seen_at FROM sync_accounts WHERE account_id = ?')
    .bind(session.accountId)
    .first<{ created_at: string; last_seen_at: string }>();
  const devices = await env.DB.prepare(`SELECT device_id, device_name, created_at, last_seen_at
    FROM sync_devices WHERE account_id = ? ORDER BY last_seen_at DESC`)
    .bind(session.accountId)
    .all<{ device_id: string; device_name: string; created_at: string; last_seen_at: string }>();
  const progress = await env.DB.prepare('SELECT revision, updated_at FROM progress WHERE profile_id = ?')
    .bind(session.accountId)
    .first<{ revision: number; updated_at: string }>();

  return json({
    account: {
      idHint: session.accountId.slice(0, 8),
      createdAt: account?.created_at,
      lastSeenAt: account?.last_seen_at,
      revision: progress?.revision || 0,
      progressUpdatedAt: progress?.updated_at || null
    },
    currentDeviceId: session.deviceId,
    devices: devices.results.map(device => ({
      id: device.device_id,
      name: device.device_name,
      createdAt: device.created_at,
      lastSeenAt: device.last_seen_at,
      current: device.device_id === session.deviceId
    }))
  });
}

async function accountProgress(request: Request, env: Cloudflare.Env, session: DeviceSession) {
  if (request.method === 'GET') {
    const row = await env.DB.prepare('SELECT payload, revision, updated_at FROM progress WHERE profile_id = ?')
      .bind(session.accountId)
      .first<{ payload: string; revision: number; updated_at: string }>();
    if (!row) return json({ progress: null, revision: 0, updatedAt: null });
    try {
      return json({ progress: JSON.parse(row.payload), revision: row.revision, updatedAt: row.updated_at });
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
  if (new TextEncoder().encode(serialized).byteLength > MAX_PROGRESS_BYTES) {
    return json({ error: 'Progress payload is too large' }, 413);
  }

  if (body.baseRevision === 0) {
    const inserted = await env.DB.prepare(`INSERT OR IGNORE INTO progress(profile_id, payload, updated_at, revision)
      VALUES(?, ?, datetime('now'), 1)`)
      .bind(session.accountId, serialized)
      .run();
    if ((inserted.meta.changes || 0) !== 1) {
      const current = await env.DB.prepare('SELECT revision, updated_at FROM progress WHERE profile_id = ?')
        .bind(session.accountId)
        .first<{ revision: number; updated_at: string }>();
      return json({ error: 'Progress conflict', revision: current?.revision || 0, updatedAt: current?.updated_at || null }, 409);
    }
  } else {
    const updated = await env.DB.prepare(`UPDATE progress SET payload = ?, updated_at = datetime('now'), revision = revision + 1
      WHERE profile_id = ? AND revision = ?`)
      .bind(serialized, session.accountId, body.baseRevision)
      .run();
    if ((updated.meta.changes || 0) !== 1) {
      const current = await env.DB.prepare('SELECT revision, updated_at FROM progress WHERE profile_id = ?')
        .bind(session.accountId)
        .first<{ revision: number; updated_at: string }>();
      return json({ error: 'Progress conflict', revision: current?.revision || 0, updatedAt: current?.updated_at || null }, 409);
    }
  }

  const current = await env.DB.prepare('SELECT revision, updated_at FROM progress WHERE profile_id = ?')
    .bind(session.accountId)
    .first<{ revision: number; updated_at: string }>();
  return json({ ok: true, revision: current?.revision || 0, updatedAt: current?.updated_at || null });
}

async function revokeDevice(request: Request, env: Cloudflare.Env, session: DeviceSession, targetId: string) {
  if (!DEVICE_ID_PATTERN.test(targetId)) return json({ error: 'Invalid device ID' }, 400);
  const result = await env.DB.prepare('DELETE FROM sync_devices WHERE account_id = ? AND device_id = ?')
    .bind(session.accountId, targetId)
    .run();
  if ((result.meta.changes || 0) !== 1) return json({ error: 'Device not found' }, 404);
  return json({ ok: true, currentDeviceRevoked: targetId === session.deviceId });
}

async function deleteAccount(request: Request, env: Cloudflare.Env, session: DeviceSession) {
  const body = await readJson(request) as { confirm?: unknown } | null;
  if (body?.confirm !== 'DELETE') return json({ error: 'Account deletion confirmation is required' }, 400);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM progress WHERE profile_id = ?').bind(session.accountId),
    env.DB.prepare('DELETE FROM sync_devices WHERE account_id = ?').bind(session.accountId),
    env.DB.prepare('DELETE FROM sync_accounts WHERE account_id = ?').bind(session.accountId)
  ]);
  await env.SETTINGS?.delete(`settings:${session.accountId}`);
  return json({ ok: true });
}

export async function handleAccountRequest(request: Request, env: Cloudflare.Env): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith('/api/account')) return null;
  if (!env.DB) return json({ error: 'D1 binding is not configured' }, 503);

  if (url.pathname === '/api/account/register' && request.method === 'POST') return issueDevice(request, env, false);
  if (url.pathname === '/api/account/connect' && request.method === 'POST') return issueDevice(request, env, true);

  const session = await authenticateDevice(request, env);
  if (session instanceof Response) return session;

  if (url.pathname === '/api/account' && request.method === 'GET') return accountMetadata(request, env, session);
  if (url.pathname === '/api/account' && request.method === 'DELETE') return deleteAccount(request, env, session);
  if (url.pathname === '/api/account/progress') return accountProgress(request, env, session);
  if (url.pathname === '/api/account/devices' && request.method === 'GET') return accountMetadata(request, env, session);
  if (url.pathname.startsWith('/api/account/devices/') && request.method === 'DELETE') {
    return revokeDevice(request, env, session, decodeURIComponent(url.pathname.slice('/api/account/devices/'.length)));
  }

  return json({ error: 'Not found' }, 404);
}
