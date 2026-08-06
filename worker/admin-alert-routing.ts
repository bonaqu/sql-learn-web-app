import { collectAdminHealthSnapshot, type AdminHealthSnapshot } from './admin-health';
import {
  adminAlertConfigurationErrors,
  adminAlertConfigurationStatus,
  adminAlertCooldownMinutes,
  adminAlertRoutingReady,
  adminAlertsEnabled,
  adminAlertWebhookSecret,
  adminAlertWebhookUrl,
  configuredAdminAlertCron,
  type AdminAlertEnvironment
} from './admin-alert-config';
import { adminAllowedUserIds, adminConsoleReady } from './commercial-capabilities';

const ADMIN_ALERT_PATH = '/api/admin/alerts';
const STATE_KEY = 'admin-alert-routing-v1:state';
const TEST_CONFIRMATION = 'SEND_ADMIN_ALERT_TEST';
const DISPATCH_CONFIRMATION = 'DISPATCH_CURRENT_ADMIN_ALERTS';
const MAX_BODY_BYTES = 2_048;
const DELIVERY_TIMEOUT_MS = 8_000;
const RECOVERY_EVENT = { status: 'resolved' as const, severity: 'info' as const };

type AlertSeverity = 'info' | 'warning' | 'critical';
type AlertStatus = 'firing' | 'resolved' | 'test';
type AlertSource = 'schedule' | 'operator' | 'operator-test';

type AlertDeliveryState = {
  contract: 'admin-alert-state-v1';
  activeCodes: string[];
  fingerprint: string;
  lastDeliveredAt: string;
};

type EvaluationOptions = {
  source: Exclude<AlertSource, 'operator-test'>;
  now?: Date;
  force?: boolean;
};

const ALERT_SEVERITY: Record<string, Exclude<AlertSeverity, 'info'>> = {
  CONTACT_DELIVERY_RATE_LOW: 'warning',
  CONTACT_BOUNCE_RATE_HIGH: 'warning',
  CONTACT_COMPLAINT_RATE_HIGH: 'critical',
  CONTACT_PROVIDER_FAILURES_HIGH: 'critical',
  CONTACT_ABUSE_PRESSURE_HIGH: 'warning',
  CONTACT_ACTOR_BURST_HIGH: 'warning'
};

const json = (data: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(data), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'x-admin-alert-contract': 'admin-alert-routing-v1',
    ...headers
  }
});

function ownedBuffer(bytes: Uint8Array) {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', ownedBuffer(new TextEncoder().encode(value)));
  return bytesToHex(new Uint8Array(digest));
}

async function hmac(secret: string, value: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    ownedBuffer(new TextEncoder().encode(secret)),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    ownedBuffer(new TextEncoder().encode(value))
  );
  return bytesToHex(new Uint8Array(signature));
}

function uniqueCodes(codes: string[]) {
  return [...new Set(codes.filter(code => /^[A-Z0-9_]{3,80}$/.test(code)))].sort();
}

function validState(value: unknown): value is AlertDeliveryState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const state = value as Partial<AlertDeliveryState>;
  return state.contract === 'admin-alert-state-v1'
    && Array.isArray(state.activeCodes)
    && state.activeCodes.length <= 20
    && state.activeCodes.every(code => typeof code === 'string' && /^[A-Z0-9_]{3,80}$/.test(code))
    && typeof state.fingerprint === 'string'
    && /^[0-9a-f]{64}$/.test(state.fingerprint)
    && typeof state.lastDeliveredAt === 'string'
    && Number.isFinite(Date.parse(state.lastDeliveredAt));
}

async function readState(env: AdminAlertEnvironment) {
  if (!env.SETTINGS) return null;
  try {
    const value = await env.SETTINGS.get<unknown>(STATE_KEY, 'json');
    if (value !== null && !validState(value)) {
      console.warn(JSON.stringify({ message: 'admin_alert_state_invalid' }));
      return null;
    }
    return value;
  } catch (error) {
    const name = error instanceof Error ? error.name.slice(0, 80) : 'UnknownError';
    console.warn(JSON.stringify({ message: 'admin_alert_state_read_failed', name }));
    return null;
  }
}

async function writeState(env: AdminAlertEnvironment, state: AlertDeliveryState) {
  await env.SETTINGS.put(STATE_KEY, JSON.stringify(state));
}

function aggregateMetrics(snapshot: AdminHealthSnapshot) {
  const { delivery, security } = snapshot.contactOperations;
  return {
    window: '24h' as const,
    delivery: {
      sent: delivery.sent,
      delivered: delivery.delivered,
      deferred: delivery.deferred,
      bounced: delivery.bounced,
      complained: delivery.complained,
      failed: delivery.failed,
      deliveryRate: delivery.deliveryRate,
      bounceRate: delivery.bounceRate,
      complaintRate: delivery.complaintRate,
      failureRate: delivery.failureRate,
      averageDeliveryLatencyMs: delivery.averageDeliveryLatencyMs
    },
    security: {
      rateLimited: security.rateLimited,
      providerFailed: security.providerFailed,
      invalidConfirmations: security.invalidConfirmations,
      lockedConfirmations: security.lockedConfirmations,
      activeActorBuckets15m: security.activeActorBuckets15m,
      maxActorEvents15m: security.maxActorEvents15m
    }
  };
}

function alertDescriptors(codes: string[]) {
  return codes.map(code => ({
    code,
    severity: ALERT_SEVERITY[code] || 'warning'
  }));
}

function overallSeverity(status: AlertStatus, codes: string[]): AlertSeverity {
  if (status !== 'firing') return RECOVERY_EVENT.severity;
  return codes.some(code => ALERT_SEVERITY[code] === 'critical') ? 'critical' : 'warning';
}

async function deliverPayload(
  env: AdminAlertEnvironment,
  payload: {
    contract: 'admin-alert-event-v1';
    eventId: string;
    generatedAt: string;
    source: AlertSource;
    status: AlertStatus;
    severity: AlertSeverity;
    alerts: Array<{ code: string; severity: AlertSeverity }>;
    metrics: ReturnType<typeof aggregateMetrics> | null;
  }
) {
  const url = adminAlertWebhookUrl(env);
  const secret = adminAlertWebhookSecret(env);
  if (!url || !secret) throw new Error('Admin alert destination is incomplete');

  const body = JSON.stringify(payload);
  const timestamp = String(Math.floor(Date.now() / 1_000));
  const signature = await hmac(secret, `${timestamp}.${body}`);
  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort(), DELIVERY_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: 'POST',
      redirect: 'error',
      signal: abort.signal,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'x-sql-academy-alert-contract': payload.contract,
        'x-sql-academy-alert-id': payload.eventId,
        'x-sql-academy-alert-timestamp': timestamp,
        'x-sql-academy-alert-signature': `sha256=${signature}`
      },
      body
    });
    if (!response.ok) throw new Error(`Admin alert webhook returned HTTP ${response.status}`);
  } finally {
    clearTimeout(timeout);
  }
}

function safeDeliveryState(state: AlertDeliveryState | null) {
  return state ? {
    activeCodes: state.activeCodes,
    lastDeliveredAt: state.lastDeliveredAt
  } : null;
}

export async function evaluateAndDispatchAdminAlerts(
  env: AdminAlertEnvironment,
  options: EvaluationOptions
) {
  const configurationErrors = adminAlertConfigurationErrors(env);
  if (!adminAlertRoutingReady(env)) {
    throw new Error(`Admin alert routing is incomplete: ${configurationErrors.join(',') || 'DISABLED'}`);
  }

  const now = options.now || new Date();
  const snapshot = await collectAdminHealthSnapshot(env);
  const currentCodes = uniqueCodes(snapshot.contactOperations.alerts);
  const previous = await readState(env);
  if (!currentCodes.length && !previous?.activeCodes.length) {
    return { status: 'no-alerts' as const, delivered: false, activeCodes: [] as string[] };
  }

  const status: Exclude<AlertStatus, 'test'> = currentCodes.length ? 'firing' : RECOVERY_EVENT.status;
  const payloadCodes = status === RECOVERY_EVENT.status ? uniqueCodes(previous?.activeCodes || []) : currentCodes;
  const fingerprint = await sha256(JSON.stringify({ status, codes: payloadCodes }));
  const elapsedMs = previous ? now.getTime() - Date.parse(previous.lastDeliveredAt) : Number.POSITIVE_INFINITY;
  const cooldownMs = adminAlertCooldownMinutes(env) * 60_000;
  if (!options.force && previous?.fingerprint === fingerprint && elapsedMs >= 0 && elapsedMs < cooldownMs) {
    return {
      status: 'suppressed' as const,
      delivered: false,
      activeCodes: currentCodes,
      nextEligibleAt: new Date(Date.parse(previous.lastDeliveredAt) + cooldownMs).toISOString()
    };
  }

  const payload = {
    contract: 'admin-alert-event-v1' as const,
    eventId: crypto.randomUUID(),
    generatedAt: now.toISOString(),
    source: options.source,
    status,
    severity: overallSeverity(status, payloadCodes),
    alerts: alertDescriptors(payloadCodes),
    metrics: aggregateMetrics(snapshot)
  };
  await deliverPayload(env, payload);
  await writeState(env, {
    contract: 'admin-alert-state-v1',
    activeCodes: currentCodes,
    fingerprint,
    lastDeliveredAt: payload.generatedAt
  });
  console.log(JSON.stringify({
    message: 'admin_alert_delivered',
    source: options.source,
    status,
    severity: payload.severity,
    alertCodes: payloadCodes,
    eventId: payload.eventId
  }));
  return {
    status,
    delivered: true,
    activeCodes: currentCodes,
    deliveredCodes: payloadCodes,
    eventId: payload.eventId
  };
}

async function sendTestAlert(env: AdminAlertEnvironment, now = new Date()) {
  if (!adminAlertRoutingReady(env)) {
    throw new Error(`Admin alert routing is incomplete: ${adminAlertConfigurationErrors(env).join(',') || 'DISABLED'}`);
  }
  const payload = {
    contract: 'admin-alert-event-v1' as const,
    eventId: crypto.randomUUID(),
    generatedAt: now.toISOString(),
    source: 'operator-test' as const,
    status: 'test' as const,
    severity: 'info' as const,
    alerts: [{ code: 'ADMIN_ALERT_TEST', severity: 'info' as const }],
    metrics: null
  };
  await deliverPayload(env, payload);
  console.log(JSON.stringify({
    message: 'admin_alert_test_delivered',
    eventId: payload.eventId
  }));
  return { status: 'test' as const, delivered: true, eventId: payload.eventId };
}

async function boundedText(request: Request) {
  const declared = Number(request.headers.get('content-length') || 0);
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return null;
  if (!request.body) return '';

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }

  const combined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(combined);
}

async function boundedJson(request: Request) {
  const text = await boundedText(request);
  if (text === null) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

export async function handleAdminAlertRequest(
  request: Request,
  env: AdminAlertEnvironment,
  userId: string
): Promise<Response | null> {
  if (new URL(request.url).pathname !== ADMIN_ALERT_PATH) return null;
  if (!adminConsoleReady(env) || !adminAllowedUserIds(env).has(userId)) return json({ error: 'Not found' }, 404);

  if (request.method === 'GET') {
    const state = env.SETTINGS ? await readState(env) : null;
    return json({
      ...adminAlertConfigurationStatus(env),
      lastDelivery: safeDeliveryState(state)
    });
  }
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405, { allow: 'GET, POST' });

  const body = await boundedJson(request) as { mode?: unknown; confirmation?: unknown } | null;
  if (!body || (body.mode !== 'test' && body.mode !== 'dispatch')) {
    return json({ error: 'Invalid alert operation', code: 'ADMIN_ALERT_OPERATION_INVALID' }, 400);
  }
  const expected = body.mode === 'test' ? TEST_CONFIRMATION : DISPATCH_CONFIRMATION;
  if (body.confirmation !== expected) {
    return json({ error: 'Explicit confirmation is required', code: 'ADMIN_ALERT_CONFIRMATION_REQUIRED' }, 409);
  }
  if (!adminAlertRoutingReady(env)) {
    return json({
      error: 'Admin alert routing is unavailable',
      code: 'ADMIN_ALERT_ROUTING_INCOMPLETE',
      configurationErrors: adminAlertConfigurationErrors(env)
    }, 503);
  }

  try {
    const result = body.mode === 'test'
      ? await sendTestAlert(env)
      : await evaluateAndDispatchAdminAlerts(env, { source: 'operator', force: true });
    return json(result);
  } catch (error) {
    const requestId = crypto.randomUUID();
    const name = error instanceof Error ? error.name.slice(0, 80) : 'UnknownError';
    console.error(JSON.stringify({
      message: 'admin_alert_delivery_failed',
      requestId,
      mode: body.mode,
      name
    }));
    return json({
      error: 'Admin alert delivery failed',
      code: 'ADMIN_ALERT_DELIVERY_FAILED',
      requestId
    }, 502);
  }
}

export async function handleScheduledAdminAlerts(
  controller: ScheduledController,
  env: AdminAlertEnvironment
) {
  if (!adminAlertsEnabled(env)) return { status: 'disabled' as const, delivered: false };
  const configuredCron = configuredAdminAlertCron(env);
  if (!configuredCron || controller.cron !== configuredCron) {
    console.warn(JSON.stringify({
      message: 'admin_alert_schedule_mismatch',
      configured: Boolean(configuredCron)
    }));
    return { status: 'ignored-schedule' as const, delivered: false };
  }
  const configurationErrors = adminAlertConfigurationErrors(env);
  if (configurationErrors.length) {
    console.error(JSON.stringify({
      message: 'admin_alert_configuration_invalid',
      configurationErrors
    }));
    throw new Error(`Admin alert routing configuration invalid: ${configurationErrors.join(',')}`);
  }
  return evaluateAndDispatchAdminAlerts(env, { source: 'schedule', now: new Date() });
}
