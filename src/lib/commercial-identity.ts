import type { AuthResponse } from './auth';

export type VerificationChannel = 'email' | 'sms';
export type VerificationPurpose = 'register' | 'password-reset' | 'sensitive-action';
export type TurnstileAction = 'login' | 'contact-challenge' | 'contact-register' | 'contact-password-reset';
export type ContactRegistrationPolicy = 'optional' | 'required-for-new-registration';

export type CommercialCapabilities = {
  contract: 'commercial-capabilities-v1';
  authentication: {
    usernamePassword: true;
    recoveryCodes: true;
    contactLogin: {
      passwordRequired: true;
      email: { enabled: boolean };
      sms: { enabled: boolean };
    };
  };
  registration: {
    contactPolicy: ContactRegistrationPolicy;
    policyReady: boolean;
    contactlessAllowed: boolean;
  };
  integrations: {
    emailVerification: { enabled: boolean };
    smsVerification: { enabled: boolean };
    turnstile: { enabled: boolean };
    adminConsole: { enabled: boolean };
  };
};

export type VerificationChallenge = {
  challengeId: string;
  channel: VerificationChannel;
  purpose: VerificationPurpose;
  maskedDestination: string;
  expiresAt: string;
  resendAt: string;
  attempts: number;
};

export type VerificationConfirmation = {
  verified: true;
  ticket: string;
  channel: VerificationChannel;
  purpose: VerificationPurpose;
  maskedDestination: string;
  expiresAt: string;
};

export type VerifiedContact = {
  id?: string;
  channel: VerificationChannel;
  maskedDestination: string;
  verifiedAt: string;
  createdAt?: string;
};

type TurnstileWidgetOptions = {
  sitekey: string;
  action: TurnstileAction;
  theme: 'auto';
  size: 'flexible';
  appearance: 'interaction-only';
  execution: 'execute';
  retry: 'auto';
  'refresh-expired': 'never';
  callback: (token: string) => void;
  'error-callback': () => void;
  'expired-callback': () => void;
  'timeout-callback': () => void;
};

type TurnstileApi = {
  render: (target: HTMLElement, options: TurnstileWidgetOptions) => string;
  execute: (widgetId: string) => void;
  remove: (widgetId: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const TURNSTILE_SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
const TURNSTILE_SITE_KEY = String(import.meta.env.VITE_TURNSTILE_SITE_KEY || '').trim();
const MAX_ERROR_TEXT = 240;
let capabilitiesPromise: Promise<CommercialCapabilities> | null = null;
let turnstileScriptPromise: Promise<TurnstileApi> | null = null;

function disabledCapabilities(): CommercialCapabilities {
  return {
    contract: 'commercial-capabilities-v1',
    authentication: {
      usernamePassword: true,
      recoveryCodes: true,
      contactLogin: {
        passwordRequired: true,
        email: { enabled: false },
        sms: { enabled: false }
      }
    },
    registration: {
      contactPolicy: 'optional',
      policyReady: true,
      contactlessAllowed: true
    },
    integrations: {
      emailVerification: { enabled: false },
      smsVerification: { enabled: false },
      turnstile: { enabled: false },
      adminConsole: { enabled: false }
    }
  };
}

function booleanCapability(value: unknown) {
  return typeof value === 'object'
    && value !== null
    && !Array.isArray(value)
    && typeof (value as { enabled?: unknown }).enabled === 'boolean'
    ? Boolean((value as { enabled: boolean }).enabled)
    : null;
}

function parseCapabilities(value: unknown): CommercialCapabilities | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  const authentication = candidate.authentication as Record<string, unknown> | undefined;
  const integrations = candidate.integrations as Record<string, unknown> | undefined;
  if (candidate.contract !== 'commercial-capabilities-v1'
    || authentication?.usernamePassword !== true
    || authentication?.recoveryCodes !== true
    || !integrations) return null;

  const parsedIntegrations = {
    emailVerification: booleanCapability(integrations.emailVerification),
    smsVerification: booleanCapability(integrations.smsVerification),
    turnstile: booleanCapability(integrations.turnstile),
    adminConsole: booleanCapability(integrations.adminConsole)
  };
  if (Object.values(parsedIntegrations).some(item => item === null)) return null;

  const rawContactLogin = authentication.contactLogin as Record<string, unknown> | undefined;
  const emailLogin = booleanCapability(rawContactLogin?.email) === true;
  const smsLogin = booleanCapability(rawContactLogin?.sms) === true;
  const passwordRequired = rawContactLogin?.passwordRequired === true;
  const rawRegistration = candidate.registration as Record<string, unknown> | undefined;
  const contactPolicy: ContactRegistrationPolicy = rawRegistration?.contactPolicy === 'required-for-new-registration'
    ? 'required-for-new-registration'
    : 'optional';
  const policyReady = typeof rawRegistration?.policyReady === 'boolean'
    ? rawRegistration.policyReady
    : contactPolicy === 'optional';
  const contactlessAllowed = typeof rawRegistration?.contactlessAllowed === 'boolean'
    ? rawRegistration.contactlessAllowed
    : contactPolicy === 'optional';

  return {
    contract: 'commercial-capabilities-v1',
    authentication: {
      usernamePassword: true,
      recoveryCodes: true,
      contactLogin: {
        passwordRequired: passwordRequired || (!emailLogin && !smsLogin),
        email: { enabled: passwordRequired && emailLogin },
        sms: { enabled: passwordRequired && smsLogin }
      }
    },
    registration: { contactPolicy, policyReady, contactlessAllowed },
    integrations: {
      emailVerification: { enabled: parsedIntegrations.emailVerification === true },
      smsVerification: { enabled: parsedIntegrations.smsVerification === true },
      turnstile: { enabled: parsedIntegrations.turnstile === true },
      adminConsole: { enabled: parsedIntegrations.adminConsole === true }
    }
  };
}

async function parseResponse<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => ({ error: `HTTP ${response.status}` })) as T & {
    error?: string;
  };
  if (!response.ok) {
    const error = new Error(String(payload.error || `HTTP ${response.status}`).slice(0, MAX_ERROR_TEXT)) as Error & {
      status?: number;
      retryAfter?: number;
      payload?: unknown;
    };
    error.status = response.status;
    error.retryAfter = Number(response.headers.get('retry-after')) || undefined;
    error.payload = payload;
    throw error;
  }
  return payload;
}

export async function loadCommercialCapabilities(force = false) {
  if (force) capabilitiesPromise = null;
  if (!capabilitiesPromise) {
    capabilitiesPromise = fetch('/api/capabilities', {
      headers: { accept: 'application/json' },
      cache: 'no-store'
    }).then(async response => {
      if (!response.ok) return disabledCapabilities();
      return parseCapabilities(await response.json().catch(() => null)) || disabledCapabilities();
    }).catch(() => disabledCapabilities());
  }
  return capabilitiesPromise;
}

export function enabledContactChannels(capabilities: CommercialCapabilities) {
  const channels: VerificationChannel[] = [];
  if (capabilities.integrations.emailVerification.enabled) channels.push('email');
  if (capabilities.integrations.smsVerification.enabled) channels.push('sms');
  return channels;
}

export function enabledContactLoginChannels(capabilities: CommercialCapabilities) {
  const channels: VerificationChannel[] = [];
  if (capabilities.authentication.contactLogin.email.enabled) channels.push('email');
  if (capabilities.authentication.contactLogin.sms.enabled) channels.push('sms');
  return channels;
}

export function contactUiReady(capabilities: CommercialCapabilities) {
  const channels = enabledContactChannels(capabilities);
  return channels.length > 0
    && (!capabilities.integrations.turnstile.enabled || TURNSTILE_SITE_KEY.length >= 8);
}

export function contactLoginUiReady(capabilities: CommercialCapabilities) {
  const channels = enabledContactLoginChannels(capabilities);
  return capabilities.authentication.contactLogin.passwordRequired
    && channels.length > 0
    && (!capabilities.integrations.turnstile.enabled || TURNSTILE_SITE_KEY.length >= 8);
}

function loadTurnstileScript(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (turnstileScriptPromise) return turnstileScriptPromise;
  turnstileScriptPromise = new Promise<TurnstileApi>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-sql-academy-turnstile]');
    const script = existing || document.createElement('script');
    const timeout = window.setTimeout(() => reject(new Error('Проверка браузера не загрузилась.')), 15_000);
    const finish = () => {
      window.clearTimeout(timeout);
      if (window.turnstile) resolve(window.turnstile);
      else reject(new Error('Проверка браузера недоступна.'));
    };
    script.addEventListener('load', finish, { once: true });
    script.addEventListener('error', () => {
      window.clearTimeout(timeout);
      reject(new Error('Проверка браузера заблокирована сетью или расширением.'));
    }, { once: true });
    if (!existing) {
      script.src = TURNSTILE_SCRIPT;
      script.async = true;
      script.defer = true;
      script.dataset.sqlAcademyTurnstile = 'true';
      document.head.append(script);
    }
  }).catch(error => {
    turnstileScriptPromise = null;
    throw error;
  });
  return turnstileScriptPromise;
}

async function turnstileToken(capabilities: CommercialCapabilities, action: TurnstileAction) {
  if (!capabilities.integrations.turnstile.enabled) return '';
  if (TURNSTILE_SITE_KEY.length < 8) throw new Error('Контактная проверка временно недоступна: отсутствует публичный Turnstile site key.');
  const api = await loadTurnstileScript();
  const host = document.createElement('div');
  host.className = 'commercial-turnstile-host';
  host.setAttribute('aria-label', 'Проверка безопасности');
  document.body.append(host);
  return new Promise<string>((resolve, reject) => {
    let settled = false;
    let widgetId = '';
    const timer = window.setTimeout(() => finish('', new Error('Проверка безопасности заняла слишком много времени.')), 120_000);
    const finish = (token: string, error?: Error) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      if (widgetId) api.remove(widgetId);
      host.remove();
      if (error) reject(error);
      else resolve(token);
    };
    widgetId = api.render(host, {
      sitekey: TURNSTILE_SITE_KEY,
      action,
      theme: 'auto',
      size: 'flexible',
      appearance: 'interaction-only',
      execution: 'execute',
      retry: 'auto',
      'refresh-expired': 'never',
      callback: token => finish(token),
      'error-callback': () => finish('', new Error('Проверка безопасности завершилась ошибкой.')),
      'expired-callback': () => finish('', new Error('Проверка безопасности истекла. Повтори действие.')),
      'timeout-callback': () => finish('', new Error('Проверка безопасности не была завершена.'))
    });
    api.execute(widgetId);
  });
}

function protectedHeaders(token: string) {
  return {
    'content-type': 'application/json',
    ...(token ? { 'cf-turnstile-response': token } : {})
  };
}

export async function loginWithVerifiedContact(
  capabilities: CommercialCapabilities,
  input: { channel: VerificationChannel; identifier: string; password: string; deviceName: string }
) {
  if (!enabledContactLoginChannels(capabilities).includes(input.channel)) {
    throw new Error('Вход через этот контакт сейчас недоступен.');
  }
  const token = await turnstileToken(capabilities, 'login');
  return parseResponse<AuthResponse>(await fetch('/api/auth/login', {
    method: 'POST',
    headers: protectedHeaders(token),
    body: JSON.stringify({
      identifierType: input.channel,
      identifier: input.identifier,
      password: input.password,
      deviceName: input.deviceName
    })
  }));
}

export async function requestContactChallenge(
  capabilities: CommercialCapabilities,
  input: { channel: VerificationChannel; purpose: VerificationPurpose; destination: string }
) {
  const token = await turnstileToken(capabilities, 'contact-challenge');
  return parseResponse<VerificationChallenge>(await fetch('/api/auth/contact/challenge', {
    method: 'POST',
    headers: protectedHeaders(token),
    body: JSON.stringify(input)
  }));
}

export async function confirmContactChallenge(challengeId: string, code: string) {
  return parseResponse<VerificationConfirmation>(await fetch('/api/auth/contact/confirm', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ challengeId, code })
  }));
}

function deviceName() {
  const platform = navigator.userAgentData?.platform || navigator.platform || 'Браузер';
  const mobile = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
  return `${mobile ? 'Телефон' : 'ПК'} · ${platform}`.slice(0, 64);
}

export async function registerWithVerifiedContact(
  capabilities: CommercialCapabilities,
  input: { username: string; password: string; displayName?: string; contactTicket: string }
) {
  const token = await turnstileToken(capabilities, 'contact-register');
  return parseResponse<AuthResponse & { contacts: VerifiedContact[] }>(await fetch('/api/auth/contact/register', {
    method: 'POST',
    headers: protectedHeaders(token),
    body: JSON.stringify({ ...input, deviceName: deviceName() })
  }));
}

export async function resetPasswordWithVerifiedContact(
  capabilities: CommercialCapabilities,
  contactTicket: string,
  newPassword: string
) {
  const token = await turnstileToken(capabilities, 'contact-password-reset');
  return parseResponse<{ ok: true; message: string }>(await fetch('/api/auth/contact/password/reset', {
    method: 'POST',
    headers: protectedHeaders(token),
    body: JSON.stringify({ contactTicket, newPassword })
  }));
}

export async function fetchVerifiedContacts() {
  return parseResponse<{ contacts: VerifiedContact[] }>(await fetch('/api/auth/contacts', {
    headers: { accept: 'application/json' }
  }));
}

export async function attachVerifiedContact(contactTicket: string, currentPassword: string) {
  return parseResponse<{ ok: true; contacts: VerifiedContact[] }>(await fetch('/api/auth/contact/attach', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ contactTicket, currentPassword })
  }));
}
