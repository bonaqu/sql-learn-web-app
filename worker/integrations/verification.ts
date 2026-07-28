/**
 * Commercial verification provider boundary.
 *
 * The Free deployment does not import or call a provider. A buyer can implement
 * one of these adapters and enable the matching server-side feature flag only
 * after secrets, legal copy, abuse controls and delivery monitoring exist.
 */
export type VerificationPurpose = 'register' | 'password-reset' | 'sensitive-action';

export type VerificationChallenge = {
  destination: string;
  purpose: VerificationPurpose;
  code: string;
  expiresAt: string;
};

export interface EmailVerificationProvider {
  send(challenge: VerificationChallenge): Promise<{ providerMessageId: string }>;
}

export interface SmsVerificationProvider {
  send(challenge: VerificationChallenge): Promise<{ providerMessageId: string }>;
}

export class DisabledVerificationProvider implements EmailVerificationProvider, SmsVerificationProvider {
  async send(): Promise<never> {
    throw new Error('VERIFICATION_PROVIDER_DISABLED');
  }
}
