# Contact provider staging acceptance

This procedure proves that a buyer-owned email or SMS provider can accept a SQL Academy verification challenge and return a **signed delivered callback** to the staging Worker. It does not enable contact verification in production.

## Acceptance boundary

A channel passes only when all of the following are true:

1. `/api/capabilities` reports the requested verification channel as enabled on the staging Worker.
2. The challenge endpoint returns `202` with a masked destination and no raw contact value.
3. The selected provider accepts the message with an idempotent challenge key.
4. The staging Worker validates the provider callback signature.
5. The callback is linked to the original challenge by provider message ID.
6. The masked timeline reaches `delivered` before the configured timeout.
7. The workflow artifact contains no destination, verification code, provider secret, ticket or session token.

An accepted/queued/sent event is useful diagnostic evidence but is **not** deliverability acceptance.

## Protected GitHub environment

Create a protected GitHub Environment named `contact-staging`. Require an approver and restrict deployment branches to the default branch.

Environment secrets:

| Secret | Required | Purpose |
| --- | --- | --- |
| `CONTACT_STAGING_BASE_URL` | yes | HTTPS URL of the staging Worker. |
| `CONTACT_STAGING_PROBE_SECRET` | yes | Random 32+ character bearer secret used only by the masked staging timeline endpoint. |
| `CONTACT_STAGING_EMAIL` | email | Allowlisted test mailbox controlled by the buyer. |
| `CONTACT_STAGING_SMS` | SMS | Allowlisted E.164 test number controlled by the buyer. |

The workflow never prints these values. The only retained artifact is `contact-staging-evidence.json`, which contains the channel, masked destination, challenge ID, provider message ID, normalized statuses and timestamps.

## Staging Worker configuration

Deploy a separate Worker/D1 database. Do not point the workflow at production.

Common secrets:

- `CONTACT_VERIFICATION_SIGNING_SECRET`
- `CONTACT_STAGING_PROBE_SECRET`

Common vars:

- `CONTACT_STAGING_MODE=enabled`
- `FEATURE_TURNSTILE=off`
- enable only the channel under test
- keep the admin console disabled unless an allowlisted operator is actively investigating

### Resend email

Vars:

- `FEATURE_EMAIL_VERIFICATION=on`
- `EMAIL_VERIFICATION_PROVIDER=resend`
- `FEATURE_SMS_VERIFICATION=off`

Secrets:

- `RESEND_API_KEY`
- `RESEND_FROM`
- `RESEND_WEBHOOK_SECRET`

Configure the Resend webhook URL as:

```text
https://<staging-worker>/api/integrations/resend/events
```

Subscribe at minimum to sent, delivered, delayed, bounced, complained and failed events.

### Twilio SMS

Vars:

- `FEATURE_SMS_VERIFICATION=on`
- `SMS_VERIFICATION_PROVIDER=twilio`
- `FEATURE_EMAIL_VERIFICATION=off`

Secrets:

- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- either `TWILIO_MESSAGING_SERVICE_SID` or `TWILIO_FROM_NUMBER`
- `TWILIO_STATUS_CALLBACK_URL=https://<staging-worker>/api/integrations/twilio/status`

The callback URL used to validate the Twilio signature must exactly match the public URL Twilio calls.

## Running acceptance

1. Confirm the destination is controlled and explicitly allowlisted by the buyer.
2. Open **Actions → Contact Provider Staging → Run workflow**.
3. Choose `email` or `sms`.
4. Keep the default five-minute timeout unless the provider has a documented staging delay.
5. Approve the protected environment deployment.
6. Download the masked evidence artifact.

A green workflow means real provider acceptance **and** a signed delivered callback were observed for that exact run. It does not prove every recipient domain or carrier will deliver successfully.

## Manual code-consumption check

The automated workflow intentionally cannot read the code. For the first provider onboarding and after template/sender changes:

1. An authorized tester opens the allowlisted mailbox or phone.
2. Verify the message identifies SQL Academy, states the purpose, includes one six-digit code and says it expires in ten minutes.
3. Enter the code through the staging browser UI.
4. Confirm the code is single-use and a replay is rejected.
5. Confirm registration still requires saving all eight recovery codes.
6. Delete the test account and staging message after evidence is recorded.

Never paste the code, destination or recovery codes into a GitHub issue, artifact or support ticket.

## Failure interpretation

| Last status | Meaning | Next action |
| --- | --- | --- |
| no initial event | provider configuration or send API failed | inspect staging Worker diagnostics without logging the destination/code |
| accepted/queued only | provider accepted but callback or downstream delivery stalled | verify callback URL/signature secret, then provider event console |
| sent | provider handed off the message | wait for delivered or terminal failure; do not mark accepted |
| delayed | temporary provider/recipient delay | retry later; review provider reason and sender reputation |
| bounced/complained | email hard failure or complaint | stop retrying that destination; review sender/domain alignment |
| undelivered/failed | SMS carrier/provider failure | review normalized error code and sender permissions |
| timeout | no terminal signed callback | treat as staging failure even if a person received the message |

## Production enablement gate

Production flags remain off until:

- email and/or SMS staging workflow is green;
- the manual code-consumption check is complete;
- support has rehearsed the runbook;
- alert ownership and provider billing limits are assigned;
- sender domain/number ownership is documented;
- secrets have rotation owners;
- rollback has been tested by disabling the channel and confirming the UI disappears.
