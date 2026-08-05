# Account recovery and account-takeover response

SQL Academy supports self-service recovery through recovery codes and, only when the capability is intentionally enabled and the account already has a verified contact, through that verified contact. Support staff have no password-reset or identity-proof override.

## Security boundary

- The learner's password is never visible to operators.
- Recovery codes are one-time secrets generated for the learner; operators cannot retrieve, validate or replace an individual code.
- Email/SMS verification is optional, capability-gated and fail-closed. A feature flag without complete provider/Turnstile configuration must not expose a usable route.
- Verified-contact password login still requires the account password; contact verification is not passwordless login.
- A successful password reset revokes every active session.
- Raw contacts, plaintext verification codes and session tokens must not be persisted in support systems.
- No operator override exists for an account that has neither an available recovery code nor an already bound verified contact.

Never ask a learner to send a password, recovery code, one-time code, session token, browser storage dump or provider message payload.

## Intake without account enumeration

Collect:

- private case reference;
- UTC timestamp and production origin;
- the learner-entered username only when required by the supported flow;
- visible error category and status/request ID;
- whether the learner still has any signed-in device;
- whether they possess an unused recovery code;
- whether the UI offers a verified-contact recovery channel and only its masked destination;
- whether unauthorised access or unexpected sessions are suspected.

Do not confirm whether a username, email or phone exists beyond what the public product flow safely reveals. Use neutral wording such as “If the account and recovery method are eligible, the product will continue the flow.”

## Supported flow A — recovery code

The learner performs the built-in recovery-code reset themselves:

1. Open the password-recovery flow on the trusted production origin.
2. Enter the username, one unused recovery code and a new password meeting the product policy.
3. Complete the reset.
4. Sign in with the new password.
5. Confirm that previously signed-in devices no longer have a valid session.

Operational expectations:

- a consumed code cannot be reused;
- an invalid/used code returns a bounded failure and does not reveal credential details;
- password reset revokes every session;
- recovery-code regeneration is authenticated, rate-limited and replaces the previous set;
- support records success/failure category but never the code.

If the learner is still authenticated and believes their recovery codes are exposed, direct them to the product's authenticated regeneration flow after securing the password. Do not generate codes on their behalf.

## Supported flow B — already bound verified contact

This flow is available only when `/api/capabilities` advertises the channel as enabled/policy-ready and the account has that contact bound.

1. The learner opens verified-contact recovery from the trusted production origin.
2. They select an offered channel and enter the destination required by the product UI.
3. The server issues a bounded challenge through the configured provider.
4. The learner enters the one-time code in the product, not in support chat.
5. The server exchanges confirmed evidence for a one-time signed reset ticket.
6. The learner sets a new password.
7. Every active session is revoked.
8. The learner signs in again with username or the verified contact plus the new password.

Support may record a masked destination, provider request ID, challenge state category and timestamp. Support must not see or request the one-time code, signed ticket, provider secret or raw delivery payload.

Provider delivery success alone is not account-recovery success. The code confirmation, one-time ticket consumption, password change and session revocation must all complete.

## Still-signed-in learner

When the learner controls an authenticated session:

- verify they are on the trusted origin;
- use the built-in profile/session controls to review devices;
- change the password through the authenticated product flow;
- revoke unfamiliar sessions or rely on the password-change/reset all-session revocation contract;
- regenerate recovery codes when exposure is suspected and the cooldown permits;
- attach a verified contact only through the authenticated sensitive-action flow, requiring the current password and a valid verification ticket.

Support must not ask the learner to export session details or copy tokens. A screenshot of device labels/timestamps may be accepted only after personal data is redacted.

## Suspected account takeover

Escalate to security/privacy and the incident commander when any of these is credible:

- an unfamiliar active session or device;
- password changed without the learner;
- recovery codes unexpectedly rejected after known valid storage;
- verified contact changed or attached without the learner;
- progress/evidence appears under another account;
- multiple accounts show similar unauthorised access;
- session or provider secret exposure.

Containment sequence:

1. Preserve case timestamps, request/Ray IDs and masked device/contact evidence.
2. Rotate or revoke exposed operator/provider secrets through the owning system when applicable.
3. Guide the learner through a supported reset that revokes all sessions.
4. Do not manually edit `users`, `auth_sessions`, `verified_contacts`, challenge or ticket-consumption rows.
5. Verify new login and rejection of old sessions.
6. Investigate scope with aggregate/private operator evidence only under approved access.
7. Follow [Production incident response](incident-response.md) for broad impact or data risk.

Do not promise restoration of lost learning evidence until ownership and integrity are proven.

## No available recovery evidence

When the learner has no authenticated session, no unused recovery code and no already bound verified-contact recovery method, the repository provides no safe self-service or operator bypass.

Required response:

- explain that support cannot reset credentials without supported cryptographic recovery evidence;
- do not request identity documents, payment records, employer confirmation or other ad-hoc personal evidence unless the buyer has designed and legally/security-reviewed a separate recovery system;
- do not change the password, username, contact or session rows directly;
- preserve the case as a product/operations signal;
- offer creation of a new account only when that does not misrepresent recovery of the old account or transfer its evidence;
- escalate any proposed manual recovery process for independent security/privacy/legal design before implementation.

A support operator's belief that the requester is genuine is not sufficient authentication.

## Provider or verification failure

If a verified-contact route is offered but delivery/confirmation fails:

1. Confirm the capability and policy state through `/api/capabilities`.
2. Record channel, masked destination, UTC time, HTTP status, provider request ID and retry-after value when available.
3. Check challenge expiry, resend cooldown and attempt limits without exposing code/destination digests.
4. Do not repeatedly resend to bypass limits.
5. Do not reveal whether another account owns the contact.
6. Escalate provider failures to operations; if the integration cannot be trusted, disable it so routes fail closed.
7. Preserve recovery-code access when core authentication is safe.
8. Real deliverability, bounce and abuse acceptance remains buyer/provider evidence, not a repository-only claim.

## Session-revocation verification

After password change/reset, verify using a test account or the learner's own devices without collecting tokens:

- the new password authenticates;
- a previously authenticated second device receives an unauthorised/session-expired response;
- old password authentication fails;
- the consumed recovery code or ticket cannot be replayed;
- a new session can sync the correct profile/progress;
- no unrelated account data is returned.

Support records pass/fail and timestamps, not credentials.

## Case closure

Close a recovery case only when:

- the learner completed a supported recovery and can authenticate;
- all old sessions are confirmed revoked or product evidence proves revocation;
- any exposed recovery-code set was replaced;
- suspected takeover has an owning security/incident record;
- provider failure has an operations owner and the user has an honest available alternative;
- or the no-bypass boundary was explained and no unsafe recovery action was taken.

Record the recovery mechanism category, final UTC time, affected deployment commit, session-revocation result and follow-up issue. Never record the password, recovery code, one-time code, signed ticket, session token or full verified contact.
