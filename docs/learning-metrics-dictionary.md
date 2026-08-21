# Learning metric dictionary

## Decision rule

Course-health metrics answer a content decision, not “how engaged is this person?”. Clicks, page views, session length, streaks and XP are explicitly rejected as mastery proxies. They may describe delivery friction, but they cannot unlock curriculum, rank a learner, justify employment decisions or prove learning.

Every released cohort has at least five contributors. Every task row shows `n`, a 90% Wilson interval and an evidence-strength label. A signal is a hypothesis with a plausible alternative, never deterministic blame.

## Local events

| Event | Allowed dimensions | Learning meaning | Decision it may inform |
| --- | --- | --- | --- |
| `task_opened` | published task/module ID | task became available to work | detect opened-without-attempted friction only |
| `attempted` | published IDs, correct/independent booleans | executable contract was tried | denominator for independent success and stalls |
| `diagnostic_observed` | published diagnostic family | bounded misconception family appeared | add/rewrite a counterexample when the same family repeats |
| `remediation_started` | `hint`, `solution`, `retry`, `review` | assistance was requested | distinguish productive remediation from hint/solution dependence |
| `remediation_completed` | published IDs, success boolean | later independent retry recovered | decide whether remediation copy/sequence works |
| `independent_pass` | published IDs | task contract passed without current assistance | primary near-term skill evidence |
| `retention_checked` | published IDs | delayed related-task evidence passed | decide whether retrieval spacing transfers |
| `lapse_detected` | published diagnostic family | prior evidence failed after delay | create review debt/remediation, not a punishment |
| `placement_checked` | published IDs, supported/mismatch band | later work did or did not support placement | recalibrate placement thresholds after cohort evidence |
| session start/end | coarse duration bucket only | bounded context for overload/stall rules | detect friction; never claim mastery |

The browser keeps the local log for at most 180 days and 5,000 events. It never accepts SQL, result rows, task text, notes, contact data, employer data, secrets, recovery codes, tokens or arbitrary free text.

## Server aggregates

| Metric | Definition | Learning decision | Guardrail |
| --- | --- | --- | --- |
| Independent success | independent passes / executable attempts | check prerequisite or task difficulty | interpret with Wilson interval; never use XP/completion as numerator |
| Hint dependence | contributors needing a hint / contributors on item | repair fading sequence | first worked example may legitimately be assisted |
| Solution dependence | contributors viewing a solution / contributors on item | protect an unseen transfer task | never infer motivation or integrity |
| Misconception frequency | bounded diagnostic observations / contributors | add targeted counterexample | verify expected shape/fixtures before blaming explanation |
| Remediation success | later independent recovery / remediation starts | keep, split or rewrite remediation | require enough starts and no solution-dependence regression |
| Delayed retention | retained passes / prior independent passes | adjust retrieval interval/task relation | related task must be non-identical and due |
| Review debt | bounded due-review flag per account/week | rebalance Today allocation | no streak pressure or notification targeting |
| Stall | bounded module flag after five attempts without independent evidence | split step or repair prerequisite | may reflect placement mismatch or runtime friction |
| Placement accuracy | supported placement checks / subsequent checks | adjust thresholds/route | directional until delayed post-placement work exists |
| Transfer | independent unseen/checkpoint/capstone evidence | validate professional competence | synthetic personas prove contracts, not human transfer |

## Diagnostic patterns

- `lesson-success/task-failure`: neighbouring lesson evidence is healthy while one task is weak; inspect difficulty jump, wording and fixtures.
- `lesson-explanation-risk`: several tasks in one lesson are weak; inspect prerequisites and prediction → explanation → fading sequence.
- `mass-misconception`: one diagnostic family dominates; verify the expected result first, then add a counterexample.
- `hint-escalation`: hint/solution dependence rises; preserve assistance but add a separate independent transfer step.
- `placement-mismatch`: later task evidence does not support the recommended band; recalibrate only after cohort evidence.
- `retention-collapse`: initial independence does not survive delayed retrieval; change spacing/related-task design.

None of these signals proves causation. P0 is reserved for data loss, privacy leakage or a broken learning contract. Learning-quality hypotheses are normally P1/P2 and require reproducible acceptance criteria.

## Export, deletion and retention

Local export contains the bounded local event schema. Cloud export contains the learner’s preference and replaceable weekly snapshots, including module and item aggregates. Opt-out deletes cloud snapshots immediately; explicit analytics deletion removes preference and snapshots; account deletion cascades both tables. Item aggregates add no separate table or hidden lifecycle.
