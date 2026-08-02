import { recordContactSecurityEvent, recordInitialContactDelivery } from '../contact-observability';

/**
 * Commercial verification provider boundary.
 *
 * Production stays fail-closed until a provider is explicitly selected, all
 * send credentials are present, and the matching signed delivery callback is
 * configured. Provider credentials are Cloudflare secrets and are never
 * written to Wrangler vars, logs or source control.
 */
export type VerificationChannel = 'email' | 'sms';
export type VerificationPurpose = 'register' | 'password-reset' | 'sensitive-action';
export type VerificationProviderName = 'disabled' | 'webhook' | 'resend' | 'twilio';

export type VerificationChallenge = {
  challengeId: string;
  channel: VerificationChannel;
  destination: string;
  purpose: VerificationPurpose;
  code: string;
  expiresAt: string;
};

export type VerificationDelivery = {
  providerMessageId: string;
  initialStatus: 'accepted' | 'queued';
};

export interface VerificationProvider {
  readonly name: VerificationProviderName;
  send(challenge: VerificationChallenge): Promise<VerificationDelivery>;
}

export interface EmailVerificationProvider extends VerificationProvider {}
export interface SmsVerificationProvider extends VerificationProvider {}

type VerificationSecretKey =
  | 'EMAIL_VERIFICATION_PROVIDER'
  | 'SMS_VERIFICATION_PROVIDER'
  | 'EMAIL_VERIFICATION_WEBHOOK_URL'
  | 'EMAIL_VERIFICATION_WEBHOOK_SECRET'
  | 'SMS_VERIFICATION_WEBHOOK_URL'
  | 'SMS_VERIFICATION_WEBHOOK_SECRET'
  | 'RESEND_API_KEY'
  | 'RESEND_FROM'
  | 'RESEND_WEBHOOK_SECRET'
  | 'TWILIO_ACCOUNT_SID'
  | 'TWILIO_AUTH_TOKEN'
  | 'TWILIO_MESSAGING_SERVICE_SID'
  | 'TWILIO_FROM_NUMBER'
  | 'TWILIO_STATUS_CALLBACK_URL';

export type VerificationProviderEnvironment = Cloudflare.Env & Partial<Record<VerificationSecretKey, string>>;

const PROVIDER_TIMEOUT_MS = 8_000;
const MESSAGE_ID_PATTERN = /^[A-Za-z0-9._:/-]{1,200}$/;
const EMAIL_PATTERN = /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/;
const E164_PATTERN = /^\+[1-9]\d{7,14}$/;
const TWILIO_ACCOUNT_PATTERN = /^AC[a-fA-F0-9]{32}$/;
const TWILIO_MESSAGE_PATTERN = /^SM[a-fA-F0-9]{32}$/;
const TWILIO_SERVICE_PATTERN = /^MG[a-fA-F0-9]{32}$/;

function secretValue(value: string | undefined, maxLength: number) {
  const normalized = (value || '').trim();
  return normalized.length <= maxLength ? normalized : '';
}

function providerSelection(channel: VerificationChannel, env: VerificationProviderEnvironment): VerificationProviderName {
  const raw = secretValue(channel === 'email' ? env.EMAIL_VERIFICATION_PROVIDER : env.SMS_VERIFICATION_PROVIDER, 24).toLowerCase();
  if (channel === 'email' && (raw === 'webhook' || raw === 'resend')) return raw;
  if (channel === 'sms' && (raw === 'webhook' || raw === 'twilio')) return raw;
  return 'disabled';
}

function strictHttpsUrl(raw: string | undefined) {
  const value = secretValue(raw, 2_000);
  if (!value) return null;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.hash) return null;
    return parsed;
  } catch {
    return null;
  }
}

function webhookUrl(channel: VerificationChannel, env: VerificationProviderEnvironment) {
  return strictHttpsUrl(channel === 'email'
    ? env.EMAIL_VERIFICATION_WEBHOOK_URL
    : env.SMS_VERIFICATION_WEBHOOK_URL);
}

function webhookSecret(channel: VerificationChannel, env: VerificationProviderEnvironment) {
  return secretValue(channel === 'email'
    ? env.EMAIL_VERIFICATION_WEBHOOK_SECRET
    : env.SMS_VERIFICATION_WEBHOOK_SECRET, 2_000);
}

function resendReady(env: VerificationProviderEnvironment) {
  const apiKey = secretValue(env.RESEND_API_KEY, 300);
  const from = secretValue(env.RESEND_FROM, 320);
  const webhookSecret = secretValue(env.RESEND_WEBHOOK_SECRET, 300);
  const address = from.match(/<([^<>]+)>$/)?.[1] || from;
  return apiKey.startsWith('re_') && apiKey.length >= 16
    && EMAIL_PATTERN.test(address)
    && webhookSecret.startsWith('whsec_')
    && webhookSecret.length >= 20;
}

function twilioReady(env: VerificationProviderEnvironment) {
  const accountSid = secretValue(env.TWILIO_ACCOUNT_SID, 80);
  const authToken = secretValue(env.TWILIO_AUTH_TOKEN, 200);
  const serviceSid = secretValue(env.TWILIO_MESSAGING_SERVICE_SID, 80);
  const from = secretValue(env.TWILIO_FROM_NUMBER, 30);
  return TWILIO_ACCOUNT_PATTERN.test(accountSid)
    && authToken.length >= 20
    && (TWILIO_SERVICE_PATTERN.test(serviceSid) || E164_PATTERN.test(from))
    && strictHttpsUrl(env.TWILIO_STATUS_CALLBACK_URL) !== null;
}

export function verificationProviderName(
  channel: VerificationChannel,
  env: VerificationProviderEnvironment
): VerificationProviderName {
  const selected = providerSelection(channel, env);
  if (selected === 'webhook') {
    return webhookUrl(channel, env) && webhookSecret(channel, env).length >= 16 ? 'webhook' : 'disabled';
  }
  if (selected === 'resend') return resendReady(env) ? 'resend' : 'disabled';
  if (selected === 'twilio') return twilioReady(env) ? 'twilio' : 'disabled';
  return 'disabled';
}

export function verificationProviderReady(channel: VerificationChannel, env: VerificationProviderEnvironment) {
  return verificationProviderName(channel, env) !== 'disabled';
}

function purposeLabel(purpose: VerificationPurpose) {
  if (purpose === 'register') return 'регистрации';
  if (purpose === 'password-reset') return 'восстановления пароля';
  return 'защищённого действия';
}

function verificationText(challenge: VerificationChallenge) {
  return `Код SQL Academy для ${purposeLabel(challenge.purpose)}: ${challenge.code}. Код действует 10 минут. Никому его не сообщайте.`;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character] || character);
}

async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit, timeoutMs = PROVIDER_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort('verification-provider-timeout'), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal, redirect: 'error' });
  } finally {
    clearTimeout(timeout);
  }
}

export class DisabledVerificationProvider implements VerificationProvider {
  readonly name = 'disabled' as const;
  async send(): Promise<never> {
    throw new Error('VERIFICATION_PROVIDER_DISABLED');
  }
}

export class WebhookVerificationProvider implements VerificationProvider {
  readonly name = 'webhook' as const;
  constructor(
    private readonly channel: VerificationChannel,
    private readonly url: URL,
    private readonly secret: string
  ) {}

  async send(challenge: VerificationChallenge) {
    if (challenge.channel !== this.channel) throw new Error('VERIFICATION_CHANNEL_MISMATCH');
    try {
      const response = await fetchWithTimeout(this.url, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.secret}`,
          'content-type': 'application/json; charset=utf-8',
          'idempotency-key': challenge.challengeId,
          'x-verification-contract': 'contact-verification-delivery-v1'
        },
        body: JSON.stringify({
          contract: 'contact-verification-delivery-v1',
          challengeId: challenge.challengeId,
          channel: challenge.channel,
          destination: challenge.destination,
          purpose: challenge.purpose,
          code: challenge.code,
          expiresAt: challenge.expiresAt
        })
      });
      if (!response.ok) throw new Error('VERIFICATION_PROVIDER_REJECTED');
      const header = (response.headers.get('x-verification-message-id') || '').trim();
      return {
        providerMessageId: MESSAGE_ID_PATTERN.test(header) ? `webhook:${header}` : `webhook:${challenge.challengeId}`,
        initialStatus: 'accepted' as const
      };
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('VERIFICATION_')) throw error;
      throw new Error('VERIFICATION_PROVIDER_UNAVAILABLE');
    }
  }
}

export class ResendVerificationProvider implements EmailVerificationProvider {
  readonly name = 'resend' as const;
  constructor(private readonly apiKey: string, private readonly from: string) {}

  async send(challenge: VerificationChallenge) {
    if (challenge.channel !== 'email') throw new Error('VERIFICATION_CHANNEL_MISMATCH');
    try {
      const response = await fetchWithTimeout('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          'content-type': 'application/json; charset=utf-8',
          'idempotency-key': `contact-verification/${challenge.challengeId}`
        },
        body: JSON.stringify({
          from: this.from,
          to: [challenge.destination],
          subject: 'Код подтверждения SQL Academy',
          text: verificationText(challenge),
          html: `<div style="font-family:system-ui,sans-serif;line-height:1.55"><h2>SQL Academy</h2><p>Код для ${escapeHtml(purposeLabel(challenge.purpose))}:</p><p style="font-size:28px;font-weight:800;letter-spacing:6px">${challenge.code}</p><p>Код действует 10 минут. Никому его не сообщайте.</p></div>`,
          headers: { 'X-Entity-Ref-ID': challenge.challengeId },
          tags: [
            { name: 'purpose', value: challenge.purpose },
            { name: 'channel', value: 'verification' }
          ]
        })
      });
      const payload = await response.json().catch(() => null) as { id?: string } | null;
      if (!response.ok || !payload?.id || !MESSAGE_ID_PATTERN.test(payload.id)) {
        throw new Error('VERIFICATION_PROVIDER_REJECTED');
      }
      return { providerMessageId: `resend:${payload.id}`, initialStatus: 'accepted' as const };
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('VERIFICATION_')) throw error;
      throw new Error('VERIFICATION_PROVIDER_UNAVAILABLE');
    }
  }
}

export class TwilioVerificationProvider implements SmsVerificationProvider {
  readonly name = 'twilio' as const;
  constructor(
    private readonly accountSid: string,
    private readonly authToken: string,
    private readonly messagingServiceSid: string,
    private readonly fromNumber: string,
    private readonly statusCallback: URL
  ) {}

  async send(challenge: VerificationChallenge) {
    if (challenge.channel !== 'sms') throw new Error('VERIFICATION_CHANNEL_MISMATCH');
    const body = new URLSearchParams({
      To: challenge.destination,
      Body: verificationText(challenge),
      StatusCallback: this.statusCallback.toString()
    });
    if (this.messagingServiceSid) body.set('MessagingServiceSid', this.messagingServiceSid);
    else body.set('From', this.fromNumber);
    try {
      const response = await fetchWithTimeout(
        `https://api.twilio.com/2010-04-01/Accounts/${this.accountSid}/Messages.json`,
        {
          method: 'POST',
          headers: {
            authorization: `Basic ${btoa(`${this.accountSid}:${this.authToken}`)}`,
            'content-type': 'application/x-www-form-urlencoded;charset=UTF-8'
          },
          body: body.toString()
        }
      );
      const payload = await response.json().catch(() => null) as { sid?: string; status?: string } | null;
      if (!response.ok || !payload?.sid || !TWILIO_MESSAGE_PATTERN.test(payload.sid)) {
        throw new Error('VERIFICATION_PROVIDER_REJECTED');
      }
      return {
        providerMessageId: `twilio:${payload.sid}`,
        initialStatus: payload.status === 'queued' ? 'queued' as const : 'accepted' as const
      };
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('VERIFICATION_')) throw error;
      throw new Error('VERIFICATION_PROVIDER_UNAVAILABLE');
    }
  }
}

class ObservedVerificationProvider implements VerificationProvider {
  readonly name: VerificationProviderName;
  constructor(
    private readonly inner: VerificationProvider,
    private readonly env: VerificationProviderEnvironment
  ) {
    this.name = inner.name;
  }

  async send(challenge: VerificationChallenge) {
    try {
      const delivery = await this.inner.send(challenge);
      if (this.name !== 'disabled') {
        await recordInitialContactDelivery(this.env, {
          provider: this.name,
          providerMessageId: delivery.providerMessageId,
          challengeId: challenge.challengeId,
          channel: challenge.channel,
          status: delivery.initialStatus,
          occurredAt: new Date().toISOString()
        });
      }
      return delivery;
    } catch (error) {
      await recordContactSecurityEvent(this.env, {
        eventType: 'challenge-provider-failed',
        challengeId: challenge.challengeId,
        channel: challenge.channel,
        purpose: challenge.purpose
      });
      throw error;
    }
  }
}

function rawVerificationProvider(
  channel: VerificationChannel,
  env: VerificationProviderEnvironment
): VerificationProvider {
  const name = verificationProviderName(channel, env);
  if (name === 'webhook') {
    return new WebhookVerificationProvider(channel, webhookUrl(channel, env)!, webhookSecret(channel, env));
  }
  if (name === 'resend') {
    return new ResendVerificationProvider(secretValue(env.RESEND_API_KEY, 300), secretValue(env.RESEND_FROM, 320));
  }
  if (name === 'twilio') {
    return new TwilioVerificationProvider(
      secretValue(env.TWILIO_ACCOUNT_SID, 80),
      secretValue(env.TWILIO_AUTH_TOKEN, 200),
      secretValue(env.TWILIO_MESSAGING_SERVICE_SID, 80),
      secretValue(env.TWILIO_FROM_NUMBER, 30),
      strictHttpsUrl(env.TWILIO_STATUS_CALLBACK_URL)!
    );
  }
  return new DisabledVerificationProvider();
}

export function verificationProvider(
  channel: VerificationChannel,
  env: VerificationProviderEnvironment
): VerificationProvider {
  return new ObservedVerificationProvider(rawVerificationProvider(channel, env), env);
}