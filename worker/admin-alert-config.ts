type AdminAlertEnvKey =
  | 'FEATURE_ADMIN_ALERTS'
  | 'ADMIN_ALERT_CRON'
  | 'ADMIN_ALERT_COOLDOWN_MINUTES'
  | 'ADMIN_ALERT_WEBHOOK_URL'
  | 'ADMIN_ALERT_WEBHOOK_SECRET';

export type AdminAlertEnvironment = Cloudflare.Env & Partial<Record<AdminAlertEnvKey, string>>;

const DEFAULT_COOLDOWN_MINUTES = 60;
const MIN_COOLDOWN_MINUTES = 5;
const MAX_COOLDOWN_MINUTES = 1_440;
const MAX_CRON_LENGTH = 80;
const MAX_SECRET_LENGTH = 2_000;
const MAX_URL_LENGTH = 2_000;
const CRON_FIELD_PATTERN = /^[0-9A-Za-z*?,/\\#LWD-]+$/;

function enabledFlag(value: string | undefined) {
  return value?.trim().toLowerCase() === 'on';
}

function integerInRange(value: string | undefined, minimum: number, maximum: number) {
  if (value === undefined || value.trim() === '') return null;
  if (!/^\d+$/.test(value.trim())) return null;
  const parsed = Number(value.trim());
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : null;
}

function safeCron(value: string | undefined) {
  const raw = (value || '').trim();
  if (!raw || raw.length > MAX_CRON_LENGTH || /[\r\n]/.test(raw)) return null;
  const fields = raw.split(/\s+/);
  if (fields.length !== 5 || fields.some(field => !CRON_FIELD_PATTERN.test(field))) return null;
  return fields.join(' ');
}

function safeWebhookUrl(value: string | undefined) {
  const raw = (value || '').trim();
  if (!raw || raw.length > MAX_URL_LENGTH) return null;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.hash) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

export function adminAlertsEnabled(env: AdminAlertEnvironment) {
  return enabledFlag(env.FEATURE_ADMIN_ALERTS);
}

export function configuredAdminAlertCron(env: AdminAlertEnvironment) {
  return safeCron(env.ADMIN_ALERT_CRON);
}

export function adminAlertCooldownMinutes(env: AdminAlertEnvironment) {
  return integerInRange(env.ADMIN_ALERT_COOLDOWN_MINUTES, MIN_COOLDOWN_MINUTES, MAX_COOLDOWN_MINUTES)
    ?? DEFAULT_COOLDOWN_MINUTES;
}

export function adminAlertWebhookUrl(env: AdminAlertEnvironment) {
  return safeWebhookUrl(env.ADMIN_ALERT_WEBHOOK_URL);
}

export function adminAlertWebhookSecret(env: AdminAlertEnvironment) {
  const secret = (env.ADMIN_ALERT_WEBHOOK_SECRET || '').trim();
  return secret.length >= 32 && secret.length <= MAX_SECRET_LENGTH ? secret : '';
}

export function adminAlertConfigurationErrors(env: AdminAlertEnvironment) {
  const errors: string[] = [];
  const rawCron = (env.ADMIN_ALERT_CRON || '').trim();
  const rawCooldown = (env.ADMIN_ALERT_COOLDOWN_MINUTES || '').trim();

  if (rawCron && !configuredAdminAlertCron(env)) errors.push('ADMIN_ALERT_CRON_INVALID');
  if (rawCooldown
    && integerInRange(rawCooldown, MIN_COOLDOWN_MINUTES, MAX_COOLDOWN_MINUTES) === null) {
    errors.push('ADMIN_ALERT_COOLDOWN_INVALID');
  }

  if (!adminAlertsEnabled(env)) return errors;
  if (!rawCron) errors.push('ADMIN_ALERT_CRON_MISSING');
  if (!adminAlertWebhookUrl(env)) errors.push('ADMIN_ALERT_WEBHOOK_URL_INVALID');
  if (!adminAlertWebhookSecret(env)) errors.push('ADMIN_ALERT_WEBHOOK_SECRET_MISSING');
  if (!env.DB) errors.push('ADMIN_ALERT_D1_UNAVAILABLE');
  if (!env.SETTINGS) errors.push('ADMIN_ALERT_KV_UNAVAILABLE');
  return errors;
}

export function adminAlertRoutingReady(env: AdminAlertEnvironment) {
  return adminAlertsEnabled(env) && adminAlertConfigurationErrors(env).length === 0;
}

export function adminAlertConfigurationStatus(env: AdminAlertEnvironment) {
  return {
    contract: 'admin-alert-routing-v1' as const,
    enabled: adminAlertsEnabled(env),
    ready: adminAlertRoutingReady(env),
    schedule: configuredAdminAlertCron(env),
    cooldownMinutes: adminAlertCooldownMinutes(env),
    configurationErrors: adminAlertConfigurationErrors(env)
  };
}
