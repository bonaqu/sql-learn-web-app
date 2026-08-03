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

type DeliveryAggregateRow = { channel: 'email' | 'sms'; status: string; count: number };
type SecurityAggregateRow = { channel: 'email' | 'sms'; event_type: string; count: number };

function countBy(rows: Array<{ count: number }>, predicate: (row: never) => boolean) {
  return rows.reduce((total, row) => total + (predicate(row as never) ? Math.max(0, Number(row.count) || 0) : 0), 0);
}

function ratio(numerator: number, denominator: number) {
  return denominator > 0 ? Number((numerator / denominator).toFixed(4)) : 0;
}

async function contactWindow(env: Cloudflare.Env, modifier: '-1 hour' | '-24 hours') {
  const [deliveryResult, securityResult] = await Promise.all([
    env.DB.prepare(`SELECT channel, status, COUNT(*) AS count FROM contact_delivery_events
      WHERE occurred_at >= datetime('now', ?) GROUP BY channel, status ORDER BY channel, status`)
      .bind(modifier).all<DeliveryAggregateRow>(),
    env.DB.prepare(`SELECT channel, event_type, COUNT(*) AS count FROM contact_security_events
      WHERE occurred_at >= datetime('now', ?) GROUP BY channel, event_type ORDER BY channel, event_type`)
      .bind(modifier).all<SecurityAggregateRow>()
  ]);
  const delivery = deliveryResult.results.map(row => ({ ...row, count: Math.max(0, Number(row.count) || 0) }));
  const security = securityResult.results.map(row => ({ ...row, count: Math.max(0, Number(row.count) || 0) }));

  const byChannel = (['email', 'sms'] as const).map(channel => {
    const channelDelivery = delivery.filter(row => row.channel === channel);
    const channelSecurity = security.filter(row => row.channel === channel);
    const accepted = countBy(channelDelivery, row => row.status === 'accepted');
    const delivered = countBy(channelDelivery, row => row.status === 'delivered');
    const deferred = countBy(channelDelivery, row => row.status === 'deferred');
    const bounced = countBy(channelDelivery, row => row.status === 'bounced');
    const complained = countBy(channelDelivery, row => row.status === 'complained');
    const undeliverable = countBy(channelDelivery, row => row.status === 'undeliverable');
    const providerRejected = countBy(channelDelivery, row => row.status === 'provider-rejected');
    const providerUnavailable = countBy(channelDelivery, row => row.status === 'provider-unavailable');
    const challengeCreated = countBy(channelSecurity, row => row.event_type === 'challenge-created');
    const invalidCode = countBy(channelSecurity, row => row.event_type === 'invalid-code');
    const codeLocked = countBy(channelSecurity, row => row.event_type === 'code-locked');
    const challengeRateLimit = countBy(channelSecurity, row => row.event_type === 'challenge-rate-limit');
    const resendCooldown = countBy(channelSecurity, row => row.event_type === 'resend-cooldown');
    const providerFailure = countBy(channelSecurity, row => row.event_type === 'provider-failure');
    const negativeDelivery = bounced + complained + undeliverable;
    return {
      channel,
      delivery: {
        accepted,
        delivered,
        deferred,
        bounced,
        complained,
        undeliverable,
        providerRejected,
        providerUnavailable,
        deliveryRate: ratio(delivered, accepted),
        negativeRate: ratio(negativeDelivery, accepted),
        complaintRate: ratio(complained, accepted),
        providerFailureRate: ratio(providerRejected + providerUnavailable, Math.max(accepted + providerRejected + providerUnavailable, 1))
      },
      abuse: {
        challengeCreated,
        invalidCode,
        codeLocked,
        challengeRateLimit,
        resendCooldown,
        providerFailure,
        invalidCodeRate: ratio(invalidCode, Math.max(challengeCreated * 5, 1)),
        rateLimitRate: ratio(challengeRateLimit + resendCooldown, Math.max(challengeCreated, 1))
      }
    };
  });

  return { modifier, byChannel };
}

function operationalAlerts(windows: Awaited<ReturnType<typeof contactWindow>>[]) {
  const alerts: Array<{ severity: 'warning' | 'critical'; code: string; channel: 'email' | 'sms'; window: string; value: number }> = [];
  for (const window of windows) {
    for (const item of window.byChannel) {
      const delivery = item.delivery;
      const abuse = item.abuse;
      if (delivery.providerFailureRate >= 0.05 && delivery.providerRejected + delivery.providerUnavailable >= 3) {
        alerts.push({ severity: 'critical', code: 'PROVIDER_FAILURE_RATE', channel: item.channel, window: window.modifier, value: delivery.providerFailureRate });
      }
      if (item.channel === 'email' && delivery.complaintRate >= 0.001 && delivery.complained > 0) {
        alerts.push({ severity: 'critical', code: 'EMAIL_COMPLAINT_RATE', channel: item.channel, window: window.modifier, value: delivery.complaintRate });
      }
      const negativeThreshold = item.channel === 'email' ? 0.05 : 0.1;
      if (delivery.negativeRate >= negativeThreshold && delivery.bounced + delivery.undeliverable >= 3) {
        alerts.push({ severity: 'warning', code: 'NEGATIVE_DELIVERY_RATE', channel: item.channel, window: window.modifier, value: delivery.negativeRate });
      }
      if (abuse.rateLimitRate >= 0.25 && abuse.challengeRateLimit + abuse.resendCooldown >= 10) {
        alerts.push({ severity: 'warning', code: 'CONTACT_ABUSE_SPIKE', channel: item.channel, window: window.modifier, value: abuse.rateLimitRate });
      }
      if (abuse.invalidCodeRate >= 0.4 && abuse.invalidCode >= 20) {
        alerts.push({ severity: 'warning', code: 'INVALID_CODE_SPIKE', channel: item.channel, window: window.modifier, value: abuse.invalidCodeRate });
      }
    }
  }
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

  const [users, activeSessions, progressRows, latestUserUpdate, latestProgressUpdate, oneHour, twentyFourHours] = await Promise.all([
    scalarCount(env, 'SELECT COUNT(*) AS count FROM users'),
    scalarCount(env, "SELECT COUNT(*) AS count FROM auth_sessions WHERE expires_at > datetime('now')"),
    scalarCount(env, 'SELECT COUNT(*) AS count FROM progress'),
    scalarTimestamp(env, 'SELECT MAX(updated_at) AS value FROM users'),
    scalarTimestamp(env, 'SELECT MAX(updated_at) AS value FROM progress'),
    contactWindow(env, '-1 hour'),
    contactWindow(env, '-24 hours')
  ]);
  const contactWindows = [oneHour, twentyFourHours];

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
      retentionDays: 30,
      windows: contactWindows,
      alerts: operationalAlerts(contactWindows),
      privacy: 'aggregate-only-no-destination-code-or-ticket'
    }
  });
}
