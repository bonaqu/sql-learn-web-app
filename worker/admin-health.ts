import {
  adminAllowedUserIds,
  adminConsoleReady,
  commercialCapabilities,
  commercialConfigurationErrors,
  CommercialEnvironment
} from './commercial-capabilities';

const json = (data: unknown, status = 200, extraHeaders: Record<string, string> = {}) => new Response(JSON.stringify(data), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    ...extraHeaders
  }
});

export function handleHiddenAdminBoundary(request: Request, env: CommercialEnvironment) {
  if (new URL(request.url).pathname !== '/api/admin/health') return null;
  return adminConsoleReady(env) ? null : json({ error: 'Not found' }, 404);
}

async function scalarCount(env: Cloudflare.Env, sql: string) {
  const row = await env.DB.prepare(sql).first<{ count: number }>();
  return Math.max(0, Number(row?.count) || 0);
}

async function scalarTimestamp(env: Cloudflare.Env, sql: string) {
  const row = await env.DB.prepare(sql).first<{ value: string | null }>();
  return row?.value || null;
}

type DeliveryAggregateRow = {
  sent: number;
  accepted: number;
  delivered: number;
  deferred: number;
  bounced: number;
  complained: number;
  failed: number;
  average_delivery_latency_ms: number | null;
};

type SecurityAggregateRow = {
  challenges_created: number;
  challenges_rejected: number;
  rate_limited: number;
  provider_failed: number;
  invalid_confirmations: number;
  locked_confirmations: number;
  confirmed: number;
  active_actor_buckets: number;
};

function count(value: unknown) {
  return Math.max(0, Number(value) || 0);
}

function ratio(numerator: number, denominator: number) {
  return denominator > 0 ? Number((numerator / denominator).toFixed(4)) : null;
}

async function contactDeliveryAggregates(env: Cloudflare.Env) {
  const row = await env.DB.prepare(`SELECT
    (SELECT COUNT(*) FROM contact_verification_challenges
      WHERE provider_message_id IS NOT NULL AND created_at >= datetime('now', '-24 hours')) AS sent,
    COUNT(DISTINCT CASE WHEN status = 'accepted' THEN challenge_id END) AS accepted,
    COUNT(DISTINCT CASE WHEN status = 'delivered' THEN challenge_id END) AS delivered,
    COUNT(DISTINCT CASE WHEN status = 'deferred' THEN challenge_id END) AS deferred,
    COUNT(DISTINCT CASE WHEN status = 'bounced' THEN challenge_id END) AS bounced,
    COUNT(DISTINCT CASE WHEN status = 'complained' THEN challenge_id END) AS complained,
    COUNT(DISTINCT CASE WHEN status = 'failed' THEN challenge_id END) AS failed,
    AVG(CASE WHEN status = 'delivered' THEN latency_ms END) AS average_delivery_latency_ms
    FROM contact_delivery_events WHERE received_at >= datetime('now', '-24 hours')`)
    .first<DeliveryAggregateRow>();
  const sent = count(row?.sent);
  const delivered = count(row?.delivered);
  const bounced = count(row?.bounced);
  const complained = count(row?.complained);
  const failed = count(row?.failed);
  return {
    window: '24h',
    sent,
    accepted: count(row?.accepted),
    delivered,
    deferred: count(row?.deferred),
    bounced,
    complained,
    failed,
    averageDeliveryLatencyMs: row?.average_delivery_latency_ms === null
      || row?.average_delivery_latency_ms === undefined
      ? null
      : Math.max(0, Math.round(Number(row.average_delivery_latency_ms) || 0)),
    deliveryRate: ratio(delivered, sent),
    bounceRate: ratio(bounced, sent),
    complaintRate: ratio(complained, sent),
    failureRate: ratio(failed, sent)
  };
}

async function contactSecurityAggregates(env: Cloudflare.Env) {
  const row = await env.DB.prepare(`SELECT
    SUM(CASE WHEN event_type = 'challenge-created' THEN 1 ELSE 0 END) AS challenges_created,
    SUM(CASE WHEN event_type = 'challenge-rejected' THEN 1 ELSE 0 END) AS challenges_rejected,
    SUM(CASE WHEN event_type = 'rate-limited' THEN 1 ELSE 0 END) AS rate_limited,
    SUM(CASE WHEN event_type = 'provider-failed' THEN 1 ELSE 0 END) AS provider_failed,
    SUM(CASE WHEN event_type = 'confirmation-invalid' THEN 1 ELSE 0 END) AS invalid_confirmations,
    SUM(CASE WHEN event_type = 'confirmation-locked' THEN 1 ELSE 0 END) AS locked_confirmations,
    SUM(CASE WHEN event_type = 'contact-confirmed' THEN 1 ELSE 0 END) AS confirmed,
    COUNT(DISTINCT CASE WHEN created_at >= datetime('now', '-15 minutes') THEN actor_digest END) AS active_actor_buckets
    FROM contact_security_events WHERE created_at >= datetime('now', '-24 hours')`)
    .first<SecurityAggregateRow>();
  return {
    window: '24h',
    challengesCreated: count(row?.challenges_created),
    challengesRejected: count(row?.challenges_rejected),
    rateLimited: count(row?.rate_limited),
    providerFailed: count(row?.provider_failed),
    invalidConfirmations: count(row?.invalid_confirmations),
    lockedConfirmations: count(row?.locked_confirmations),
    confirmed: count(row?.confirmed),
    activeActorBuckets15m: count(row?.active_actor_buckets)
  };
}

function contactAlerts(
  delivery: Awaited<ReturnType<typeof contactDeliveryAggregates>>,
  security: Awaited<ReturnType<typeof contactSecurityAggregates>>
) {
  const alerts: string[] = [];
  if (delivery.sent >= 20 && (delivery.deliveryRate ?? 1) < 0.9) alerts.push('CONTACT_DELIVERY_RATE_LOW');
  if (delivery.sent >= 20 && (delivery.bounceRate ?? 0) >= 0.05) alerts.push('CONTACT_BOUNCE_RATE_HIGH');
  if (delivery.sent >= 20 && (delivery.complaintRate ?? 0) >= 0.005) alerts.push('CONTACT_COMPLAINT_RATE_HIGH');
  if (security.providerFailed >= 5) alerts.push('CONTACT_PROVIDER_FAILURES_HIGH');
  if (security.rateLimited >= 20 || security.lockedConfirmations >= 10) alerts.push('CONTACT_ABUSE_PRESSURE_HIGH');
  return alerts;
}

export async function handleAdminHealthRequest(
  request: Request,
  env: CommercialEnvironment,
  userId: string
): Promise<Response | null> {
  if (new URL(request.url).pathname !== '/api/admin/health') return null;
  if (!adminConsoleReady(env) || !adminAllowedUserIds(env).has(userId)) return json({ error: 'Not found' }, 404);
  if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405, { allow: 'GET' });
  if (!env.DB) return json({ error: 'D1 binding is not configured' }, 503);

  const [
    users,
    activeSessions,
    progressRows,
    latestUserUpdate,
    latestProgressUpdate,
    contactDelivery,
    contactSecurity
  ] = await Promise.all([
    scalarCount(env, 'SELECT COUNT(*) AS count FROM users'),
    scalarCount(env, "SELECT COUNT(*) AS count FROM auth_sessions WHERE expires_at > datetime('now')"),
    scalarCount(env, 'SELECT COUNT(*) AS count FROM progress'),
    scalarTimestamp(env, 'SELECT MAX(updated_at) AS value FROM users'),
    scalarTimestamp(env, 'SELECT MAX(updated_at) AS value FROM progress'),
    contactDeliveryAggregates(env),
    contactSecurityAggregates(env)
  ]);

  return json({
    ok: true,
    generatedAt: new Date().toISOString(),
    capabilities: commercialCapabilities(env),
    configurationErrors: commercialConfigurationErrors(env),
    bindings: {
      d1: Boolean(env.DB),
      kv: Boolean(env.SETTINGS),
      ai: Boolean(env.AI)
    },
    aggregates: {
      users,
      activeSessions,
      progressRows,
      latestUserUpdate,
      latestProgressUpdate
    },
    contactOperations: {
      delivery: contactDelivery,
      security: contactSecurity,
      alerts: contactAlerts(contactDelivery, contactSecurity)
    }
  });
}