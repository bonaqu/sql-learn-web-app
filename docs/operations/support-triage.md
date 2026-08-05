# Learner support triage

This runbook defines privacy-safe intake, reproduction, escalation and closure for SQL Academy support cases. It does not grant support staff permission to inspect or change learner credentials, private submissions or production data.

## Intake contract

Collect only what is needed to reproduce and classify the problem:

- UTC date/time and the learner's timezone;
- production origin and device/browser version;
- affected product area and the action immediately before failure;
- visible error text, HTTP status, request ID or Cloudflare Ray ID when available;
- whether the issue affects one account, a cohort or every tested account;
- whether the same action works in a private window, another browser or another network;
- screenshot with personal data, contacts, SQL data and tokens redacted;
- consent before using a learner-provided SQL example or project content in a private investigation.

A username or internal user ID may be accepted only in a private support system with approved access controls and retention. Prefer a case-specific opaque reference. Never ask for or store:

- passwords;
- recovery codes;
- email/SMS one-time verification codes;
- session cookies or bearer tokens;
- Turnstile tokens;
- provider/API secrets;
- raw D1 exports;
- unredacted verified contacts;
- employer/customer production data embedded in SQL.

If a learner sends a secret, stop normal triage, instruct them not to reuse it, restrict/delete the message according to the buyer's policy and escalate when compromise is possible. Do not quote the secret back.

## Initial classification

Assign one primary category and any safety flags.

### Access and identity

- registration or login;
- recovery-code reset;
- verified email/phone challenge, attachment or reset when enabled;
- session/device management;
- suspected account takeover or unauthorised access.

### Learning journey

- onboarding/goal/placement;
- Today or Learning Path next action;
- lesson/curriculum access;
- practice readiness or preview gate;
- review scheduling or mastery evidence;
- checkpoint, assessment or capstone progression.

### Execution and content

- SQLite editor/runtime;
- PostgreSQL/MySQL preview;
- task wording, reference result or hidden-edge mismatch;
- browser performance, layout or accessibility.

### Sync and data

- progress not saved;
- second-device hydration mismatch;
- stale local state versus authoritative cloud evidence;
- export/import issue;
- suspected duplicate, missing or corrupted evidence.

### Platform and operations

- application unavailable;
- GitHub Pages or Worker asset/API mismatch;
- D1/KV/AI capability failure;
- provider or Turnstile outage;
- deployment/status discrepancy.

## Severity and escalation

Escalate immediately to the incident process when any of the following is credible:

- unauthorised account access, secret exposure or privacy breach;
- multiple unrelated accounts cannot authenticate;
- progress/evidence appears deleted, reassigned or corrupted;
- a bypass allows locked content, mastery, assessment or account action without required evidence;
- production is unavailable or a deployment has an unverified D1 migration;
- optional verification is enabled but failing open;
- the case cannot be investigated without accessing private production records.

Use [Production incident response](incident-response.md) and link the private support case by opaque reference only.

## Triage workflow

### 1. Confirm the supported environment

- Verify the learner is using the intended production origin.
- Record browser/device version and whether JavaScript/storage/cookies are blocked.
- Confirm whether the application reports offline state.
- Do not ask the learner to disable browser security, antivirus or privacy protections globally.

### 2. Establish scope without impersonation

- Check the public production health and capabilities contracts.
- Reproduce with a dedicated support/test account in the same environment.
- Test the exact lifecycle, not only page load.
- Never log in as the learner, request their password or copy their session.
- Do not create a production account that resembles the learner's username or contact.

### 3. Preserve evidence

Record:

- support case ID and UTC timestamps;
- exact production commit/deployment status when relevant;
- redacted screenshot or error text;
- request/Ray ID and status;
- reproduction account ID kept only in the restricted support record;
- local/cloud state distinction;
- expected versus actual lifecycle result;
- whether the problem reproduced and under which conditions.

For browser defects, capture viewport, overflow/accessibility result and relevant console/network error without dumping unrelated storage or request bodies.

### 4. Apply only safe user actions

Supported low-risk actions include:

- retrying after a confirmed transient network error;
- reopening the canonical route through Today/Learning Path;
- signing out and signing in again when the session is validly recoverable;
- checking the explicit offline/online state;
- using the built-in recovery-code or verified-contact flow;
- exporting local progress before clearing local application state, when export remains available;
- trying another supported browser to isolate a client defect.

Do not instruct learners to delete all browser data before preserving local-only progress. Do not tell them to paste localStorage contents into a ticket.

### 5. Route by ownership

- **Product/content:** incorrect wording, route, readiness, reference result, progression or accessibility.
- **Application engineering:** reproducible client/API/session/sync defect.
- **Operations:** deployment, D1/KV, production health, origin or provider configuration.
- **Security/privacy:** takeover, secret exposure, unauthorised access or suspicious data access.
- **Buyer administration:** support URLs, legal requests, retention, account deletion or provider acceptance.

Every escalation must include the minimum reproduction, not a forward of the entire learner conversation.

## Category-specific guidance

### Login or recovery

Follow [Account recovery](account-recovery.md). A support operator cannot mint, reveal, replace or validate a learner's recovery code and cannot bypass a required verified-contact policy.

### Missing progress or mastery

1. Determine whether the learner is authenticated and which profile owns the evidence.
2. Distinguish local progress, cloud progress and feature-specific evidence.
3. Ask for the visible UI state and timestamps, not raw storage.
4. Reproduce sync with a test account across two browser contexts.
5. Treat any cross-account evidence as a security/privacy incident.
6. Never manually mark a task, checkpoint, assessment or capstone passed to close a ticket.

### SQL result disagreement

1. Record task ID, dialect and expected output description.
2. Use a synthetic/repository dataset; do not request employer data.
3. Compare result columns, row values, deterministic ordering, NULL semantics and duplicate grain.
4. Verify whether hints/reference were used and whether the attempt should be guided or independent.
5. Open a code/content defect when the repository contract is wrong; do not tell the learner their correct query is wrong merely because it differs textually.

### Verified contact/provider failure

- Confirm the capability is intentionally enabled and policy-ready.
- Use masked destinations only.
- Do not reveal whether a raw contact belongs to an account.
- Preserve provider request ID/status without provider secret or full payload.
- If delivery cannot be trusted, operations may disable the optional integration so routes fail closed; support must not simulate delivery or disclose a code.

## Learner communication

A useful response contains:

- what is confirmed;
- what remains available;
- one safe next action;
- whether engineering/operations escalation is active;
- what evidence is still needed, if any;
- a case reference that contains no secret.

Do not blame the learner, promise data recovery before evidence, claim a provider delivered a message without provider proof, or present an estimated root cause as confirmed.

## Closure criteria

Close only when one of these is recorded:

- the problem is reproduced and fixed in a deployed commit, then verified through the original lifecycle;
- a supported user action resolves the case and the learner confirms or the same state is independently verified;
- the report is a documented expected behavior with a clear product explanation;
- the case is transferred to an incident/security/legal process with an owning record;
- reproduction is impossible after bounded attempts and the record states exactly what was tested and what evidence is missing.

Record the final category, cause classification, deployed commit when applicable, learner-facing resolution and any follow-up issue. Delete temporary support accounts and evidence according to the buyer's approved retention policy.
