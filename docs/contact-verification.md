# Verified-contact challenge core

## Scope

This document describes CR2B: a provider-neutral challenge and confirmation primitive for email and SMS. It does not enable contact-based registration, login or password reset. Those account mutations remain CR2C work.

## API

### Request a challenge

`POST /api/auth/contact/challenge`

```json
{
  "channel": "email",
  "purpose": "register",
  "destination": "learner@example.com"
}
```

Supported channels are `email` and `sms`. Supported purposes are `register`, `password-reset` and `sensitive-action`.

A successful request returns `202` with a random challenge ID, masked destination, expiry, resend time and attempt count. It never returns the code or normalized destination.

### Confirm a challenge

`POST /api/auth/contact/confirm`

```json
{
  "challengeId": "00000000-0000-4000-8000-000000000001",
  "code": "123456"
}
```

A successful confirmation returns a short-lived signed ticket. Repeating the same correct confirmation before consumption returns the same deterministic ticket lifetime. The ticket contains no raw destination and is bound to challenge ID, channel, purpose and destination digest.

CR2C must call `consumeContactVerificationTicket` atomically before creating an account, attaching a contact or resetting credentials. A consumed ticket cannot be reused.

## Persistence and privacy

D1 stores:

- random challenge ID;
- channel and purpose;
- HMAC-SHA-256 destination digest;
- masked destination for safe user feedback;
- HMAC-SHA-256 code verifier;
- bounded provider message ID;
- remaining attempts and lifecycle timestamps.

D1 does not store:

- raw email address;
- raw phone number;
- plaintext verification code;
- provider credential;
- signed ticket.

The Worker does not log destinations or codes. The raw destination exists only in memory long enough to send the bounded delivery request to the buyer-owned provider webhook.

## Abuse and replay controls

- six-digit code generated with Web Crypto rejection sampling;
- ten-minute challenge expiry;
- one-minute resend cooldown;
- at most three challenges per destination/channel/purpose in fifteen minutes;
- five confirmation attempts;
- provider request timeout and redirect rejection;
- HTTPS-only provider URL;
- provider idempotency key equal to challenge ID;
- HMAC-signed ten-minute ticket;
- atomic `consumed_at IS NULL` transition for one-time use;
- disabled or incomplete endpoints fail closed and remain hidden.

These controls are an engineering baseline, not proof of resistance to every abuse pattern. A buyer must add provider-level delivery limits, bounce/fraud monitoring, alerting and independent security testing before activation.

## Secret matrix

Set each value with `wrangler secret put` in the buyer-owned environment:

- `CONTACT_VERIFICATION_SIGNING_SECRET`;
- `EMAIL_VERIFICATION_WEBHOOK_URL`;
- `EMAIL_VERIFICATION_WEBHOOK_SECRET`;
- `SMS_VERIFICATION_WEBHOOK_URL`;
- `SMS_VERIFICATION_WEBHOOK_SECRET`.

The URL is also treated as a secret because it may identify private delivery infrastructure. Feature flags remain ordinary non-secret Worker variables and default to `off`.

## Delivery webhook contract

The Worker sends HTTPS `POST` JSON:

```json
{
  "contract": "contact-verification-delivery-v1",
  "challengeId": "...",
  "channel": "email",
  "destination": "learner@example.com",
  "purpose": "register",
  "code": "123456",
  "expiresAt": "2026-08-02 03:10:00"
}
```

Headers include:

- `Authorization: Bearer <provider secret>`;
- `Idempotency-Key: <challenge ID>`;
- `X-Verification-Contract: contact-verification-delivery-v1`.

Any non-2xx response, timeout or redirect fails delivery. The webhook may return a bounded `X-Verification-Message-Id`; response bodies are ignored.

## Activation acceptance

Before enabling a channel in production, verify in staging:

1. capability remains disabled with any missing secret;
2. challenge endpoint stays hidden while disabled;
3. provider timeout, rejection and duplicate delivery behavior;
4. resend and fifteen-minute rate limits;
5. expiry and five-attempt lockout;
6. ticket tamper, wrong-purpose and replay rejection;
7. D1 contains no raw destination or code;
8. provider logs and retention meet buyer policy;
9. account-binding CR2C consumes tickets atomically;
10. rollback to `FEATURE_*_VERIFICATION=off` hides the flow immediately.
