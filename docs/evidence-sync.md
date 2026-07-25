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
