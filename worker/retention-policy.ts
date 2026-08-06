import {
  adminAllowedUserIds,
  adminConsoleReady,
  type CommercialEnvironment
} from './commercial-capabilities';

type RetentionEnvironmentKey =
  | 'RETENTION_CONTACT_EVENTS_DAYS'
  | 'RETENTION_UNCONSUMED_CONTACT_HOURS'
  | 'RETENTION_CONSUMED_CHALLENGE_HOURS'
  | 'RETENTION_EXPIRED_SESSION_HOURS'
  | 'RETENTION_CLEANUP_BATCH_SIZE';

export type RetentionEnvironment = CommercialEnvironment
  & Partial<Record<RetentionEnvironmentKey, string>>;

export type RetentionScope =
  | 'expiredSessions'
  | 'expiredUnconfirmedChallenges'
  | 'confirmedUnconsumedChallenges'
  | 'consumedChallenges'
  | 'contactSecurityEvents'
  | 'contactDeliveryEvents';

type RetentionRule = {
  value: number;
  unit: 'hours' | 'days' | 'rows';
  defaultValue: number;
  minimum: number;
  maximum: number;
  configured: boolean;
};

export type RetentionPolicy = {
  contract: 'technical-retention-policy-v1';
  technicalDataOnly: true;
  contactEvents: RetentionRule;
  unconsumedConfirmedContacts: RetentionRule;
  consumedChallenges: RetentionRule;
  expiredSessions: RetentionRule;
  cleanupBatch: RetentionRule;
  fixed: {
    expiredUnconfirmedChallenges: 'delete-after-expiry';
  };
  preserved: readonly [
    'users',
    'userProfiles',
    'recoveryCodes',
    'verifiedContacts',
    'contactTicketConsumptionReceipts',
    'learningProgress',
    'curriculumEvidence',
    'masteryEvidence',
    'checkpointReports',
    'assessmentReports',
    'capstoneReports'
  ];
};

type CleanupOptions = {
  execute?: boolean;
  now?: Date;
  scopes?: RetentionScope[];
};

type CleanupResult = {
  scope: RetentionScope;
  eligible: number;
  deleted: number;
  cutoff: string;
};

const RETENTION_PATH = '/api/admin/retention';
const EXECUTE_CONFIRMATION = 'DELETE_EXPIRED_TECHNICAL_DATA';
const MAX_JSON_BYTES = 1_024;
const ALL_SCOPES: RetentionScope[] = [
  'contactDeliveryEvents',
  'contactSecurityEvents',
  'expiredSessions',
  'expiredUnconfirmedChallenges',
  'confirmedUnconsumedChallenges',
  'consumedChallenges'
];
const SCOPE_SET = new Set<RetentionScope>(ALL_SCOPES);

const json = (data: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(data), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'x-retention-contract': 'technical-retention-policy-v1',
    ...headers
  }
});

function sqliteTime(date = new Date()) {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

function boundedRule(
  raw: string | undefined,
  defaultValue: number,
  minimum: number,
  maximum: number,
  unit: RetentionRule['unit']
): RetentionRule {
  const candidate = raw?.trim() || '';
  const numeric = candidate ? Number(candidate) : NaN;
  const valid = candidate.length > 0
    && Number.isSafeInteger(numeric)
    && numeric >= minimum
    && numeric <= maximum;
  return {
    value: valid ? numeric : defaultValue,
    unit,
    defaultValue,
    minimum,
    maximum,
    configured: valid
  };
}

export function retentionConfigurationErrors(env: RetentionEnvironment) {
  const errors: string[] = [];
  const checks: Array<[RetentionEnvironmentKey, number, number]> = [
    ['RETENTION_CONTACT_EVENTS_DAYS', 1, 30],
    ['RETENTION_UNCONSUMED_CONTACT_HOURS', 1, 24],
    ['RETENTION_CONSUMED_CHALLENGE_HOURS', 1, 24],
    ['RETENTION_EXPIRED_SESSION_HOURS', 0, 24],
    ['RETENTION_CLEANUP_BATCH_SIZE', 25, 500]
  ];
  for (const [key, minimum, maximum] of checks) {
    const raw = env[key]?.trim();
    if (!raw) continue;
    const numeric = Number(raw);
    if (!Number.isSafeInteger(numeric) || numeric < minimum || numeric > maximum) {
      errors.push(`${key}_INVALID`);
    }
  }
  return errors;
}

export function retentionPolicy(env: RetentionEnvironment): RetentionPolicy {
  return {
    contract: 'technical-retention-policy-v1',
    technicalDataOnly: true,
    contactEvents: boundedRule(env.RETENTION_CONTACT_EVENTS_DAYS, 30, 1, 30, 'days'),
    unconsumedConfirmedContacts: boundedRule(env.RETENTION_UNCONSUMED_CONTACT_HOURS, 24, 1, 24, 'hours'),
    consumedChallenges: boundedRule(env.RETENTION_CONSUMED_CHALLENGE_HOURS, 24, 1, 24, 'hours'),
    expiredSessions: boundedRule(env.RETENTION_EXPIRED_SESSION_HOURS, 0, 0, 24, 'hours'),
    cleanupBatch: boundedRule(env.RETENTION_CLEANUP_BATCH_SIZE, 250, 25, 500, 'rows'),
    fixed: {
      expiredUnconfirmedChallenges: 'delete-after-expiry'
    },
    preserved: [
      'users',
      'userProfiles',
      'recoveryCodes',
      'verifiedContacts',
      'contactTicketConsumptionReceipts',
      'learningProgress',
      'curriculumEvidence',
      'masteryEvidence',
      'checkpointReports',
      'assessmentReports',
      'capstoneReports'
    ]
  };
}

function cutoff(now: Date, amount: number, unit: 'hours' | 'days') {
  const multiplier = unit === 'days' ? 86_400_000 : 3_600_000;
  return sqliteTime(new Date(now.getTime() - amount * multiplier));
}

function scopeCutoff(scope: RetentionScope, policy: RetentionPolicy, now: Date) {
  if (scope === 'contactSecurityEvents' || scope === 'contactDeliveryEvents') {
    return cutoff(now, policy.contactEvents.value, 'days');
  }
  if (scope === 'confirmedUnconsumedChallenges') {
    return cutoff(now, policy.unconsumedConfirmedContacts.value, 'hours');
  }
  if (scope === 'consumedChallenges') {
    return cutoff(now, policy.consumedChallenges.value, 'hours');
  }
  if (scope === 'expiredSessions') {
    return cutoff(now, policy.expiredSessions.value, 'hours');
  }
  return sqliteTime(now);
}

function scopeSql(scope: RetentionScope) {
  if (scope === 'expiredSessions') return {
    key: 'session_id',
    table: 'auth_sessions',
    timestamp: 'expires_at',
    condition: 'expires_at < ?'
  };
  if (scope === 'expiredUnconfirmedChallenges') return {
    key: 'challenge_id',
    table: 'contact_verification_challenges',
    timestamp: 'expires_at',
    condition: 'expires_at < ? AND confirmed_at IS NULL'
  };
  if (scope === 'confirmedUnconsumedChallenges') return {
    key: 'challenge_id',
    table: 'contact_verification_challenges',
    timestamp: 'confirmed_at',
    condition: 'confirmed_at IS NOT NULL AND consumed_at IS NULL AND confirmed_at < ?'
  };
  if (scope === 'consumedChallenges') return {
    key: 'challenge_id',
    table: 'contact_verification_challenges',
    timestamp: 'consumed_at',
    condition: 'consumed_at IS NOT NULL AND consumed_at < ?'
  };
  if (scope === 'contactSecurityEvents') return {
    key: 'event_id',
    table: 'contact_security_events',
    timestamp: 'created_at',
    condition: 'created_at < ?'
  };
  return {
    key: 'event_id',
    table: 'contact_delivery_events',
    timestamp: 'received_at',
    condition: 'received_at < ?'
  };
}

function normalizedScopes(scopes: RetentionScope[] | undefined) {
  if (!scopes?.length) return ALL_SCOPES;
  return [...new Set(scopes)].filter(scope => SCOPE_SET.has(scope));
}

async function cleanupScope(
  env: RetentionEnvironment,
  scope: RetentionScope,
  policy: RetentionPolicy,
  now: Date,
  execute: boolean
): Promise<CleanupResult> {
  const spec = scopeSql(scope);
  const batch = policy.cleanupBatch.value;
  const threshold = scopeCutoff(scope, policy, now);
  const eligibleRow = await env.DB.prepare(`SELECT COUNT(*) AS count FROM (
    SELECT ${spec.key} FROM ${spec.table}
    WHERE ${spec.condition}
    ORDER BY ${spec.timestamp} ASC LIMIT ?
  )`).bind(threshold, batch).first<{ count: number }>();
  const eligible = Math.max(0, Number(eligibleRow?.count) || 0);
  if (!execute || eligible === 0) return { scope, eligible, deleted: 0, cutoff: threshold };

  const deleted = await env.DB.prepare(`DELETE FROM ${spec.table} WHERE ${spec.key} IN (
    SELECT ${spec.key} FROM ${spec.table}
    WHERE ${spec.condition}
    ORDER BY ${spec.timestamp} ASC LIMIT ?
  )`).bind(threshold, batch).run();
  return {
    scope,
    eligible,
    deleted: Math.max(0, Number(deleted.meta.changes) || 0),
    cutoff: threshold
  };
}

export async function runRetentionCleanup(
  env: RetentionEnvironment,
  options: CleanupOptions = {}
) {
  if (!env.DB) throw new Error('RETENTION_D1_UNAVAILABLE');
  const policy = retentionPolicy(env);
  const now = options.now || new Date();
  const execute = options.execute === true;
  const scopes = normalizedScopes(options.scopes);
  const results: CleanupResult[] = [];
  for (const scope of scopes) results.push(await cleanupScope(env, scope, policy, now, execute));
  return {
    contract: policy.contract,
    mode: execute ? 'execute' : 'dry-run',
    generatedAt: now.toISOString(),
    configurationErrors: retentionConfigurationErrors(env),
    policy,
    results,
    totals: {
      eligible: results.reduce((sum, item) => sum + item.eligible, 0),
      deleted: results.reduce((sum, item) => sum + item.deleted, 0)
    }
  };
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

function requestedScopes(value: unknown): RetentionScope[] | null {
  if (value === undefined) return ALL_SCOPES;
  if (!Array.isArray(value) || !value.length || value.length > ALL_SCOPES.length) return null;
  if (!value.every(scope => typeof scope === 'string' && SCOPE_SET.has(scope as RetentionScope))) return null;
  return [...new Set(value as RetentionScope[])];
}

export function isRetentionAdminPath(request: Request) {
  return new URL(request.url).pathname === RETENTION_PATH;
}

export async function handleRetentionAdminRequest(
  request: Request,
  env: RetentionEnvironment,
  userId: string
): Promise<Response | null> {
  if (!isRetentionAdminPath(request)) return null;
  if (!adminConsoleReady(env) || !adminAllowedUserIds(env).has(userId)) return json({ error: 'Not found' }, 404);
  if (!env.DB) return json({ error: 'D1 binding is not configured' }, 503);

  if (request.method === 'GET') {
    return json(await runRetentionCleanup(env, { execute: false }));
  }
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405, { allow: 'GET, POST' });

  const body = await boundedJson(request) as {
    mode?: unknown;
    confirmation?: unknown;
    scopes?: unknown;
  } | null;
  const scopes = requestedScopes(body?.scopes);
  if (!body || scopes === null || (body.mode !== 'dry-run' && body.mode !== 'execute')) {
    return json({ error: 'Invalid retention request' }, 400);
  }
  if (body.mode === 'execute' && body.confirmation !== EXECUTE_CONFIRMATION) {
    return json({
      error: 'Explicit cleanup confirmation is required',
      requiredConfirmation: EXECUTE_CONFIRMATION
    }, 409);
  }

  return json(await runRetentionCleanup(env, {
    execute: body.mode === 'execute',
    scopes
  }));
}
