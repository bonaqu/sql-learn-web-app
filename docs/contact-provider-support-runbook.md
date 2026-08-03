# Contact provider staging and support runbook

## Scope and safety boundary

This runbook covers the optional buyer-owned email/SMS delivery gateway used by SQL Academy contact verification. The SQL Academy application remains provider-neutral and fail-closed. Username plus recovery-code access must continue to work when the gateway or either provider is disabled.

A passing unit test or mock callback is not deliverability evidence. Email or SMS delivery is accepted only after the protected `Contact Provider Staging Acceptance` workflow reaches provider status `delivered` using a buyer-owned sender and test destination.

Support and operators must never:

- ask a learner for their password, six-digit verification code or recovery code;
- paste a destination, verification code, provider API key or webhook secret into an issue, chat, log or workflow input;
- manually mark an unverified contact as verified;
- bypass verification when both the verified contact and recovery codes are unavailable;
- enable a channel when the gateway health capability is false or callback signatures are not verified.

## Components

1. SQL Academy sends the private `contact-verification-delivery-v1` contract to the gateway.
2. Before that call, the main Worker derives a domain-separated HMAC `sourceKey` from Cloudflare's trusted `CF-Connecting-IP`. The raw address exists only in request memory. The gateway validates that 64-hex key and HMAC-pseudonymizes it again with its independent `PII_HMAC_SECRET`, so the provider service never mistakes the calling backend Worker IP for the learner source and neither service persists a raw IP.
3. The gateway reserves the challenge in D1 before calling a provider.
4. Resend sends email with `challengeId` as the API idempotency key.
5. Twilio sends SMS once for a reserved challenge and reports status through a signed callback.
6. Resend Svix callbacks and Twilio `X-Twilio-Signature` callbacks update sanitized delivery evidence.
7. D1 stores HMAC-pseudonymous destination/source identifiers, provider IDs, event IDs, statuses and timestamps. It does not store the raw destination, source IP, upstream source key or verification code.

## Required staging assets

Create these in the buyer/operator account before enabling a channel:

### Shared Cloudflare assets

- a dedicated gateway Worker and custom HTTPS domain;
- a dedicated staging D1 database with all `provider-gateway/migrations` applied;
- protected GitHub environment `contact-provider-staging` with required reviewers;
- Worker secrets: `DELIVERY_WEBHOOK_SECRET` and `PII_HMAC_SECRET`, each generated independently with at least 32 random bytes;
- GitHub environment secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `CONTACT_PROVIDER_STAGING_URL`, `CONTACT_PROVIDER_STAGING_SECRET`, `CONTACT_PROVIDER_STAGING_EMAIL` and `CONTACT_PROVIDER_STAGING_PHONE`;
- alert destination owned by the operator. Do not use a learner-facing channel for operational alerts.

### Email / Resend

- buyer-owned sending domain verified by Resend;
- SPF and DKIM records published exactly as supplied by the provider;
- DMARC policy and reporting mailbox reviewed by the operator;
- `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET` and `RESEND_FROM` configured only in the gateway;
- Resend webhook subscribed at least to sent, delivered, delivery delayed, bounced, complained and failed events;
- staging recipient explicitly controlled by the operator.

### SMS / Twilio

- buyer-owned Twilio project and Messaging Service;
- sender/number and any country-specific registration completed before testing;
- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` and `TWILIO_MESSAGING_SERVICE_SID` configured only in the gateway;
- the gateway custom URL configured as the message status callback;
- staging phone explicitly controlled by the operator.

## Activation order

1. Keep `FEATURE_EMAIL_VERIFICATION`, `FEATURE_SMS_VERIFICATION`, `FEATURE_EMAIL_DELIVERY` and `FEATURE_SMS_DELIVERY` off.
2. Create the gateway Worker, D1 database and custom domain.
3. Replace all placeholder D1 IDs, example domains, sender and Messaging Service SID in `provider-gateway/wrangler.jsonc`.
4. Apply remote D1 migrations.
5. Set gateway secrets with Wrangler or the Cloudflare dashboard. Never commit `.dev.vars` or secret JSON.
6. Deploy the gateway with the staging environment.
7. Register signed provider callback URLs.
8. Run `Contact Provider Staging Acceptance` separately for email and SMS. Both runs must reach `delivered` and upload redacted evidence.
9. Review gateway `/v1/health`: enabled channels must be true and failure/bounce/complaint/undelivered counts must be acceptable.
10. Configure the main SQL Academy webhook URL/secret and Turnstile prerequisites.
11. Enable one main-application channel at a time. Re-run registration, reset and contact-binding browser smoke tests.
12. Record the exact deployment commit, provider configuration owner and rollback decision maker.

## Normal support evidence

Collect only:

- approximate event time and learner-visible action;
- masked destination already shown by the product;
- channel and purpose;
- challenge ID only when exposed by an operator-safe diagnostic surface;
- gateway status, sanitized error code and provider message ID from restricted operator tooling;
- browser/network correlation ID when available.

Do not collect screenshots containing full email addresses, phone numbers, passwords, codes, recovery codes or provider dashboards with credentials.

## Status interpretation

| Status | Meaning | Support action |
| --- | --- | --- |
| `reserved` | Challenge claimed before provider call | If older than the provider timeout, treat as failed delivery and ask the learner to request a new code after cooldown. Do not replay the same Twilio challenge. |
| `accepted` | Provider accepted the message | Wait for callback within the published support window; check provider incident status if delayed. |
| `sent` | Provider began external delivery | Continue callback monitoring; this is not proof of inbox/handset delivery. |
| `delivered` | Provider reports delivery to recipient infrastructure/device | Ask the learner to check spam, filters, blocked senders and device/network state. Never reveal the code. |
| `delayed` | Temporary email delivery delay | Do not suppress the destination. Offer recovery-code fallback and retry later with a new challenge. |
| `bounced` | Permanent email rejection reported | Destination is suppressed. Ask the learner to correct or replace the contact after authenticating through another supported method. |
| `complained` | Recipient marked email as spam | Keep suppressed; escalate to deliverability owner before any release. |
| `suppressed` | Provider or operator suppression | Do not repeatedly send. Resolve the underlying reason first. |
| `failed` | Provider/API/configuration failure | Check sanitized error, provider status and gateway capability; use feature-off rollback during broad impact. |
| `undelivered` | SMS carrier/device delivery failed | Check Twilio error category and sender registration; offer recovery-code fallback or verified email. |

## Incident: provider outage or elevated failure rate

Trigger when any of these occur:

- provider status page confirms degradation;
- five consecutive provider rejections for a configured channel;
- `failed + undelivered` exceeds 10% of accepted messages over 15 minutes with at least 20 attempts;
- callback signature failures exceed three in five minutes;
- health endpoint reports a configured channel as unavailable.

Actions:

1. Disable the affected channel in the main application first so users are not offered a broken flow.
2. Keep username/recovery-code access available.
3. Do not switch to unsigned callbacks, mock delivery or plaintext provider credentials.
4. Confirm gateway capability, provider status, DNS/sender configuration and recent deploys.
5. Rotate the provider key or webhook secret only when compromise or invalidation is plausible; record who rotated it and when.
6. Post a user-facing incident message that recommends the unaffected verified channel or recovery code without exposing internal security details.
7. Re-enable only after a protected staging workflow reaches `delivered` and failure metrics return to baseline.

## Incident: bounce, complaint or suppression spike

Trigger when:

- complaints are non-zero for verification traffic;
- permanent bounce rate exceeds 2% over 24 hours with at least 50 sends;
- provider suppression count grows unexpectedly;
- multiple destinations at one domain fail with the same diagnostic family.

Actions:

1. Pause email verification if complaints or domain-wide failures are ongoing.
2. Keep permanent bounces and complaints suppressed. Never auto-release them.
3. Review sender identity, DMARC alignment, message wording, provider reputation and recipient acquisition source.
4. Confirm that only user-initiated verification sends are occurring.
5. Release a suppression only after destination ownership is re-established through another secure factor and the deliverability owner approves it.
6. Run real staging delivery again before channel re-enable.

## Incident: abuse spike

Trigger when:

- destination or source buckets repeatedly hit configured hourly limits;
- a narrow source range targets many destinations;
- challenge creation grows without matching confirmations;
- Turnstile failures or provider rejects rise together.

The source bucket is not based on the gateway request IP: that address belongs to the calling SQL Academy Worker. The main Worker first HMAC-pseudonymizes the edge source, and the gateway HMAC-pseudonymizes that upstream key again. Operators may compare aggregate bucket activity, but must not attempt to reverse, export or join these identifiers to raw IP logs.

Actions:

1. Keep rate limits fail-closed; do not raise them during the incident.
2. Disable the targeted channel if volume threatens provider reputation or cost controls.
3. Review only HMAC-pseudonymous aggregate buckets and timestamps; do not export raw destinations or source keys.
4. Rotate `DELIVERY_WEBHOOK_SECRET` if unauthorized gateway calls are plausible.
5. Rotate `PII_HMAC_SECRET` only as a planned migration because changing it breaks correlation with existing suppression/bucket records.
6. Rotating `CONTACT_VERIFICATION_SIGNING_SECRET` also changes upstream source-key correlation and the destination/ticket signing domains in the main application; perform it only through the approved application secret-rotation plan.
7. Tighten challenge limits and Turnstile policy in the main application, then validate legitimate registration/reset/binding flows.
8. Document the attack window, controls changed and criteria for rollback.

## Credential rotation

1. Disable the affected delivery channel.
2. Create the new provider/shared secret in the owner account.
3. Update the gateway secret without placing it in shell history or repository files.
4. For `DELIVERY_WEBHOOK_SECRET`, update SQL Academy and the gateway in one controlled window.
5. For webhook signing secrets, update the provider endpoint and gateway together; reject both unsigned and stale callbacks.
6. Deploy and run the protected real-provider acceptance workflow.
7. Re-enable the channel and revoke the old credential.
8. Record the rotation timestamp and operator, never the credential value.

## Rollback

Rollback is configuration-first:

1. Set the affected main application feature flag off.
2. Confirm contact UI is hidden/fail-closed and username/recovery-code access remains visible.
3. Keep the gateway deployed for callback reconciliation unless compromise requires immediate isolation.
4. If the gateway release caused the incident, deploy the last known-good gateway revision and preserve D1 evidence.
5. Never delete delivery rows during active incident investigation. Normal retention resumes after closure.

## Recovery when the learner lost all factors

When a learner has neither an accessible verified contact nor a valid recovery code, support must not bypass ownership verification or attach a new contact manually. The safe product response is to explain that account recovery cannot be completed with the available evidence and escalate only to an approved identity-proofing process if the buyer has separately designed, legally reviewed and audited one. This repository intentionally does not provide such a bypass.

## Closure checklist

- affected channel was disabled/re-enabled with timestamps;
- exact gateway and SQL Academy commits recorded;
- provider incident and callback evidence reconciled;
- no raw destination/code/credential entered logs or tickets;
- protected email/SMS staging acceptance passed after remediation;
- suppressions reviewed and not bulk-released;
- user-facing message and support macro updated when needed;
- root cause, control changes and follow-up owner documented.
