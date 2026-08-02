# Support runbook: contact verification, recovery and delivery

Owner: Support Engineering / Product Operations  
Applies to: verified email/SMS registration, contact binding and contact password recovery  
Privacy level: masked operational metadata only

## Non-negotiable support rules

Support must never request, copy or store:

- a verification code;
- a full email address or phone number;
- a signed contact ticket;
- a password, session token or recovery code;
- message body screenshots containing the code.

Ask for the **challenge ID**, approximate time, channel and the masked destination shown by the product. Challenge IDs are safe operational identifiers but should still remain inside authorized support systems.

A verified contact is an additional recovery path. It never replaces the eight one-time recovery codes.

## Fast triage

1. Check `/api/admin/health` using an allowlisted admin account.
2. Confirm the channel capability is enabled and `configurationErrors` is empty.
3. Review `contacts` for the last 24 hours:
   - challenges created/confirmed/locked/expired/consumed;
   - delivery status counts and hard-failure rate;
   - invalid and exhausted code events;
   - provider failures and rate limits.
4. Query `/api/admin/contact-delivery?challengeId=<id>`.
5. Compare the challenge state with the signed provider timeline.
6. Choose the matching incident path below.

The admin response contains only a masked destination. If a full contact appears anywhere in logs or admin JSON, treat that as a privacy incident.

## Initial alert thresholds

These are conservative launch thresholds and must be recalibrated after normal traffic is known.

### Warning

- hard-failure rate above 5% with at least 20 terminal delivery events in 24 hours;
- confirmation rate below 30% with at least 20 created challenges;
- more than 10 provider failures in 15 minutes;
- invalid-code events exceed three times confirmed challenges in 15 minutes;
- delivery delay above five minutes for more than five challenges;
- staging deliverability workflow fails once after a sender/template/config change.

### Critical

- hard-failure rate above 10% with at least 20 terminal events;
- no delivered events for a channel for 30 minutes while challenges are being created;
- callback signature failures after a provider secret rotation;
- provider spend/billing limit reached;
- raw contact, code, ticket or recovery code appears in logs, artifacts or support systems;
- verified-contact reset succeeds without revoking existing sessions;
- repeated successful ticket consumption or contact binding to multiple accounts.

Low-volume periods should use absolute event counts and manual review rather than percentages.

## Timeline interpretation

| Challenge state | Delivery state | Meaning |
| --- | --- | --- |
| no provider message ID | none | send failed before provider acceptance or challenge persistence failed |
| provider message ID | accepted/queued | provider accepted the request; not proof of delivery |
| unconfirmed | delivered | user received the message but has not successfully entered the code |
| attempts decreasing | delivered | likely mistyped, stale or replayed code |
| attempts zero | any | challenge is locked; a new challenge is required after rate limits allow it |
| confirmed, not consumed | delivered | code succeeded; final registration/binding/reset was not completed or ticket expired |
| consumed | delivered | final account operation completed |
| expired, unconfirmed | delivered | message arrived too late or user did not complete the flow |
| bounced/complained | unconfirmed | stop automatic retries and investigate sender/destination policy |
| failed/undelivered | unconfirmed | provider/carrier failure; use normalized error code and provider console |

## Incident paths

### A. “The code never arrived”

1. Confirm the masked destination and channel with the user.
2. Locate the challenge timeline.
3. If there is no provider message ID:
   - verify provider readiness and secrets;
   - inspect `challenge-provider-failed` counts;
   - do not ask the user to retry repeatedly.
4. If status is accepted/queued/sent:
   - verify callback configuration and provider event console;
   - ask the user to check spam/junk only for email;
   - do not call this delivered.
5. If status is delivered:
   - confirm the user is looking at the correct masked destination;
   - remind them only the newest code is valid;
   - allow one resend after the cooldown.
6. If bounced/complained/failed/undelivered:
   - do not keep sending;
   - explain that the destination/provider rejected delivery;
   - offer recovery codes or another already-bound channel.

### B. “The code is invalid”

1. Confirm the challenge is not expired or locked.
2. Confirm the user is entering the newest six-digit code.
3. Check invalid-code and exhausted-code events.
4. Never ask the user to disclose the code.
5. After lockout, require a fresh challenge; do not reset attempts manually.
6. If many users report valid newest codes as invalid, escalate as a signing/time synchronization incident.

### C. “I confirmed the code but registration/binding/reset failed”

1. Check `confirmedAt` and `consumedAt`.
2. If confirmed but not consumed:
   - the signed ticket may have expired after ten minutes;
   - retry the full challenge flow once;
   - inspect the account route response/request ID.
3. If consumed:
   - do not replay the ticket;
   - inspect account state:
     - registration should have one verified contact and eight recovery codes;
     - binding should list the masked contact;
     - password reset should revoke every old session.
4. Any second successful consumption is a security incident.

### D. Password recovery abuse or enumeration concern

The public API intentionally returns generic errors and capabilities fail closed.

Escalate when:

- challenge creation spikes without corresponding confirmations;
- invalid-code events spike across many challenge IDs;
- rate-limit events rise sharply;
- one channel shows spend growth without legitimate account activity;
- support receives repeated requests to disclose whether a destination exists.

Actions:

1. Do not confirm whether a contact is registered.
2. Tighten provider billing and account-level limits if needed.
3. Enable or verify Turnstile for public challenge and reset actions.
4. Temporarily disable the affected channel.
5. Preserve masked aggregate evidence and request IDs.
6. Rotate provider and verification signing secrets if compromise is suspected.

## Channel disable and rollback

To stop a channel safely:

1. Set `FEATURE_EMAIL_VERIFICATION=off` or `FEATURE_SMS_VERIFICATION=off`.
2. Deploy the Worker.
3. Verify `/api/capabilities` reports the channel disabled.
4. Confirm registration/recovery/binding UI for that channel disappears.
5. Keep username/password and recovery-code login available.
6. Do not delete existing verified-contact records during an outage.
7. Preserve delivery/security events for incident review.

If both channels are disabled, the product must return to username + recovery codes without showing a broken contact form.

## Provider secret rotation

### Resend

1. Create the new API key and webhook signing secret.
2. Update staging secrets first.
3. Run real email staging acceptance and manual code consumption.
4. Rotate production secrets.
5. Confirm signed callbacks and delivered events.
6. Revoke old secrets.

### Twilio

1. Rotate the auth token using the provider-supported process.
2. Update staging Worker and verify the exact callback URL.
3. Run real SMS staging acceptance.
4. Update production and confirm signed callbacks.
5. Revoke old credentials.

Never place provider credentials in Wrangler vars, `.env.example`, GitHub logs or issue comments.

## Sender/template changes

Any sender domain, phone number, messaging service, subject, body or callback URL change requires:

1. automated real-provider delivered acceptance;
2. manual code-content and single-use verification;
3. review of bounce/complaint/undelivered metrics for 24 hours;
4. rollback owner and previous configuration recorded before deployment.

## Evidence to attach to an incident

Allowed:

- challenge ID;
- request ID;
- channel;
- masked destination;
- provider/message ID;
- normalized statuses and timestamps;
- normalized error code;
- aggregate counts/rates;
- deployment commit and workflow run ID.

Forbidden:

- raw destination;
- verification code;
- message body;
- contact ticket;
- password/session/recovery code;
- provider credentials.

## Resolution templates

### Delivery still pending

> Мы видим, что сервис принял сообщение, но подтверждённой доставки пока нет. Повторно отправлять много кодов не нужно: дождитесь текущего сообщения или используйте recovery-код/другой уже привязанный канал.

### Destination rejected

> Провайдер не смог доставить сообщение на указанный контакт. Мы не будем повторять отправку автоматически. Используйте recovery-код или другой уже привязанный способ восстановления.

### Challenge expired or locked

> Этот код больше нельзя использовать. Создайте один новый запрос после указанной паузы и вводите только самый свежий код. Не отправляйте код сотрудникам поддержки.

## Closure checklist

- root cause classified;
- affected window and channel recorded;
- raw PII absent from evidence;
- channel capability state verified;
- staging acceptance rerun after a configuration fix;
- user fallback remained available;
- alerts/thresholds adjusted when the incident exposed a blind spot;
- issue #82 updated with commit, run and masked evidence reference.
