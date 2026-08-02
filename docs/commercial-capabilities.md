# Commercial capabilities and allowed origins

## Purpose

The Cloudflare Free deployment supports username/password authentication and one-time recovery codes. The public `GET /api/capabilities` endpoint exposes only functionality that is genuinely available through the versioned `commercial-capabilities-v1` contract.

Only enabled/disabled states are public. Provider names, secret presence, destination data, hostnames and operator allowlists are never returned.

## Current default response

```json
{
  "contract": "commercial-capabilities-v1",
  "authentication": {
    "usernamePassword": true,
    "recoveryCodes": true
  },
  "integrations": {
    "emailVerification": { "enabled": false },
    "smsVerification": { "enabled": false },
    "turnstile": { "enabled": false },
    "adminConsole": { "enabled": false }
  }
}
```

## Verified-contact readiness

Email verification becomes enabled only when all of these are present:

- `FEATURE_EMAIL_VERIFICATION=on`;
- `CONTACT_VERIFICATION_SIGNING_SECRET` stored as a Cloudflare secret;
- `EMAIL_VERIFICATION_WEBHOOK_URL` stored as a Cloudflare secret and using HTTPS;
- `EMAIL_VERIFICATION_WEBHOOK_SECRET` stored as a Cloudflare secret.

SMS uses the equivalent `FEATURE_SMS_VERIFICATION`, `SMS_VERIFICATION_WEBHOOK_URL` and `SMS_VERIFICATION_WEBHOOK_SECRET` values while sharing the signing secret.

The challenge core provides expiry, resend cooldown, bounded challenge frequency, five code attempts, HMAC-protected destination/code evidence and a short-lived one-time signed ticket. D1 stores only a destination digest and masked display value—never the raw email/phone or plaintext code.

The provider webhook receives the raw destination only for delivery. SQL Academy sends a bounded `contact-verification-delivery-v1` JSON request over HTTPS with a bearer secret and idempotency key. Provider responses are not read as unbounded bodies.

`POST /api/auth/contact/challenge` and `POST /api/auth/contact/confirm` return `404` while neither channel is completely configured. A flag alone cannot publish or expose an incomplete capability.

### Honest authentication boundary

CR2B does not yet bind a confirmed ticket to registration, login or password reset. Current authentication remains username/password plus recovery codes. Those account flows are CR2C work and must consume the ticket atomically before changing account state.

## Turnstile

Turnstile becomes enabled only when all of these are present:

- `FEATURE_TURNSTILE=on`;
- `TURNSTILE_SECRET_KEY` stored as a Cloudflare secret;
- at least one exact hostname in `TURNSTILE_EXPECTED_HOSTNAMES`.

The Worker validates the Siteverify response, exact hostname and exact action (`register`, `login` or `password-reset`). Missing or incomplete configuration returns a temporary verification failure instead of bypassing protection.

## Operator health

The aggregate operator-health route becomes enabled only when:

- `FEATURE_ADMIN_CONSOLE=on`;
- `ADMIN_ALLOWED_USER_IDS` contains at least one valid internal user ID.

`GET /api/admin/health` returns `404` when disabled, incomplete or requested by a non-allowlisted account. When available, it exposes aggregate counts and binding/configuration health only—no usernames, contact details, SQL, learner answers or event payloads.

## Allowed origins

API CORS origins are supplied through `ALLOWED_ORIGINS` as a comma-separated list of exact origins.

```text
https://academy.example.com
https://staging.academy.example.com
http://localhost:4173
```

Wildcards, credentials, paths, query strings, fragments and non-HTTP(S) schemes are ignored. Missing valid cross-origin configuration fails closed; same-origin API requests continue to work.

The deployment workflow copies public origin and feature variables into the generated production Wrangler config. Contact provider URLs, signing material and provider credentials remain Cloudflare secrets and are never written into that file.

## Activation sequence

1. Create a buyer-owned staging Worker, D1 and KV namespace.
2. Configure exact origins and public feature flags while all optional flags remain `off`.
3. Add provider URLs and credentials with `wrangler secret put`.
4. Apply D1 migrations and deploy staging.
5. Run the full Quality gate and provider failure tests.
6. Enable one staging channel and verify `/api/capabilities`, challenge expiry, rate limits, replay rejection and provider monitoring.
7. Keep learner authentication UI hidden until CR2C ticket consumption is implemented and accepted.
8. Enable production only after staging evidence is retained.
9. Roll back by returning the server feature flag to `off`.

Frontend variables cannot enable a protected server capability.
