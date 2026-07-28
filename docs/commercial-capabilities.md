# Commercial capabilities and allowed origins

## Purpose

The current Cloudflare Free deployment supports username/password authentication and one-time recovery codes. Commercial integrations remain dormant until a complete production adapter, secrets, operator runbook and tests exist.

The public `GET /api/capabilities` endpoint lets the client expose only functionality that is genuinely available. It returns the versioned contract header and payload `commercial-capabilities-v1`.

## Current response

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

Only enabled/disabled states are public. Provider names, secret presence, destination data and operator configuration are never returned.

## Fail-closed rule

`FEATURE_EMAIL_VERIFICATION`, `FEATURE_SMS_VERIFICATION`, `FEATURE_TURNSTILE` and `FEATURE_ADMIN_CONSOLE` default to `off`.

Changing a flag to `on` is intentionally insufficient. The matching capability remains disabled until its production implementation is present in the codebase and the feature has its own provider validation, abuse controls, operational documentation and automated tests. This prevents a buyer or operator from advertising security or account-recovery functionality that is not actually enforced.

## Allowed origins

API CORS origins are supplied through the Worker variable `ALLOWED_ORIGINS` as a comma-separated list of exact origins.

Accepted examples:

```text
https://academy.example.com
https://staging.academy.example.com
http://localhost:4173
```

Rejected or ignored entries include wildcards, credentials, paths, query strings, fragments and non-HTTP(S) schemes. When the variable is absent or contains no valid entries, cross-origin access fails closed; same-origin API requests continue to work.

The production and type-generation Wrangler configurations must remain aligned. Buyer-owned production and staging environments must set their own exact origin lists before deployment.

## Activation sequence for a future integration

1. Implement the server adapter and strict provider response validation.
2. Add rate limits, expiry, one-time use and replay protection where applicable.
3. Store credentials with Cloudflare secrets, never Wrangler `vars` or source control.
4. Add deterministic validation plus desktop/mobile production flows.
5. Add provider failure, timeout and missing-secret tests.
6. Update the capability implementation marker only after the entire flow is enforced.
7. Enable the feature flag in the buyer-owned environment.

A missing secret, unsupported provider, invalid flag or incomplete implementation must keep the capability disabled or make the protected operation fail closed.
