# Learning analytics privacy threat model

## Purpose

Learning analytics in SQL Academy exists to improve deliberate practice and course content. It must not become employee monitoring, behavioral advertising, identity profiling or a second copy of learner SQL.

## Data boundary

### Local-only full event log

The browser may retain a bounded, versioned event log for the authenticated learner:

- study session start/end;
- published task/module identifiers;
- attempt outcome;
- published diagnostic family;
- independent/retained evidence;
- remediation type and outcome;
- coarse duration bucket.

The local log never includes SQL source, result rows, task text, free-form notes, username, display name, email, phone, employer data, recovery codes or session tokens.

### Server opt-in snapshot

Sharing defaults to `off`. A learner can explicitly enable `coarse-opt-in`. The server then receives one replaceable weekly snapshot per account containing module-level counters and bounded flags. It does not receive task IDs or the local event log.

Snapshots remain linked to the account only to support truthful export, opt-out deletion and account deletion. Public/course-health output aggregates snapshots at query time.

## Threats and controls

| Threat | Control |
| --- | --- |
| SQL or employer data copied into analytics | Schema has no SQL/free-text field; strict allowlist validation rejects unknown keys. |
| Identity exposed through a small cohort | Every module/week slice below five contributors is suppressed, not returned with a redacted identity. |
| Silent tracking | Default `off`; UI explains the payload before opt-in; disabling sharing deletes server snapshots. |
| Event log grows indefinitely | Local history is capped at 5,000 events and 180 days. |
| Duplicate React/browser events inflate metrics | Event IDs are unique and state sanitization de-duplicates them; collectors emit deltas rather than full state. |
| Client forges impossible funnel values | Server checks `retained <= independent <= understood <= attempted <= opened`. |
| Experiment assignment targets individuals manually | Variant assignment is deterministic from account ID and published experiment ID; only allowlisted variants are accepted. |
| Course report becomes a leaderboard | Report contains no user rows, rank, streak or identity; only k-suppressed module/week totals. |
| Opt-out or account deletion leaves linked data | Opt-out deletes snapshots; D1 foreign keys cascade preferences and snapshots on account deletion. |
| Export is incomplete | Local export contains the full local state; cloud export returns preference and all account snapshots. |
| Interventions manipulate engagement | Rules are deterministic, explain their inputs, are dismissible and recommend rest/review rather than streak pressure. |

## Deterministic intervention rules

- **Overload:** at least six attempts in the active session and at most 30% correct.
- **Repeated misconception:** the same published diagnostic family appears at least three times across at least two tasks in seven days.
- **Stalled module:** at least five attempts in one module during the active session without independent evidence.
- **Review debt:** at least five due review tasks or an oldest due task of seven days.

The UI shows the reason and recommended action. No opaque model decides whether the learner is lazy, capable or employable.

## Cohort suppression

The minimum cohort is five distinct account snapshots for the same week and module. Suppressed groups contribute only to a `suppressedRows` count; their metrics and dimensions are not returned.

The threshold prevents direct singleton disclosure. It is not a formal differential-privacy guarantee, so the API also restricts dimensions to published module/week values and does not accept arbitrary filters.

## Retention and lifecycle

- Local events: maximum 180 days / 5,000 events.
- Server snapshots: current implementation retains account-linked weekly snapshots until opt-out, explicit analytics deletion or account deletion.
- Course-health API reads at most the most recent 12 weeks.
- Account deletion cascades both analytics tables.

## Non-goals

- measuring employee productivity;
- collecting production SQL or support tickets;
- inferring protected traits;
- selling or sharing data with advertisers;
- producing individual rankings;
- forcing notifications or streak recovery.
