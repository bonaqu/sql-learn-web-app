# Evidence synchronization lifecycle

SQL Academy stores assessment and checkpoint reports locally first, then reconciles them with authenticated D1 history.

## Why a global agent exists

Learning Path, Curriculum prerequisite access and Syllabus readiness read local evidence so they remain available offline. Without initial hydration, a new browser would appear to lose cloud evidence until the user manually opened Assessment Center or Checkpoint Center.

`EvidenceSyncAgent` runs after authentication and dynamically imports the heavier reconciliation module. This keeps the initial application bundle small while removing screen-order dependencies.

## Reconciliation algorithm

For assessment and checkpoint reports independently:

1. read the bounded local history;
2. fetch the authenticated remote history;
3. merge by stable report ID;
4. prefer the later `completedAt` value;
5. when timestamps are equal, prefer the richer deterministic payload;
6. persist remote/newer winners locally;
7. upload local-only or locally newer reports to D1.

Histories remain bounded to the existing product limits:

- assessment: 20 reports;
- checkpoints: 50 reports.

## Offline behavior

A completed session is always written to localStorage before cloud sync. If the immediate POST fails:

- the report remains usable locally;
- `EvidenceSyncAgent` retries after the browser emits `online`;
- a later visible-tab or report-change event also schedules reconciliation.

No user action or manual Center opening is required.

## Conflict and loop safety

Merge order is deterministic. Once local and remote payloads are equal, `reportsToUpload` returns an empty list. Saving a newly hydrated remote report may schedule one additional reconciliation pass, but the stable second pass performs no write and therefore cannot create an infinite event loop.

## Failure isolation

Assessment and checkpoint reconciliation use independent promises. A temporary failure in one endpoint does not block hydration of the other. HTTP 401 is treated specially: the local auth session is cleared because the server session is no longer valid.

## Quality gates

`scripts/validate-evidence-sync.ts` verifies:

- local-only and remote-only preservation;
- newer local and newer remote conflict resolution;
- richer same-time payload retention;
- deterministic ordering and history limits;
- exact upload candidate selection;
- stable no-loop state after reconciliation.

The Playwright checkpoint flow verifies:

- a report completed while offline remains local;
- reconnecting uploads it without reopening Checkpoint Center;
- a second authenticated browser hydrates the report automatically;
- Learning Path sees checkpoint provenance before Checkpoint Center is opened.

## Course progress CAS contract

Authenticated course progress uses `GET|PUT /api/mastery/progress` (the compatibility alias `/api/user/progress` resolves to the same handler). Every write carries `baseRevision` and is accepted only when it matches the current D1 row. A successful write increments the revision once and returns the canonical stored progress with that exact revision.

On HTTP 409 the browser re-reads D1, deterministically unions local and cloud completion/evidence, then retries once from the new revision. Local storage and the visible sync state change only after reconciliation succeeds. Network failure therefore leaves local work intact and does not report a successful sync.

Task counters use a bounded grow-only replica map inside the existing progress JSON. A legacy scalar snapshot is migrated to the deterministic `legacy` component; each browser installation then increments only its anonymous random `replica-*` component. Merge takes the maximum only for the same replica and sums different replicas, so a shared baseline of 5 plus one attempt on device A and one attempt on device B becomes 7 rather than the lossy scalar maximum of 6. Attempts, errors, hints, solution views, assisted/independent passes, retrieval successes/lapses and diagnostic-kind counts share this contract.

Replica IDs contain no account, session, contact or device-name data. Each task is limited to 32 components, every component and derived total is bounded, and both progress endpoints reject unknown IDs, excess components and any scalar total that disagrees with its component sum. Scalar-only history remains readable and migrates without a D1 schema change. Once a canonical row contains replica components, a cached old client cannot delete or decrease them: the Worker returns `409 PROGRESS_COUNTERS_STALE`, keeps the canonical revision unchanged and leaves that client's local work available for recovery after update.

The older profile-scoped `PUT /api/progress` contract is now fail-closed with HTTP 428 and `PROGRESS_REVISION_REQUIRED`; its `GET` remains read-only for recovery diagnostics. This is a code-only compatibility migration: migration `0002_anonymous_accounts.sql` already added `progress.revision`, so no historical D1 migration is rewritten and no new schema migration is required. A cached pre-change client cannot overwrite a newer row; after one reload, the current bundle retries through the revisioned contract.

Regression evidence is split across:

- `scripts/validate-evidence-sync.ts` for a deterministic shared-baseline 409 → re-read → additive merge → revision-3 trace, inconsistent/unbounded payload rejection, offline immutability and legacy fail-closed behavior;
- `tests/e2e/evidence-sync.spec.ts` for the same two-device same-task interleaving against the local Wrangler/D1 runtime, plus cached-client reload and empty Review state;
- `scripts/mastery-progress-production-smoke.mjs` for deployed D1 revision, inconsistent-counter and legacy-overwrite rejection, exact additive totals and account cleanup.
