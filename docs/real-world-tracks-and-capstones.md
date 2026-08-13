# Real-world tracks and capstones

This document is the review surface for the role-track and capstone contracts implemented in phase 9. The executable source of truth remains `src/data/role-track-matrices.ts` and `src/data/capstone-contracts.ts`.

## Track matrix

Every route starts with the same six-module foundation: SQL thinking, filtering, SELECT, sorting, aggregates, and grouping. A preference changes future emphasis; it never deletes or duplicates completed evidence.

| Track | Authentic work | Differentiated evidence | Capstone |
| --- | --- | --- | --- |
| Professional SQL | Agree a result contract; review query quality and limits | SQL, control rows, grain, NULL policy, reproducible checks | T-Bonk SLA Executive Mart |
| Support | Reconstruct history/SLA; investigate duplicate or missing contacts | Event timeline, breach state, NULL-aware duplicate groups | Incident Command Dashboard |
| Analyst | Define metrics; compare cohort/funnel and window trend | Population/denominator contract, cohort/funnel SQL, decision memo | Learning Activation Decision |
| Backend | Migrate rows safely; review locking, index and injection boundaries | Transactional SQL, final-state invariants, real plan and runtime note | Safe Ticket State Migration |
| Data engineering | Profile/model a source; build a reproducible pipeline | Quality gates, model grain, staged/idempotent checks | Customer Data Trust Audit |

## Original datasets and hidden variants

All fixtures are synthetic and authored for SQL Academy. Reserved `.example` contacts are used where contact-shaped values are needed. No employer, learner, customer, or competitor dataset was copied.

- Public dataset: committed course-owned ticket, customer, engineer, service-tree, event and request fixtures.
- Support hidden variants: new service, open ticket, NULL contact, normalized duplicate, SLA/risk tie.
- Analyst hidden variant: calendar-week boundary, missing assignment, unknown event type, funnel drop-off.
- Backend hidden variant: an additional migration target and a protected closed row that expose unbounded mutation.
- Data-quality hidden variant: whitespace/case duplicate and missing contact values.

`npm run validate:capstones` executes every reference bundle against public and hidden variants, then executes a broken bundle and requires actionable remediation. The expected trace is five `reference=100/PASS` lines and five `broken=.../FAIL` lines.

## State, plan and engine evidence

The backend migration artifact is not graded from its own SELECT output. The evaluator creates an isolated database, executes the learner transaction, runs a fixed post-state query, and compares that state with the reference database on both public and hidden variants. Unsafe schema operations, missing `BEGIN`/`COMMIT`, and unbounded `UPDATE`/`DELETE` are rejected before execution.

Plan artifacts execute real SQLite `EXPLAIN QUERY PLAN`. SQLite wording, week formatting, write serialization and lack of `SELECT FOR UPDATE` are labeled explicitly in the UI. PostgreSQL/MySQL plan, transaction, locking and semantic claims are proven by the Docker real-engine CI gate; SQLite evidence is never presented as vendor-engine evidence.

## Portfolio privacy and provenance sample

Portfolio exports include the immutable SQL snapshot, automated checks, score, explanation and one of the recorded provenance labels:

- `independent` — no guidance or solution view;
- `guided` — guidance used, solution not revealed;
- `solution-assisted` — solution revealed; cannot pass the independence gate.

Account IDs are not exported. Email, phone, JWT-like token, password, secret and API-key patterns are redacted before Markdown, SQL, or print/PDF output. For example:

```text
Provenance: independent
Independence: 100%
Contact: [REDACTED_EMAIL]
api_key=[REDACTED_SECRET]
```

The browser contract submits a failed attempt and an independent passing attempt for every track, confirms D1 persistence, exercises nested-dialog Escape/focus restoration, runs axe with no serious/critical findings, and checks 360px reflow without horizontal overflow.
