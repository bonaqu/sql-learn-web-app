# Production incident response

This runbook covers learner-facing outages, authentication failures, progress/evidence integrity concerns, deployment failures, abuse-control regressions and suspected security/privacy events in a buyer-owned SQL Academy deployment.

## Roles

Assign these roles explicitly in the incident record. One person may hold more than one role in a small team, but the incident commander must not approve their own destructive data-recovery action.

- **Incident commander (IC):** owns severity, scope, decisions, handoffs and closure.
- **Operations lead:** owns GitHub Actions, Cloudflare, D1/KV and deployment evidence.
- **Application lead:** owns reproduction, code diagnosis and lifecycle verification.
- **Security/privacy lead:** mandatory for credential exposure, account takeover, unauthorised access or learner-data risk.
- **Communications lead:** publishes factual learner/operator updates without secrets or unsupported root-cause claims.
- **Scribe:** records UTC timestamps, decisions, commands, commit SHAs, request IDs and evidence locations.

## Severity

- **SEV-1 — critical:** confirmed or credible broad unauthorised access, secret exposure, destructive/corrupt data change, widespread login failure, or the production service unavailable for most learners.
- **SEV-2 — major:** a major lifecycle is unusable for a meaningful group, progress/evidence may be incorrect, or a deployment cannot be safely completed without rollback.
- **SEV-3 — limited:** a bounded feature or cohort is affected with a safe workaround and no evidence of data loss or privilege bypass.
- **SEV-4 — minor:** cosmetic, documentation or low-impact defect that does not block a supported lifecycle.

When impact or data integrity is uncertain, start one level higher and downgrade only after evidence.

## Declaration record

Create a private incident record containing:

- incident ID and UTC declaration time;
- severity and the evidence supporting it;
- affected origin/environment and known-good commit;
- first observed time and detection source;
- affected lifecycle(s): availability, auth, progress, curriculum, checkpoints, assessment, capstones, dialect previews, contact verification or operations;
- current IC and role assignments;
- learner impact statement without personal data;
- links to the relevant GitHub Actions run, deployment status and private evidence store.

Do not paste passwords, recovery codes, one-time codes, session tokens, Turnstile tokens, provider secrets, raw D1 exports or unredacted learner records into the incident record.

## First-response sequence

### 1. Stabilise the situation

1. Pause unrelated production merges and deployments.
2. Preserve the current failing Actions artifacts and Cloudflare request identifiers before rerunning anything.
3. If a secret may be exposed, rotate/revoke it through the owning system and record only the secret name and rotation time—not the value.
4. If data integrity is at risk, stop data-changing remediation until a verified backup exists.
5. Keep public claims limited to confirmed impact; do not announce a root cause from a single failed smoke stage.

### 2. Establish public contract state

Run the repository health probe from a trusted operator workstation or protected CI job:

```bash
PRODUCTION_HEALTH_URL=https://your-production-origin.example/ npm run probe:production
```

Preserve `production-health-result.json`. The probe verifies:

- `/api/health` reports `ok`, D1, KV and supported progress/curriculum versions;
- `/api/capabilities` reports the versioned commercial contract;
- username/password and recovery-code authentication remain available;
- optional integrations match the explicitly configured expected state.

A health-probe success does not close an incident when a specific learner lifecycle is failing.

### 3. Locate the failing deployment stage

Inspect the exact production commit's custom statuses and Actions run. Preserve the stage ledger and lifecycle-specific smoke files. Classify the failure before changing production:

- dependency/toolchain;
- TypeScript/domain validation;
- build/bundle/static assets;
- D1 migration;
- Worker/D1/KV deployment;
- public health/capabilities;
- auth/curriculum/progress lifecycle;
- checkpoint, assessment, capstone or analytics lifecycle;
- server-dialect preview;
- contact-provider/Turnstile boundary.

A red custom deployment status is evidence of an unverified deployment, not automatically evidence of a learner outage. Conversely, a green deployment does not disprove a lifecycle-specific incident.

## Data-integrity branch

Before any data-affecting recovery, create and verify an immutable backup pair:

```bash
D1_DATABASE_NAME=sql-academy \
D1_BACKUP_OUTPUT=backups/d1/incident-INCIDENT_ID.sql \
npm run backup:d1

D1_BACKUP_FILE=backups/d1/incident-INCIDENT_ID.sql \
npm run backup:d1:verify
```

Store the SQL export and its `.manifest.json` together in the buyer's restricted evidence location. Record the SHA-256 from the manifest. Never attach the backup to a public issue, chat or ordinary support ticket.

The repository restore command intentionally supports only a visibly non-production target:

```bash
D1_BACKUP_FILE=backups/d1/incident-INCIDENT_ID.sql \
D1_RESTORE_TARGET=sql-academy-restore-rehearsal \
ALLOW_D1_RESTORE=RESTORE_TO_NON_PRODUCTION \
npm run restore:d1:rehearsal
```

The script rejects the source database name and any target that does not visibly identify rehearsal, restore, staging or test. There is no repository command for blind production restore. A production data-recovery plan requires separate buyer approval, a tested rehearsal, a maintenance/communications plan and explicit verification queries.

## Recovery choices

Choose the smallest reversible action supported by evidence.

### Application or static regression

- Identify the last known-good production commit.
- Revert or fix through a reviewed pull request.
- Deploy through the normal buyer-owned GitHub Actions workflow; do not upload edited assets manually.
- Do not assume a Worker rollback reverses a D1 migration.

### Failed D1 migration

- Stop repeated deployment attempts after the exact remote migration error is captured.
- Compare local and remote Wrangler/D1 semantics; do not rewrite production tables interactively.
- Prefer a forward-compatible migration fix.
- Verify it on a fresh local D1 and a non-production remote rehearsal before production deployment.

### Authentication or account-recovery incident

Follow [Account recovery](account-recovery.md). Do not create an operator password-reset bypass, reveal whether an unverified contact exists, or edit credential rows directly.

### Provider or Turnstile incident

- Confirm `/api/capabilities` matches the intended enabled/disabled state.
- If an optional integration cannot be trusted, disable it through configuration so its routes fail closed.
- Preserve username/password and recovery-code access unless evidence shows that core authentication itself is unsafe.
- Never remove server-side verification merely to make a client flow appear healthy.

## Required recovery verification

The IC must assign owners for the applicable checks and record evidence for each:

1. public `/api/health` and `/api/capabilities` contracts;
2. GitHub Pages static application load;
3. Cloudflare Worker deployment and remote D1 migrations;
4. new registration, login, session validation and logout;
5. recovery-code reset and session revocation;
6. verified-contact lifecycle only when the capability is intentionally enabled;
7. progress sync and second-device hydration;
8. curriculum, concept evidence and next canonical action;
9. checkpoints, assessment and capstone immutable-report lifecycle;
10. every supported server-dialect preview class;
11. aggregate admin health only when enabled and allowlisted;
12. no unexpected horizontal overflow or serious/critical accessibility regression in the affected UI.

Do not close on “deployment succeeded” alone. Close only when the original symptom is disproved or reproduced as fixed and the adjacent safety contracts remain intact.

## Communications

Each update should state:

- confirmed impact and affected scope;
- what remains available;
- current containment or recovery action;
- the next evidence milestone;
- whether learner action is required.

Do not expose usernames, user IDs, contacts, request bodies, SQL submissions, credentials or internal security details. Correct earlier statements explicitly when new evidence changes the diagnosis.

## Closure and post-incident review

Closure requires:

- exact production commit and successful deployment statuses;
- original symptom verification;
- data-integrity conclusion and backup manifest reference when applicable;
- list of rotated secrets or revoked sessions by identifier only;
- residual risks and externally owned acceptance work;
- support follow-up for affected learners;
- a written timeline, root cause, contributing factors and prevention actions;
- owner and due condition for every prevention action.

Classify transient infrastructure failures separately from product defects, but preserve enough diagnostics to identify an exact deterministic case if it recurs. Delete temporary smoke accounts and keep incident evidence according to the buyer's approved retention policy.

## Prohibited shortcuts

- no direct credential or progress edits in production D1;
- no sharing or requesting passwords, recovery codes, one-time codes or session tokens;
- no disabling fail-closed verification to restore a happy-path demo;
- no restoring an unverified backup;
- no production restore rehearsal against the source database;
- no force-push or unreviewed hot edit to the protected production branch;
- no claim that a provider, penetration test, legal review or paying-learner acceptance passed without external evidence.
