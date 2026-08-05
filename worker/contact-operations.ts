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
  max_actor_events_15m: number;
};

export type ContactDeliveryAggregates = {
  window: '24h';
  sent: number;
  accepted: number;
  delivered: number;
  deferred: number;
  bounced: number;
  complained: number;
  failed: number;
  averageDeliveryLatencyMs: number | null;
  deliveryRate: number | null;
  bounceRate: number | null;
  complaintRate: number | null;
  failureRate: number | null;
};

export type ContactSecurityAggregates = {
  window: '24h';
  challengesCreated: number;
  challengesRejected: number;
  rateLimited: number;
  providerFailed: number;
  invalidConfirmations: number;
  lockedConfirmations: number;
  confirmed: number;
  activeActorBuckets15m: number;
  maxActorEvents15m: number;
};

export type ContactOperationsAlertCode =
  | 'CONTACT_DELIVERY_RATE_LOW'
  | 'CONTACT_BOUNCE_RATE_HIGH'
  | 'CONTACT_COMPLAINT_RATE_HIGH'
  | 'CONTACT_PROVIDER_FAILURES_HIGH'
  | 'CONTACT_ABUSE_PRESSURE_HIGH'
  | 'CONTACT_ACTOR_BURST_HIGH';

export type ContactOperationsSnapshot = {
  contract: 'contact-operations-snapshot-v1';
  generatedAt: string;
  delivery: ContactDeliveryAggregates;
  security: ContactSecurityAggregates;
  alerts: ContactOperationsAlertCode[];
};

function count(value: unknown) {
  return Math.max(0, Number(value) || 0);
}

function ratio(numerator: number, denominator: number) {
  return denominator > 0 ? Number((numerator / denominator).toFixed(4)) : null;
}

export async function contactDeliveryAggregates(env: Cloudflare.Env): Promise<ContactDeliveryAggregates> {
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

export async function contactSecurityAggregates(env: Cloudflare.Env): Promise<ContactSecurityAggregates> {
  const row = await env.DB.prepare(`SELECT
    SUM(CASE WHEN event_type = 'challenge-created' THEN 1 ELSE 0 END) AS challenges_created,
    SUM(CASE WHEN event_type = 'challenge-rejected' THEN 1 ELSE 0 END) AS challenges_rejected,
    SUM(CASE WHEN event_type = 'rate-limited' THEN 1 ELSE 0 END) AS rate_limited,
    SUM(CASE WHEN event_type = 'provider-failed' THEN 1 ELSE 0 END) AS provider_failed,
    SUM(CASE WHEN event_type = 'confirmation-invalid' THEN 1 ELSE 0 END) AS invalid_confirmations,
    SUM(CASE WHEN event_type = 'confirmation-locked' THEN 1 ELSE 0 END) AS locked_confirmations,
    SUM(CASE WHEN event_type = 'contact-confirmed' THEN 1 ELSE 0 END) AS confirmed,
    COUNT(DISTINCT CASE WHEN created_at >= datetime('now', '-15 minutes') THEN actor_digest END) AS active_actor_buckets,
    COALESCE((
      SELECT MAX(actor_events)
      FROM (
        SELECT COUNT(*) AS actor_events
        FROM contact_security_events
        WHERE created_at >= datetime('now', '-15 minutes')
        GROUP BY actor_digest
      )
    ), 0) AS max_actor_events_15m
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
    activeActorBuckets15m: count(row?.active_actor_buckets),
    maxActorEvents15m: count(row?.max_actor_events_15m)
  };
}

export function contactOperationsAlerts(
  delivery: ContactDeliveryAggregates,
  security: ContactSecurityAggregates
): ContactOperationsAlertCode[] {
  const alerts: ContactOperationsAlertCode[] = [];
  if (delivery.sent >= 20 && (delivery.deliveryRate ?? 1) < 0.9) alerts.push('CONTACT_DELIVERY_RATE_LOW');
  if (delivery.sent >= 20 && (delivery.bounceRate ?? 0) >= 0.05) alerts.push('CONTACT_BOUNCE_RATE_HIGH');
  if (delivery.sent >= 20 && (delivery.complaintRate ?? 0) >= 0.005) alerts.push('CONTACT_COMPLAINT_RATE_HIGH');
  if (security.providerFailed >= 5) alerts.push('CONTACT_PROVIDER_FAILURES_HIGH');
  if (security.rateLimited >= 20 || security.lockedConfirmations >= 10) alerts.push('CONTACT_ABUSE_PRESSURE_HIGH');
  if (security.maxActorEvents15m >= 30) alerts.push('CONTACT_ACTOR_BURST_HIGH');
  return alerts;
}

export async function contactOperationsSnapshot(
  env: Cloudflare.Env,
  now = new Date()
): Promise<ContactOperationsSnapshot> {
  const [delivery, security] = await Promise.all([
    contactDeliveryAggregates(env),
    contactSecurityAggregates(env)
  ]);
  return {
    contract: 'contact-operations-snapshot-v1',
    generatedAt: now.toISOString(),
    delivery,
    security,
    alerts: contactOperationsAlerts(delivery, security)
  };
}
