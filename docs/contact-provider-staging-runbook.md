# Contact provider staging, deliverability and support runbook

Status: provider integrations remain **off by default**. A channel may be advertised only when outbound delivery, signed delivery events and the contact signing secret are all configured. This document does not authorize production activation by itself.

## 1. Architecture and trust boundaries

The learner-facing Worker remains provider-neutral.

1. `POST /api/auth/contact/challenge` creates a privacy-safe challenge and calls a private HTTPS adapter using `contact-verification-delivery-v1`.
2. The adapter sends through Resend for email or Twilio for SMS and returns the provider message ID.
3. Provider status is normalized to `accepted`, `delivered`, `deferred`, `bounced`, `complained` or `failed`.
4. The adapter signs the raw normalized event with the channel event secret and sends it to `POST /api/provider/contact-delivery/events`.
5. The application verifies HMAC, timestamp, event ID, challenge ID, channel and provider message ID before storing the event.
6. D1 stores no raw email, phone, IP, user agent, plaintext code or signed ticket.

The repository includes `provider-adapter/staging-worker.mjs` only as an isolated staging adapter. Its capture route is sensitive and must never be enabled on a production adapter.

## 2. Required isolated environments

Create a GitHub Environment named `contact-provider-staging` and require a reviewer.

Use an isolated staging Worker, D1 database and KV namespace. Do not point staging acceptance at the production D1 database.

Required staging application secrets:

- `CONTACT_VERIFICATION_SIGNING_SECRET` — at least 32 random characters;
- `EMAIL_VERIFICATION_WEBHOOK_URL` and `EMAIL_VERIFICATION_WEBHOOK_SECRET`;
- `EMAIL_VERIFICATION_EVENT_SECRET` — at least 32 random characters;
- `SMS_VERIFICATION_WEBHOOK_URL` and `SMS_VERIFICATION_WEBHOOK_SECRET`;
- `SMS_VERIFICATION_EVENT_SECRET` — at least 32 random characters.

The matching feature flag stays `off` until all secrets are present and acceptance has passed.

Required staging adapter secrets:

- `EMAIL_INBOUND_WEBHOOK_SECRET` and `SMS_INBOUND_WEBHOOK_SECRET` — must match the application outbound webhook secrets;
- `STAGING_CAPTURE_SECRET` — at least 32 random characters;
- `RESEND_API_KEY` and `RESEND_FROM`;
- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and either `TWILIO_MESSAGING_SERVICE_SID` or `TWILIO_FROM`.

The adapter requires an isolated KV binding named `CONTACT_STAGING_STATE`. Deploy from `provider-adapter/wrangler.example.jsonc` after replacing the KV ID. Keep `STAGING_CAPTURE_ENABLED=on` only in staging.

## 3. Email sender and deliverability readiness

Before a real email acceptance run:

- verify the sender domain in Resend;
- publish the exact SPF and DKIM records shown by the provider;
- publish DMARC, initially with reporting enabled and a policy appropriate for the domain owner;
- send from a dedicated transactional subdomain where possible;
- do not use a free consumer mailbox as the production sender;
- subscribe to sent, delivered, delayed, bounced, failed and complained events;
- verify webhook signatures against the raw body and preserve the provider event ID for deduplication;
- keep confirmation messages transactional, short and free from marketing content;
- never put the learner username, destination or code into application logs or analytics.

Resend API and webhook references:

- https://resend.com/docs/api-reference/emails/send-email
- https://resend.com/docs/webhooks/verify-webhooks-requests
- https://resend.com/docs/webhooks/event-types

## 4. SMS sender and regulatory readiness

Before a real SMS acceptance run:

- use an approved Twilio Messaging Service or sender for the target countries;
- verify country-specific sender registration, consent, quiet-hour and template requirements;
- send only one transactional code per challenge;
- set a status callback in the production adapter and validate `X-Twilio-Signature` with the Twilio SDK;
- treat `undelivered` and `failed` as failures and retain only the provider reason code needed for aggregate operations;
- do not use trial-recipient restrictions as evidence of production deliverability;
- document expected cost and geographic coverage before enabling SMS in the public capability response.

Twilio API and webhook references:

- https://www.twilio.com/docs/messaging/api/message-resource
- https://www.twilio.com/docs/messaging/guides/track-outbound-message-status
- https://www.twilio.com/docs/usage/webhooks/webhooks-security

## 5. Staging acceptance procedure

1. Deploy the isolated staging application with migration `0020_contact_provider_operations.sql`.
2. Deploy the staging adapter and verify `GET /health` reports the selected provider configured.
3. Configure application outbound webhook URLs to the adapter `/deliver` endpoint.
4. Configure the matching event secrets on both sides.
5. Keep Turnstile disabled in this transport acceptance environment unless the workflow is supplied with a fresh staging-only token. Turnstile enforcement has its own production smoke contract.
6. Add GitHub Environment variables:
   - `CONTACT_STAGING_APP_URL`;
   - `CONTACT_STAGING_ADAPTER_URL`.
7. Add GitHub Environment secrets:
   - `CONTACT_STAGING_EMAIL_DESTINATION`;
   - `CONTACT_STAGING_SMS_DESTINATION`;
   - `CONTACT_STAGING_CAPTURE_SECRET`;
   - provider API credentials;
   - channel event secrets.
8. Run **Contact Provider Staging Acceptance** manually and select `email`, `sms` or `both`.
9. Approve the protected environment deployment.
10. Download the redacted artifact and verify for each channel:
    - terminal status is `delivered`;
    - code confirmation succeeded;
    - provider and end-to-end latency are recorded;
    - no destination, code, ticket, challenge ID or provider message ID is present.
11. Run at least one controlled bounce/undelivered scenario and confirm the workflow fails and the admin aggregate changes without exposing PII.
12. Only after successful evidence, set the corresponding public feature flag to `on` in the intended environment.

A successful CI contract without the protected real-provider workflow is not real deliverability evidence.

## 6. Operational thresholds

The hidden allowlisted admin health response exposes aggregate-only 24-hour metrics.

Default warning thresholds:

- delivery rate below 90% with at least 20 sends;
- bounce rate at or above 5% with at least 20 sends;
- complaint rate at or above 0.5% with at least 20 sends;
- five or more provider failures in the 24-hour window;
- twenty or more rate-limited requests or ten locked confirmations in the 24-hour window.

Alert code mapping:

| Alert code | Trigger | First response |
| --- | --- | --- |
| `CONTACT_DELIVERY_RATE_LOW` | Delivery rate below 90% with at least 20 sends | Disable the affected channel if the provider dashboard confirms degradation; inspect deferred/failed statuses and rerun staging acceptance. |
| `CONTACT_BOUNCE_RATE_HIGH` | Bounce rate at or above 5% with at least 20 sends | Pause the email channel, inspect sender reputation/suppression and verify destination validation behavior. |
| `CONTACT_COMPLAINT_RATE_HIGH` | Complaint rate at or above 0.5% with at least 20 sends | Disable email immediately, inspect template/sender abuse and do not resume until the cause is corrected. |
| `CONTACT_PROVIDER_FAILURES_HIGH` | At least five provider failures in 24 hours | Check credentials, provider status and adapter logs; rotate secrets if misuse is suspected. |
| `CONTACT_ABUSE_PRESSURE_HIGH` | At least twenty rate-limited requests or ten locked confirmations in 24 hours | Keep rate limits intact, inspect Cloudflare evidence and apply edge controls where justified. |

These are initial safety thresholds, not permanent business SLOs. Recalibrate them only from real traffic while preserving a minimum sample size.

## 7. Abuse monitoring and response

`contact_security_events` stores a daily HMAC actor bucket, event type, channel, purpose, status and timestamp. It does not store an IP address or user agent.

Investigate when:

- rate-limit or locked-confirmation alerts fire;
- one channel shows a sudden provider failure spike;
- confirmation-invalid grows without matching challenge-created traffic;
- complaint or bounce rates exceed thresholds;
- a provider reports credential misuse or unusual geography.

Response order:

1. disable only the affected channel feature flag;
2. keep username/password and recovery-code access available;
3. preserve aggregate evidence and Cloudflare request IDs;
4. rotate the affected outbound and event secrets;
5. inspect provider dashboards for delivery, suppression and credential events;
6. block abusive sources at the edge if justified by Cloudflare evidence;
7. rerun protected staging acceptance before re-enabling the channel.

Do not weaken challenge cooldown, attempt limits, ticket expiry or Turnstile to restore delivery.

## 8. Support playbook

Support must never ask for:

- account password;
- recovery code;
- six-digit verification code;
- signed contact ticket;
- complete email address or phone number when the masked value is enough.

### Code not received

1. Confirm the masked destination and channel with the learner.
2. Ask them to wait until the resend time shown by the product.
3. Check aggregate provider health and the provider dashboard using the request time, not the raw destination in internal notes.
4. Advise checking spam/filtering for email or carrier blocking for SMS.
5. Preserve recovery-code access as the fallback.
6. Do not manually mark a contact verified.

### Lost access to a bound contact

1. Use username/password or a saved recovery code.
2. After authenticated access, attach the replacement channel through the normal sensitive-action flow.
3. Do not transfer a contact between accounts manually.
4. Escalate suspected account takeover through the security process; do not bypass ownership constraints.

### Destination already belongs to another account

Do not disclose which account owns it. Ask the learner to recover the original account or use another destination. Security may investigate duplicates only through pseudonymous records and provider evidence.

### Provider incident

Disable the affected channel. Keep the other channel, username/password and recovery codes available. Post a status notice that does not expose provider credentials or learner data. Re-enable only after a delivered staging run and stable provider metrics.

## 9. Rollback and secret rotation

Fast rollback:

1. set `FEATURE_EMAIL_VERIFICATION=off` and/or `FEATURE_SMS_VERIFICATION=off`;
2. redeploy and verify `/api/capabilities` no longer advertises the channel;
3. confirm contact UI disappears while existing username/recovery-code access remains;
4. rotate provider API, outbound webhook and event secrets;
5. rerun staging acceptance before activation.

Disabling a channel does not delete verified-contact records. Deletion/export policies must continue to cover those pseudonymous records.

## 10. Retention

- provider delivery and security events: 30 days, pruned in bounded batches;
- confirmed but unused challenges: 24 hours, even though the ticket expires after 10 minutes;
- raw staging capture values: KV TTL of one hour;
- redacted staging artifacts: 30 days;
- provider-side retention: configure to the minimum operational/legal requirement and document it during handoff.

Production activation is blocked until the protected workflow has passed with buyer-owned credentials and controlled test destinations for every enabled channel.