import type { AuthResponse } from './auth';

export type VerificationChannel = 'email' | 'sms';
export type VerificationPurpose = 'register' | 'password-reset' | 'sensitive-action';

export type CommercialCapabilities = {
  contract: 'commercial-capabilities-v1';
  authentication: {
    usernamePassword: true;
    recoveryCodes: true;
  };
  integrations: {
    emailVerification: { enabled: boolean };
    smsVerification: { enabled: boolean };
    turnstile: { enabled: boolean; siteKey?: string };
    adminConsole: { enabled: boolean };
  };
};

export type ContactChallenge = {
  challengeId: string;
  channel: VerificationChannel;
  purpose: VerificationPurpose;
  maskedDestination: string;
  expiresAt: string;
  resendAt: string;
  attempts: number;
};

export type ContactConfirmation = {
  verified: true;
  ticket: string;
  channel: VerificationChannel;
  purpose: VerificationPurpose;
  maskedDestination: string;
  expiresAt: string;
};

export type VerifiedContact = {
  id: string;
  channel: VerificationChannel;
  maskedDestination: string;
  verifiedAt: string;
  createdAt: string;
};

export class ContactApiError extends Error {
  status: number;
  retryAfter?: number;
  attemptsRemaining?: number;
  code?: string;

  constructor(message: string, response: Response, payload: Record<string, unknown>) {
    super(message);
    this.name = 'ContactApiError';
    this.status = response.status;
    this.retryAfter = Number(response.headers.get('retry-after')) || undefined;
    this.attemptsRemaining = typeof payload.attemptsRemaining === 'number'
      ? Math.max(0, payload.attemptsRemaining)
      : undefined;
    this.code = typeof payload.code === 'string' ? payload.code : undefined;
  }
}

async function parseResponse<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => ({ error: `HTTP ${response.status}` })) as T & Record<string, unknown>;
  if (!response.ok) {
    throw new ContactApiError(
      typeof payload.error === 'string' ? payload.error : `HTTP ${response.status}`,
      response,
      payload
    );
  }
  return payload;
}

function deviceName() {
  const platform = navigator.userAgentData?.platform || navigator.platform || 'Браузер';
  const mobile = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
  return `${mobile ? 'Телефон' : 'ПК'} · ${platform}`.slice(0, 64);
}

export async function fetchCommercialCapabilities() {
  return parseResponse<CommercialCapabilities>(await fetch('/api/capabilities', {
    headers: { accept: 'application/json' }
  }));
}

export async function createContactChallenge(input: {
  channel: VerificationChannel;
  purpose: VerificationPurpose;
  destination: string;
}) {
  return parseResponse<ContactChallenge>(await fetch('/api/auth/contact/challenge', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input)
  }));
}

export async function confirmContactChallenge(challengeId: string, code: string) {
  return parseResponse<ContactConfirmation>(await fetch('/api/auth/contact/confirm', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ challengeId, code })
  }));
}

export async function registerWithVerifiedContact(input: {
  username: string;
  password: string;
  displayName?: string;
  contactTicket: string;
}) {
  return parseResponse<AuthResponse & { contacts: Array<Pick<VerifiedContact, 'channel' | 'maskedDestination' | 'verifiedAt'>> }>(
    await fetch('/api/auth/contact/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...input, deviceName: deviceName() })
    })
  );
}

export async function resetPasswordWithVerifiedContact(contactTicket: string, newPassword: string) {
  return parseResponse<{ ok: true; message: string }>(await fetch('/api/auth/contact/password/reset', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ contactTicket, newPassword })
  }));
}

export async function listVerifiedContacts() {
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
