/**
 * Commercial verification provider boundary.
 *
 * The Free deployment keeps every provider disabled. A buyer can attach a
 * private HTTPS adapter only after outbound delivery, signed delivery events,
 * abuse monitoring and legal acceptance are in place. Provider credentials are
 * Cloudflare secrets and are never written to Wrangler vars or source control.
 */
export type VerificationChannel = 'email' | 'sms';
export type VerificationPurpose = 'register' | 'password-reset' | 'sensitive-action';

export type VerificationChallenge = {
  challengeId: string;
  channel: VerificationChannel;
  destination: string;
  purpose: VerificationPurpose;
  code: string;
  expiresAt: string;
};

export interface VerificationProvider {
  send(challenge: VerificationChallenge): Promise<{ providerMessageId: string }>;
}

export interface EmailVerificationProvider extends VerificationProvider {}
export interface SmsVerificationProvider extends VerificationProvider {}

type VerificationSecretKey =
  | 'EMAIL_VERIFICATION_WEBHOOK_URL'
  | 'EMAIL_VERIFICATION_WEBHOOK_SECRET'
  | 'EMAIL_VERIFICATION_EVENT_SECRET'
  | 'SMS_VERIFICATION_WEBHOOK_URL'
  | 'SMS_VERIFICATION_WEBHOOK_SECRET'
  | 'SMS_VERIFICATION_EVENT_SECRET';

export type VerificationProviderEnvironment = Cloudflare.Env & Partial<Record<VerificationSecretKey, string>>;

const WEBHOOK_TIMEOUT_MS = 5_000;
const MESSAGE_ID_PATTERN = /^[A-Za-z0-9._:/-]{1,160}$/;

function secretValue(value: string | undefined, maxLength: number) {
  const normalized = (value || '').trim();
  return normalized.length <= maxLength ? normalized : '';
}

function webhookUrl(channel: VerificationChannel, env: VerificationProviderEnvironment) {
  const raw = secretValue(channel === 'email'
    ? env.EMAIL_VERIFICATION_WEBHOOK_URL
    : env.SMS_VERIFICATION_WEBHOOK_URL, 2_000);
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.hash) return null;
    return parsed;
  } catch {
    return null;
  }
}

function webhookSecret(channel: VerificationChannel, env: VerificationProviderEnvironment) {
  return secretValue(channel === 'email'
    ? env.EMAIL_VERIFICATION_WEBHOOK_SECRET
    : env.SMS_VERIFICATION_WEBHOOK_SECRET, 2_000);
}

export function verificationEventSecret(channel: VerificationChannel, env: VerificationProviderEnvironment) {
  return secretValue(channel === 'email'
    ? env.EMAIL_VERIFICATION_EVENT_SECRET
    : env.SMS_VERIFICATION_EVENT_SECRET, 2_000);
}

export function verificationProviderReady(channel: VerificationChannel, env: VerificationProviderEnvironment) {
  return webhookUrl(channel, env) !== null
    && webhookSecret(channel, env).length >= 16
    && verificationEventSecret(channel, env).length >= 32;
}

export class DisabledVerificationProvider implements VerificationProvider {
  async send(): Promise<never> {
    throw new Error('VERIFICATION_PROVIDER_DISABLED');
  }
}

export class WebhookVerificationProvider implements VerificationProvider {
  constructor(
    private readonly channel: VerificationChannel,
    private readonly url: URL,
    private readonly secret: string
  ) {}

  async send(challenge: VerificationChallenge): Promise<{ providerMessageId: string }> {
    if (challenge.channel !== this.channel) throw new Error('VERIFICATION_CHANNEL_MISMATCH');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort('verification-provider-timeout'), WEBHOOK_TIMEOUT_MS);
    try {
      const response = await fetch(this.url, {
        method: 'POST',
        redirect: 'error',
        signal: controller.signal,
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
        providerMessageId: MESSAGE_ID_PATTERN.test(header)
          ? header
          : `webhook:${challenge.challengeId}`
      };
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('VERIFICATION_')) throw error;
      throw new Error('VERIFICATION_PROVIDER_UNAVAILABLE');
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function verificationProvider(
  channel: VerificationChannel,
  env: VerificationProviderEnvironment
): VerificationProvider {
  const url = webhookUrl(channel, env);
  const secret = webhookSecret(channel, env);
  if (!url || secret.length < 16 || verificationEventSecret(channel, env).length < 32) {
    return new DisabledVerificationProvider();
  }
  return new WebhookVerificationProvider(channel, url, secret);
}