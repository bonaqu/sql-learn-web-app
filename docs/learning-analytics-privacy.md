# Learning analytics privacy threat model

## Purpose

Learning analytics in SQL Academy improves deliberate practice and course content. It must not become employee monitoring, behavioral advertising, identity profiling or a second copy of learner SQL.

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

Sharing defaults to `off`. A learner can explicitly enable `coarse-opt-in`. The server then receives one replaceable weekly snapshot per account containing:

- module-level funnel counters and bounded flags;
- published task/lesson IDs with bounded attempt, independence, assistance, misconception, retention and placement-match counters;
- five coarse time-to-mastery buckets;
- deterministic variants for allowlisted content experiments.

Task and lesson IDs describe public course content, not learner input. The server does not receive exact event timestamps, learner SQL, result rows, diagnostic text, free-form notes or the local event log. The snapshot payload contains no user ID; D1 links the stored row to the authenticated account only for truthful export and deletion.

Snapshots remain linked to the account until opt-out, explicit deletion or account deletion. Course-health output aggregates snapshots at query time.

## Threats and controls

| Threat | Control |
| --- | --- |
| SQL or employer data copied into analytics | Schema has no SQL/free-text field; strict allowlist validation rejects unknown keys at snapshot, mastery and row levels. |
| Identity exposed through a small cohort | Every module/week, task/week, mastery/week and experiment/week slice below five contributors is suppressed independently. |
| Silent tracking | Default `off`; UI explains the payload before opt-in; disabling sharing deletes server snapshots. |
| Event log grows indefinitely | Local history is capped at 5,000 events and 180 days. |
| Duplicate browser events inflate metrics | Event IDs are unique, collector records state deltas, and near-duplicates are de-duplicated. |
| Client forges impossible funnels | Server checks `retained <= independent <= understood <= attempted <= opened` and remediation successes cannot exceed starts. |
| Experiment assignment targets individuals manually | Assignment is deterministic from account ID and an allowlisted experiment ID; the account ID is not included in the analytics payload. |
| A small experiment slice reveals identity | Each week/experiment/variant row has its own minimum cohort of five and is never crossed with module ID. |
| One noisy metric declares a winner | UI labels experiment output as observational and requires several weeks, aligned independent/retained movement and no remediation regression. |
| Course report becomes a leaderboard | No user rows, ranks, streaks or identity are returned. |
| Opt-out/account deletion leaves linked data | Opt-out deletes snapshots; D1 foreign keys cascade on account deletion. |
| Interventions manipulate engagement | Rules are deterministic, explain inputs and recommend rest/review rather than streak pressure. |

## Deterministic intervention rules

- **Overload:** at least six attempts in the active session and at most 30% correct.
- **Repeated misconception:** one diagnostic family at least three times across at least two tasks in seven days.
- **Stalled module:** at least five attempts in one module during the active session without independent evidence.
- **Review debt:** at least five due review tasks or an oldest due task of seven days.

The UI shows the exact reason and recommended action. No opaque model decides whether the learner is lazy, capable or employable.

## Course-effectiveness output

The report may expose only aggregate evidence:

- module funnel, lapses, remediation outcomes and bounded overload/stalled/review-debt counts;
- task/lesson health with hint/solution dependence, misconceptions, delayed retention and placement-match counts;
- weekly time-to-mastery buckets;
- weekly allowlisted experiment variants with attempted, independent, retained and remediation totals.

Action suggestions are deterministic heuristics over already-released cohort rows: check prerequisites when independent evidence is low, add retrieval practice when retention is low, rewrite remediation when recovery is weak, and split lessons when overload/stalled signals are frequent. They are content-editing recommendations, not judgments about learners.

## Cohort suppression

The minimum cohort is five distinct account snapshots. Suppression is applied independently to:

1. the same week and module;
2. the same week and published task ID;
3. the same week for time-to-mastery;
4. the same week, allowlisted experiment and variant.

Suppressed groups contribute only to `suppressedRows`, `suppressedItems`, `suppressedMasteryPeriods` or `suppressedExperiments`; their metrics and dimensions are not returned. Experiment rows are deliberately not crossed with module or task ID to reduce singling-out risk.

This is not a formal differential-privacy guarantee, so the API also restricts dimensions to published values, caps the report to twelve weeks and does not accept arbitrary filters.

## Retention and lifecycle

- Local events: maximum 180 days / 5,000 events.
- Server snapshots: retained until opt-out, explicit analytics deletion or account deletion.
- Course-health API reads at most the latest 12 weeks. Item aggregates share the snapshot row and therefore the same export, opt-out, explicit-delete and account-cascade lifecycle.
- Account deletion cascades both analytics tables.

## Non-goals

- measuring employee productivity;
- collecting production SQL or support tickets;
- inferring protected traits;
- selling or sharing data with advertisers;
- producing individual rankings;
- declaring an experiment winner automatically;
- forcing notifications or streak recovery.
