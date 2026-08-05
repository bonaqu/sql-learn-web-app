# Technical-data retention

SQL Academy retention is intentionally limited to short-lived authentication and contact-operation records. Learning evidence is not part of automated cleanup.

## Contract

`technical-retention-policy-v1` controls these technical scopes:

| Scope | Default | Configurable range | Cleanup trigger |
| --- | ---: | ---: | --- |
| Contact delivery events | 30 days | 1–30 days | provider event + protected admin action |
| Contact security events | 30 days | 1–30 days | challenge/confirmation + provider event + protected admin action |
| Confirmed but unconsumed contact challenges | 24 hours | 1–24 hours | challenge/confirmation + protected admin action |
| Consumed contact challenges | 24 hours | 1–24 hours | challenge/confirmation + protected admin action |
| Expired unconfirmed contact challenges | immediately after expiry | fixed | challenge/confirmation + protected admin action |
| Expired authentication sessions | immediately after expiry | 0–24 hours | protected admin action; an accessed expired session is also deleted by auth |
| Rows per scope and cleanup pass | 250 | 25–500 | every execution |

Configuration can shorten existing privacy windows but cannot silently extend them beyond the repository-reviewed 30-day/24-hour maxima.

Provider delivery acknowledgements remain independent from opportunistic cleanup. Once a signed event is stored and validated, a cleanup failure is logged as `contact_delivery_retention_failed` but does not turn the provider acknowledgement into a `500` response or create artificial webhook retries. Operators can clear any resulting bounded backlog through the protected retention API.

## Preserved records

Automated retention never deletes:

- users or user profiles;
- recovery codes;
- verified contacts;
- contact ticket-consumption receipts;
- learning progress, curriculum evidence or mastery evidence;
- checkpoint, assessment or capstone reports.

Account deletion remains the explicit authenticated product flow and is not implemented by retention cleanup.

## Configuration

Set plain Worker variables, not secrets:

```text
RETENTION_CONTACT_EVENTS_DAYS=30
RETENTION_UNCONSUMED_CONTACT_HOURS=24
RETENTION_CONSUMED_CHALLENGE_HOURS=24
RETENTION_EXPIRED_SESSION_HOURS=0
RETENTION_CLEANUP_BATCH_SIZE=250
```

Accepted integer ranges are encoded in `worker/retention-policy.ts`. Missing values use the defaults above. Invalid, fractional or out-of-range values do not get clamped to a surprising boundary: the safe default is used and an exact `*_INVALID` code appears in protected admin health and retention responses.

The Cloudflare production workflow exposes the same five GitHub repository variables, applies the safe defaults above and writes them into the generated `wrangler.deploy.jsonc`. CI and deployment install the committed dependency graph with `npm ci`; a retention change is therefore tested against the same locked tree used for production assembly.

## Protected operator API

The API exists only when the existing admin console is fully ready:

- `FEATURE_ADMIN_CONSOLE=on`;
- `ADMIN_ALLOWED_USER_IDS` contains the authenticated operator's user ID;
- D1 is configured.

Otherwise both `/api/admin/health` and `/api/admin/retention` remain hidden as `404`.

### Preview

```http
GET /api/admin/retention
Authorization: Bearer <operator session>
```

The response contains the effective policy, configuration errors and up to one batch of eligible rows per scope. It performs no deletion.

A scoped preview is also available:

```json
{
  "mode": "dry-run",
  "scopes": ["expiredSessions", "contactSecurityEvents"]
}
```

### Execute

```json
{
  "mode": "execute",
  "confirmation": "DELETE_EXPIRED_TECHNICAL_DATA",
  "scopes": [
    "expiredSessions",
    "expiredUnconfirmedChallenges",
    "confirmedUnconsumedChallenges",
    "consumedChallenges",
    "contactSecurityEvents",
    "contactDeliveryEvents"
  ]
}
```

Execution without the exact confirmation returns `409`. Every scope uses an ordered, bounded `DELETE ... IN (SELECT ... LIMIT ?)` statement. The response reports eligible and actually deleted row counts separately.

## Operating procedure

1. Verify a checksummed D1 backup before a deliberate cleanup-policy change.
2. Apply variables to staging or a buyer-owned non-production Worker.
3. Inspect `/api/admin/health` for retention configuration errors.
4. Run a dry-run and record eligible counts/cutoffs.
5. Execute only the intended scopes with the explicit confirmation.
6. Repeat until eligible counts are zero when clearing an existing backlog; each request is intentionally bounded.
7. Verify login/session behavior and enabled contact-verification/provider lifecycles.
8. Deploy the same configuration to production through the normal GitHub Actions workflow.

Do not add progress/evidence tables to cleanup queries as an operational shortcut. A new retention scope requires its own data-ownership analysis, migration/index review, validator coverage and buyer privacy review.
