# Contact provider staging, deliverability and support runbook

This runbook covers the optional verified email/SMS capability. The username/password and eight recovery-code flows remain the independent default recovery boundary.

## Hard safety rules

- Never ask a learner to send a password, verification code, signed contact ticket or recovery code.
- Never copy a raw email address or phone number into logs, issues, chat, analytics or artifacts.
- Do not manually mark a contact verified. Verification is challenge → code → one-use signed ticket → atomic account action.
- Do not enable `FEATURE_EMAIL_VERIFICATION` or `FEATURE_SMS_VERIFICATION` because an adapter merely returned HTTP 2xx. A real `delivered` receipt is required.
- Disable the affected feature flag before investigating a provider outage, complaint spike or suspected abuse.

## Contracts

### Worker → provider adapter

`POST` to the configured private HTTPS adapter:

- `Authorization: Bearer <channel webhook secret>`
- `Idempotency-Key: <challenge UUID>`
- `X-Verification-Contract: contact-verification-delivery-v1`
- JSON contract: `contact-verification-delivery-v1`
- adapter response: 2xx and `X-Verification-Message-Id`

The adapter owns the integration with the actual email/SMS provider. It must make the provider request idempotent by challenge UUID and must not log the code or destination.

### Provider adapter → Worker receipt boundary

`POST /api/integrations/contact-delivery-receipt`:

- `Authorization: Bearer <CONTACT_DELIVERY_RECEIPT_SECRET>`
- JSON contract: `contact-verification-receipt-v1`
- normalized statuses: `delivered`, `deferred`, `bounced`, `complained`, `undeliverable`, `provider-rejected`, `provider-unavailable`
- `eventId` must be stable so duplicate provider webhooks are idempotent.

The same hidden endpoint supports an authenticated `GET ?challengeId=<uuid>` for staging polling. It returns only statuses, reason codes and timestamps.

## Before the first real test

### Email

1. Use a buyer-owned sender domain and provider account.
2. Complete sender-domain verification and publish the provider-required DNS records.
3. Confirm SPF/DKIM alignment and define a DMARC rollout appropriate for the domain owner.
4. Configure provider bounce/complaint/delivery webhooks in the private adapter.
5. Use a buyer-controlled test inbox that can receive the verification message.

### SMS

1. Use a buyer-owned provider account and sender/number approved for the target destination country.
2. Confirm the template and sender identity satisfy provider/carrier requirements.
3. Configure provider delivered/undeliverable callbacks in the private adapter.
4. Use a buyer-controlled E.164 test number.

### Cloudflare and GitHub environment

Keep learner flags off. Configure provider webhook URL/secret and `CONTACT_DELIVERY_RECEIPT_SECRET` as Cloudflare secrets. Configure GitHub environment `contact-provider-staging` with:

- `CONTACT_STAGING_EMAIL_PROVIDER_URL`
- `CONTACT_STAGING_EMAIL_PROVIDER_SECRET`
- `CONTACT_STAGING_EMAIL_DESTINATION`
- `CONTACT_STAGING_SMS_PROVIDER_URL`
- `CONTACT_STAGING_SMS_PROVIDER_SECRET`
- `CONTACT_STAGING_SMS_DESTINATION`
- `CONTACT_STAGING_RECEIPT_URL`
- `CONTACT_STAGING_RECEIPT_SECRET`

Restrict environment access and require an owner approval. The workflow deliberately fails when a secret is absent.

## Real-provider acceptance

Run **Contact Provider Staging Acceptance** once for `email` and once for `sms`.

A passing run proves all of the following in one trace:

1. The real adapter accepted `contact-verification-delivery-v1`.
2. It returned a valid provider message ID.
3. The provider generated an asynchronous delivery event.
4. The adapter normalized and forwarded the event to the hidden Worker receipt boundary.
5. The Worker stored the event and returned `delivered` to the polling harness.
6. The uploaded artifact contains only a masked destination, destination/message fingerprints, challenge ID and normalized statuses. It contains no code or raw destination.

HTTP 2xx without a later `delivered` receipt is **not acceptance**. Timeout, bounce, complaint, undeliverable, provider rejection and provider unavailability all fail the workflow.

## Rollout sequence

1. Keep learner feature flags off.
2. Run email staging acceptance and retain the 30-day artifact.
3. Run SMS staging acceptance and retain the 30-day artifact.
4. Inspect hidden `/api/admin/health` contact windows and confirm no active alerts.
5. Enable one channel only in staging; exercise registration, password recovery and authenticated binding.
6. Confirm recovery-code fallback still works and no support bypass exists.
7. Enable the channel for a small production canary.
8. Review 1-hour metrics after the first 10, 25 and 100 accepted challenges.
9. Expand only if delivery, complaint and abuse thresholds remain healthy.
10. Repeat independently for the second channel.

## Aggregate monitoring

`/api/admin/health` is hidden unless the admin capability and allowlist are ready. Contact data is aggregate-only over one-hour and 24-hour windows.

### Critical

- `PROVIDER_FAILURE_RATE`: rejected/unavailable provider attempts ≥ 5% with at least three failures.
- `EMAIL_COMPLAINT_RATE`: complaint rate ≥ 0.1% with at least one complaint.

Action: turn off the affected learner feature flag, preserve the staging/deployment artifacts, inspect provider status and adapter logs, and rotate secrets if authentication or replay is suspected.

### Warning

- `NEGATIVE_DELIVERY_RATE`: email bounce/complaint/undeliverable ≥ 5%, SMS ≥ 10%, at least three events.
- `CONTACT_ABUSE_SPIKE`: cooldown/rate-limit events ≥ 25% of created challenges and at least ten events.
- `INVALID_CODE_SPIKE`: invalid-code rate ≥ 40% and at least twenty invalid attempts.

Action: do not weaken limits. Check campaign/source traffic, Turnstile readiness, provider fraud controls and whether a destination or IP range is being targeted. Escalate to critical if the trend persists across the one-hour window.

## Support procedures

### “The code never arrived”

1. Ask only which channel was used and the approximate time. Do not request the destination or code in a public ticket.
2. Check feature capability and current aggregate alerts.
3. Check the provider dashboard using its message/event tooling under approved operator access.
4. Ask the learner to wait for the displayed resend cooldown, then request one new code.
5. If delivery is degraded, disable the affected feature and direct the learner to username/recovery-code access. Do not manually verify the contact.

### “I lost access to the contact”

Use the independent recovery-code path. A verified contact cannot be replaced by support assertion. After login, the learner can attach an available new channel through a fresh sensitive-action challenge and current password.

### “Someone is requesting codes for me”

Do not reveal whether a contact is attached to an account. Review aggregate abuse signals and provider fraud data. If targeted abuse is credible, disable the affected channel, rotate webhook/receipt secrets if needed and preserve incident evidence without raw destinations.

### “Password reset succeeded but sessions remain active”

Treat as a security incident. Contact reset must atomically change the password and delete existing sessions. Capture request ID, deployment commit and timestamp; never request the password or ticket.

## Rollback

1. Set the affected `FEATURE_*_VERIFICATION` flag to `off`.
2. Deploy and verify `/api/capabilities` reports the channel disabled and the learner UI disappears.
3. Keep the receipt boundary available while investigating so already-sent provider callbacks are not lost.
4. Rotate provider webhook and receipt secrets if compromise is possible.
5. Do not delete operational events during the incident. Normal retention is 30 days.
6. Re-enable only after a fresh real-provider staging acceptance and owner review.

## Privacy and retention

Operational tables intentionally exclude raw destinations, verification codes and signed tickets. Delivery/security events are pruned after 30 days in bounded batches. Provider dashboards and adapter logs must follow the buyer's own retention and access policy; the adapter must redact message body, code and destination from ordinary logs.
