# Buyer-owned admin alert routing

SQL Academy can send aggregate operational alerts to a buyer-owned HTTPS endpoint. The integration is vendor-neutral, default-off and fail-closed. It does not send usernames, contact destinations, challenge IDs, provider message IDs, IP addresses, user agents, SQL text or learning evidence.

## Delivery contract

Each request is a `POST` with JSON contract `admin-alert-event-v1` and these headers:

- `x-sql-academy-alert-contract: admin-alert-event-v1`
- `x-sql-academy-alert-id: <UUID>`
- `x-sql-academy-alert-timestamp: <Unix seconds>`
- `x-sql-academy-alert-signature: sha256=<hex HMAC-SHA256>`

Verify the signature over the exact UTF-8 bytes of:

```text
<timestamp>.<raw request body>
```

Reject stale timestamps according to the receiver's policy and deduplicate by `x-sql-academy-alert-id`. The Worker follows redirects with `redirect: error`, so the configured endpoint must return a direct 2xx response within eight seconds.

The body contains:

- `status`: `firing`, `resolved` or `test`;
- `severity`: `info`, `warning` or `critical`;
- stable alert codes;
- aggregate 24-hour delivery/security metrics only;
- no account, destination or request identifiers.

## Delivery semantics

The current alert-code set is fingerprinted and stored in the existing `SETTINGS` KV namespace.

- A new or changed alert set is sent immediately.
- An unchanged firing set is sent again only after the configured cooldown.
- When the last active alert set clears, one `resolved` event is sent.
- A successful webhook response is recorded only after delivery succeeds.
- Delivery is intentionally at-least-once: a webhook can receive a duplicate if it accepted an event but the following KV write failed. Receivers must deduplicate by event ID.

KV is used only for alert-delivery state. D1 remains the source of aggregate health evidence.

## Required buyer configuration

Repository variables used by the Cloudflare deployment workflow:

| Variable | Example | Contract |
| --- | --- | --- |
| `FEATURE_ADMIN_ALERTS` | `on` | Anything except `on` keeps routing disabled. |
| `ADMIN_ALERT_CRON` | `17 * * * *` | Five-field Cloudflare Cron expression, evaluated in UTC. Empty means no trigger. |
| `ADMIN_ALERT_COOLDOWN_MINUTES` | `60` | Integer from 5 through 1440. |

Encrypted Worker secrets, never repository variables:

```bash
npx wrangler secret put ADMIN_ALERT_WEBHOOK_URL
npx wrangler secret put ADMIN_ALERT_WEBHOOK_SECRET
```

`ADMIN_ALERT_WEBHOOK_URL` must be a direct HTTPS URL without credentials or a fragment. Query parameters are accepted because some buyer-owned receivers use opaque route tokens; treat the entire URL as a secret.

`ADMIN_ALERT_WEBHOOK_SECRET` must contain at least 32 characters and must also be configured on the receiver. Do not reuse contact-verification, Turnstile, session or provider credentials.

The Cloudflare deployment workflow deliberately does not copy these two secrets into `wrangler.deploy.jsonc`. Existing encrypted Worker secrets remain owned by the buyer's Cloudflare account.

## Activation sequence

1. Deploy with `FEATURE_ADMIN_ALERTS=off` and `ADMIN_ALERT_CRON` empty.
2. Create the receiver and implement timestamp, HMAC and event-ID validation.
3. Add both Worker secrets with `wrangler secret put`.
4. Enable the existing admin console and allowlist an operator user ID if the protected test endpoint will be used.
5. Set `ADMIN_ALERT_CRON` and `ADMIN_ALERT_COOLDOWN_MINUTES` repository variables.
6. Set `FEATURE_ADMIN_ALERTS=on` and run the Cloudflare deployment workflow.
7. Authenticate as an allowlisted operator and inspect `GET /api/admin/alerts`. The response reports only safe readiness, schedule, cooldown, configuration-error codes and the last delivered alert codes/time.
8. Send a test with:

```json
{
  "mode": "test",
  "confirmation": "SEND_ADMIN_ALERT_TEST"
}
```

9. Optionally force evaluation of current aggregate health with:

```json
{
  "mode": "dispatch",
  "confirmation": "DISPATCH_CURRENT_ADMIN_ALERTS"
}
```

The manual dispatch respects the same aggregate-only payload contract but intentionally bypasses cooldown. It does not fabricate an alert when there is no active or recently resolved alert set.

## Safe disable and rotation

To stop scheduled delivery, set `FEATURE_ADMIN_ALERTS=off` and redeploy. The generated Wrangler configuration writes `triggers.crons: []`, which removes the managed Cron Trigger rather than leaving a dashboard-only trigger behind.

Rotate the webhook secret by updating the receiver first, replacing `ADMIN_ALERT_WEBHOOK_SECRET`, sending a protected test, and then retiring the old key. Rotate the URL with the same sequence.

Do not delete alert state from KV during ordinary rotation. Keeping the state prevents an unchanged incident from being resent immediately after deployment.

## Failure behavior

- Enabled but incomplete configuration is surfaced through `commercialConfigurationErrors`, `GET /api/admin/alerts` and failed scheduled-event logs.
- A non-2xx response, timeout, redirect or network error does not advance KV delivery state.
- Scheduled failures are awaited so Cloudflare records the Cron invocation as failed.
- Manual failures return `ADMIN_ALERT_DELIVERY_FAILED` with a request ID and do not expose the destination or secret.
- The current deployment remains fully functional with alerts disabled.

## Alert codes and severity

| Code | Severity |
| --- | --- |
| `CONTACT_DELIVERY_RATE_LOW` | warning |
| `CONTACT_BOUNCE_RATE_HIGH` | warning |
| `CONTACT_COMPLAINT_RATE_HIGH` | critical |
| `CONTACT_PROVIDER_FAILURES_HIGH` | critical |
| `CONTACT_ABUSE_PRESSURE_HIGH` | warning |
| `CONTACT_ACTOR_BURST_HIGH` | warning |

Threshold ownership remains in `worker/admin-health.ts`. Routing consumes that canonical code set and does not define a second health policy.
