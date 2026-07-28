# Commercial runtime activation

This guide covers the optional commercial runtime added after the guided learner journey. The current Free deployment intentionally keeps every optional capability off.

## Public capability contract

`GET /api/capabilities` exposes only non-sensitive facts:

- product name and deployment environment;
- username/password and recovery-code availability;
- enabled/disabled state for email verification, SMS verification, Turnstile and the operator console.

It never exposes provider names, endpoints, secrets, allowlisted users or configuration errors.

## Activation invariant

A feature is active only when both conditions are true:

1. its server-side `FEATURE_*` variable is enabled;
2. every required provider value, secret and allowlist is valid.

Frontend variables cannot enable a server feature. An incomplete configuration remains disabled or fails closed.

## Recommended order

1. Create buyer-owned staging Worker, D1 and KV resources.
2. Configure `PRODUCT_NAME`, `DEPLOYMENT_ENVIRONMENT`, `ALLOWED_ORIGINS` and buyer domains.
3. Add provider secrets with `wrangler secret put`; never store them in GitHub or Wrangler JSON.
4. Configure provider endpoints, senders, hostnames and allowlists as non-secret Worker variables.
5. Deploy staging while the feature flag is still `off`.
6. Run PR Quality and the production health probe against staging.
7. Set the feature flag to `on` in staging.
8. Verify capability state and provider-specific integration tests.
9. Enable production only after staging evidence is retained.
10. Roll back immediately by returning the server feature flag to `off`.

## Turnstile

Required configuration:

- `FEATURE_TURNSTILE=on`;
- `TURNSTILE_SECRET_KEY` as a Cloudflare secret;
- `TURNSTILE_EXPECTED_HOSTNAMES` as a comma-separated exact hostname allowlist;
- a matching frontend site key and action names.

Protected public actions:

- registration → `register`;
- login → `login`;
- password reset → `password-reset`.

The Worker validates the token through Siteverify, checks the exact hostname and action, and rejects missing, invalid or unavailable verification. The current production keeps the flag off, so username/password/recovery-code behavior is unchanged.

## Operator health

Required configuration:

- `FEATURE_ADMIN_CONSOLE=on`;
- `ADMIN_ALLOWED_USER_IDS` containing existing internal user IDs.

The route is `GET /api/admin/health`. When disabled, incomplete or requested by a non-allowlisted account, it returns `404`. The response contains only aggregate counts, binding health, capability state and latest aggregate timestamps. It contains no usernames, contact details, SQL, learner answers or event payloads.

## Email and SMS boundary

CR2A validates provider completeness and keeps capability flags false until a provider endpoint, API key and sender are configured. It does **not** yet implement contact challenge persistence, code expiry, one-time signed registration tickets or contact-based login/reset. Those belong to the next provider-backed identity phase and must not be represented as complete.

## CORS

`ALLOWED_ORIGINS` is a comma-separated list of exact origins, for example:

```text
https://academy.example.com,https://admin.example.com
```

Invalid entries are ignored. Wildcards are not supported. Local development origins remain available for Playwright and local work.

## Production probe

Set the GitHub repository variable `PRODUCTION_HEALTH_URL` to the deployed Worker or application origin. The scheduled workflow checks `/api/health` and `/api/capabilities` every six hours. Optional repository variables can assert expected feature states:

- `EXPECT_EMAIL_VERIFICATION`;
- `EXPECT_SMS_VERIFICATION`;
- `EXPECT_TURNSTILE`;
- `EXPECT_ADMIN_CONSOLE`.

Without `PRODUCTION_HEALTH_URL`, the workflow exits successfully with an explicit inactive message rather than probing an invented target.
