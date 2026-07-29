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

## Honest implementation boundary

Email and SMS remain disabled even when their flags are changed. Provider-backed challenge storage, expiry, one-time signed tickets and verified-contact authentication are CR2B/CR2C work.

Turnstile is implemented for public registration, login and password reset, but becomes enabled only when all of these are present:

- `FEATURE_TURNSTILE=on`;
- `TURNSTILE_SECRET_KEY` stored as a Cloudflare secret;
- at least one exact hostname in `TURNSTILE_EXPECTED_HOSTNAMES`.

The Worker validates the Siteverify response, exact hostname and exact action (`register`, `login` or `password-reset`). Missing or incomplete configuration returns a temporary verification failure instead of bypassing protection.

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

The deployment workflow copies the origin and feature variables into the generated production Wrangler config. Secrets are never written into that file.

## Activation sequence

1. Create a buyer-owned staging Worker, D1 and KV namespace.
2. Configure exact origins, hostnames and operator IDs while feature flags remain `off`.
3. Add secrets with `wrangler secret put`.
4. Deploy staging and run the full Quality gate.
5. Enable the staging flag.
6. Verify `/api/capabilities`, provider failure cases and the scheduled health probe.
7. Enable production only after staging evidence is retained.
8. Roll back by returning the server feature flag to `off`.

Frontend variables cannot enable a protected server capability.
