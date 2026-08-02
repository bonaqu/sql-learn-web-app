import type { VerificationChannel, VerificationPurpose, VerificationProviderName } from './integrations/verification';

export type ContactDeliveryStatus =
  | 'accepted'
  | 'queued'
  | 'sent'
  | 'delivered'
  | 'delayed'
  | 'bounced'
  | 'complained'
  | 'failed'
  | 'undelivered'
  | 'read'
  | 'unknown';

export type ContactSecurityEvent =
  | 'challenge-created'
  | 'challenge-rate-limited'
  | 'challenge-provider-failed'
  | 'code-invalid'
  | 'code-exhausted'
  | 'contact-confirmed'
  | 'ticket-consumed';

export type ContactObservabilityEnvironment = Cloudflare.Env;

const DELIVERY_RETENTION_DAYS = 90;
const SECURITY_RETENTION_DAYS = 90;
const CHALLENGE_RETENTION_DAYS = 30;
const CLEANUP_BATCH_SIZE = 1_000;

function bounded(value: string | null | undefined, max: number) {
  const normalized = (value || '').trim();
  return normalized ? normalized.slice(0, max) : null;
}

export async function recordContactSecurityEvent(
  env: ContactObservabilityEnvironment,
  input: {
    eventType: ContactSecurityEvent;
    challengeId?: string | null;
    channel?: VerificationChannel | null;
    purpose?: VerificationPurpose | null;
  }
) {
  if (!env.DB) return;
  try {
    await env.DB.prepare(`INSERT OR IGNORE INTO contact_security_events(
      event_id, event_type, challenge_id, channel, purpose, occurred_at
    ) VALUES(?, ?, ?, ?, ?, datetime('now'))`).bind(
      crypto.randomUUID(),
      input.eventType,
      bounded(input.challengeId, 80),
      input.channel || null,
      input.purpose || null
    ).run();
  } catch (error) {
    console.error('contact_security_event_persist_failed', {
      eventType: input.eventType,
      challengeId: bounded(input.challengeId, 80),
      name: error instanceof Error ? error.name : 'UnknownError'
    });
  }
}

export async function recordContactDeliveryEvent(
  env: ContactObservabilityEnvironment,
  input: {
    eventId: string;
    provider: Exclude<VerificationProviderName, 'disabled'>;
    providerMessageId: string;
    challengeId?: string | null;
    channel: VerificationChannel;
    status: ContactDeliveryStatus;
    errorCode?: string | null;
    occurredAt: string;
  }
) {
  if (!env.DB) return false;
  try {
    const result = await env.DB.prepare(`INSERT OR IGNORE INTO contact_delivery_events(
      event_id, provider, provider_message_id, challenge_id, channel,
      status, error_code, occurred_at, received_at
    ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`).bind(
      input.eventId.slice(0, 200),
      input.provider,
      input.providerMessageId.slice(0, 200),
      bounded(input.challengeId, 80),
      input.channel,
      input.status,
      bounded(input.errorCode, 80),
      input.occurredAt.slice(0, 80)
    ).run();
    return (result.meta.changes || 0) === 1;
  } catch (error) {
    console.error('contact_delivery_event_persist_failed', {
      eventId: input.eventId.slice(0, 200),
      provider: input.provider,
      status: input.status,
      name: error instanceof Error ? error.name : 'UnknownError'
    });
    return false;
  }
}

export async function recordInitialContactDelivery(
  env: ContactObservabilityEnvironment,
  input: {
    provider: Exclude<VerificationProviderName, 'disabled'>;
    providerMessageId: string;
    challengeId: string;
    channel: VerificationChannel;
    status: 'accepted' | 'queued';
    occurredAt: string;
  }
) {
  return recordContactDeliveryEvent(env, {
    eventId: `initial:${input.provider}:${input.challengeId}`,
    ...input
  });
}

export type ContactDeliveryAggregate = {
  channel: VerificationChannel;
  status: ContactDeliveryStatus;
  count: number;
};

export async function contactOperationalHealth(env: ContactObservabilityEnvironment) {
  const since = new Date(Date.now() - 24 * 60 * 60_000).toISOString().slice(0, 19).replace('T', ' ');
  const [delivery, security, challenge] = await Promise.all([
    env.DB.prepare(`SELECT channel, status, COUNT(*) AS count
      FROM contact_delivery_events WHERE received_at >= ?
      GROUP BY channel, status ORDER BY channel, status`).bind(since).all<ContactDeliveryAggregate>(),
    env.DB.prepare(`SELECT event_type, COUNT(*) AS count
      FROM contact_security_events WHERE occurred_at >= ?
      GROUP BY event_type ORDER BY event_type`).bind(since).all<{ event_type: ContactSecurityEvent; count: number }>(),
    env.DB.prepare(`SELECT
        COUNT(*) AS created,
        SUM(CASE WHEN confirmed_at IS NOT NULL THEN 1 ELSE 0 END) AS confirmed,
        SUM(CASE WHEN attempts_remaining = 0 AND confirmed_at IS NULL THEN 1 ELSE 0 END) AS locked,
        SUM(CASE WHEN expires_at < datetime('now') AND confirmed_at IS NULL THEN 1 ELSE 0 END) AS expired_unconfirmed,
        SUM(CASE WHEN consumed_at IS NOT NULL THEN 1 ELSE 0 END) AS consumed
      FROM contact_verification_challenges WHERE created_at >= ?`).bind(since).first<{
        created: number;
        confirmed: number;
        locked: number;
        expired_unconfirmed: number;
        consumed: number;
      }>()
  ]);

  const deliveryCounts = Object.fromEntries((delivery.results || []).map(row => [
    `${row.channel}:${row.status}`,
    Math.max(0, Number(row.count) || 0)
  ]));
  const securityCounts = Object.fromEntries((security.results || []).map(row => [
    row.event_type,
    Math.max(0, Number(row.count) || 0)
  ]));
  const created = Math.max(0, Number(challenge?.created) || 0);
  const confirmed = Math.max(0, Number(challenge?.confirmed) || 0);
  const delivered = (deliveryCounts['email:delivered'] || 0) + (deliveryCounts['sms:delivered'] || 0);
  const hardFailures = (deliveryCounts['email:bounced'] || 0)
    + (deliveryCounts['email:complained'] || 0)
    + (deliveryCounts['email:failed'] || 0)
    + (deliveryCounts['sms:failed'] || 0)
    + (deliveryCounts['sms:undelivered'] || 0);

  return {
    windowHours: 24,
    generatedAt: new Date().toISOString(),
    challenges: {
      created,
      confirmed,
      locked: Math.max(0, Number(challenge?.locked) || 0),
      expiredUnconfirmed: Math.max(0, Number(challenge?.expired_unconfirmed) || 0),
      consumed: Math.max(0, Number(challenge?.consumed) || 0),
      confirmationRate: created ? Number((confirmed / created).toFixed(4)) : null
    },
    delivery: {
      counts: deliveryCounts,
      delivered,
      hardFailures,
      hardFailureRate: delivered + hardFailures
        ? Number((hardFailures / (delivered + hardFailures)).toFixed(4))
        : null
    },
    abuse: {
      events: securityCounts,
      rateLimited: securityCounts['challenge-rate-limited'] || 0,
      invalidCodes: securityCounts['code-invalid'] || 0,
      exhaustedCodes: securityCounts['code-exhausted'] || 0
    }
  };
}

export async function contactDeliveryTimeline(env: ContactObservabilityEnvironment, challengeId: string) {
  const challenge = await env.DB.prepare(`SELECT challenge_id, channel, purpose, masked_destination,
      provider_message_id, attempts_remaining, expires_at, confirmed_at, consumed_at, created_at, updated_at
    FROM contact_verification_challenges WHERE challenge_id = ?`).bind(challengeId).first<{
      challenge_id: string;
      channel: VerificationChannel;
      purpose: VerificationPurpose;
      masked_destination: string;
      provider_message_id: string | null;
      attempts_remaining: number;
      expires_at: string;
      confirmed_at: string | null;
      consumed_at: string | null;
      created_at: string;
      updated_at: string;
    }>();
  if (!challenge) return null;
  const [delivery, security] = await Promise.all([
    env.DB.prepare(`SELECT event_id, provider, provider_message_id, channel, status, error_code,
        occurred_at, received_at
      FROM contact_delivery_events WHERE challenge_id = ? ORDER BY occurred_at, received_at`)
      .bind(challengeId).all(),
    env.DB.prepare(`SELECT event_id, event_type, channel, purpose, occurred_at
      FROM contact_security_events WHERE challenge_id = ? ORDER BY occurred_at`)
      .bind(challengeId).all()
  ]);
  return {
    challenge: {
      id: challenge.challenge_id,
      channel: challenge.channel,
      purpose: challenge.purpose,
      maskedDestination: challenge.masked_destination,
      providerMessageId: challenge.provider_message_id,
      attemptsRemaining: challenge.attempts_remaining,
      expiresAt: challenge.expires_at,
      confirmedAt: challenge.confirmed_at,
      consumedAt: challenge.consumed_at,
      createdAt: challenge.created_at,
      updatedAt: challenge.updated_at
    },
    delivery: delivery.results || [],
    security: security.results || []
  };
}

async function deleteBatch(env: ContactObservabilityEnvironment, sql: string) {
  const result = await env.DB.prepare(sql).bind(CLEANUP_BATCH_SIZE).run();
  return Math.max(0, Number(result.meta.changes) || 0);
}

export async function cleanupContactObservability(env: ContactObservabilityEnvironment) {
  const deliveryDays = Math.max(30, Math.min(365, DELIVERY_RETENTION_DAYS));
  const securityDays = Math.max(30, Math.min(365, SECURITY_RETENTION_DAYS));
  const challengeDays = Math.max(7, Math.min(90, CHALLENGE_RETENTION_DAYS));
  const delivery = await deleteBatch(env, `DELETE FROM contact_delivery_events WHERE rowid IN (
    SELECT rowid FROM contact_delivery_events
    WHERE received_at < datetime('now', '-${deliveryDays} days')
    ORDER BY received_at LIMIT ?
  )`);
  const security = await deleteBatch(env, `DELETE FROM contact_security_events WHERE rowid IN (
    SELECT rowid FROM contact_security_events
    WHERE occurred_at < datetime('now', '-${securityDays} days')
    ORDER BY occurred_at LIMIT ?
  )`);
  const challenges = await deleteBatch(env, `DELETE FROM contact_verification_challenges WHERE rowid IN (
    SELECT rowid FROM contact_verification_challenges
    WHERE updated_at < datetime('now', '-${challengeDays} days')
      AND (consumed_at IS NOT NULL OR expires_at < datetime('now'))
    ORDER BY updated_at LIMIT ?
  )`);
  console.info('contact_observability_cleanup', { delivery, security, challenges });
  return { delivery, security, challenges };
}