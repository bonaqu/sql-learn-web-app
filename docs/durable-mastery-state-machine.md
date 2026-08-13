# Durable mastery evidence v1

## Product contract

`durable-mastery-v1` is an evidence version inside the revisioned progress payload. It does not claim that the interval algorithm is scientifically optimal. It provides transparent, deterministic bounds that can be calibrated later from privacy-preserving course-health data.

| State | Allowed evidence | Next state | Forbidden shortcut |
|---|---|---|---|
| Exposure | Task opened or attempted | Guided, independent, or remediation | Opening content is not correctness evidence |
| Guided success | Executable result after a hint or revealed solution | Related retrieval scheduled | Guided success cannot create independent or durable mastery |
| Independent success | Executable contract passes without hint/solution | Related non-identical retrieval due in 10 minutes | Same task, same context, self-rating, or a future/early attempt cannot create durable mastery |
| Delayed retrieval due | Related task has a different ID, context and solution family | Transfer success or targeted retry | A card reveal or confidence button cannot complete this transition |
| Durable evidence | Due related task passes independently against public, hidden and adversarial fixtures | Refresh due in 1, 3, 6, 12, 24, then at most 30 days | Evidence is not permanent and does not unlock unrelated concepts |
| Retrieval failure | Due executable task fails or uses assistance | Relevant durable evidence cleared; retry after 10, 30, 90, 270, 810, then at most 1440 minutes | Failure cannot erase unrelated task/concept evidence |
| Expired evidence | `durableUntil` has passed | Due refresh task | Stale evidence cannot remain durable merely because a prior repetition count is high |

## Queue and merge invariants

- Scheduling is deterministic and idempotent: repeated source events do not duplicate or postpone an existing retrieval.
- All dates are ISO instants and comparisons use epoch milliseconds, so timezone display changes do not change the due boundary.
- The queue contains only previously attempted tasks or a related target scheduled from evidence in the same module; it does not jump prerequisites.
- Confusable due concepts are interleaved when both are already eligible; the queue never manufactures extra work solely to alternate topics.
- Offline progress remains local. Revisioned D1 reconciliation unions task history, chooses the latest retrieval event, and treats a later failure as stronger than stale success.
- Old v2/v3/v4 payloads preserve completion and attempts but receive no fabricated durable evidence.
- Flashcard ratings (`again`, `hard`, `good`, `easy`) are scheduling-confidence signals only. They never prove SQL correctness or durable retention.

## Retrieval selection

The target is selected deterministically from the same module. Its task ID must differ from the source, and authored core contracts must also differ by `contextId` and `solutionFamily`. Preference order is practice, lesson, interview, puzzle, then stable task ID. Existing active source-target bindings are preserved across reloads and sync.

## Review sign-off

- SQL evidence: executable task contracts and three-fixture evaluation remain the correctness source.
- Migration: no D1 schema change is required because progress is already a bounded JSON payload behind revisioned CAS; both old and evidence-versioned payloads are validated.
- Russian copy: returning learner UI says why a task returned and names the next action without internal evidence jargon.
- Scope: penalties and decay are task/source-specific; unrelated evidence survives failures and solution views.
