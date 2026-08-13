# Interview and dialect evidence

Reviewed: 2026-08-13

## Interview contract

The simulation pool contains 20 SQL Academy-authored Interview tasks. Every item has a hidden executable contract, a distinct context and solution family, and one of eight reasoning patterns:

| Pattern | Items | What the learner must make explicit |
|---|---:|---|
| Contract first | 3 | output grain, required columns, stable order |
| Counterexample | 3 | rows that disprove an over-broad rule |
| Grain and cardinality | 4 | join/aggregation multiplicity and denominator |
| Decomposition | 2 | named stages and invariant per stage |
| Boundary analysis | 2 | half-open time ranges, ties, NULL boundaries |
| Plan evidence | 2 | observable access path rather than plan vocabulary recall |
| Safe change | 2 | bounded writes, rollback and state invariants |
| Incident hypothesis | 2 | competing explanations and falsifying evidence |

All four difficulty bands are represented. The validator rejects an Interview solution if its normalized SQL is identical to a practice or unseen-checkpoint solution.

The ordinary learning task is untimed. `SQL Interview Simulation` is a separate, recoverable 35-minute session: the original deadline, current item, SQL, prose fields and assistance counters survive reload. Timeout produces an explicit `expired` report instead of silently losing work.

## Explanation rubric and authority boundary

Deterministic SQL correctness and prose review are separate:

- SQL is executed against the existing public/hidden semantic contract.
- explanation records grain, steps and why the query satisfies the result contract;
- alternative records another viable approach and a trade-off;
- edge cases record relevant NULL, duplicate, tie or time-boundary behavior;
- the report stores completeness and `awaiting-human-review`; `proseScore` is always `null`;
- AI may return bounded clarification/debrief text, but is never the authority for correctness or prose quality.

The report retains `interviewerUses`, `hintsUsed` and `solutionViews`. Assessment hints and solution reveal remain unavailable, but the zero counters are still part of the report contract. Any interviewer use lowers independence and excludes the item from calibration telemetry. No assessment report writes mastery evidence.

## Dialect evidence matrix

The academy publishes 11 capability labs × 3 dialect cases. SQLite cases execute locally where its engine can represent the behavior. PostgreSQL and MySQL have 22 isolated CI contracts against PostgreSQL and Oracle MySQL 8.4. The real-engine validator also applies one deliberately wrong expected column contract to each server engine output; the negative control must be rejected.

Every learner-facing engine claim maps to a primary manual entry in `src/data/dialect-primary-sources.ts`. Representative sources include:

- NULL ordering: [PostgreSQL 18 sorting](https://www.postgresql.org/docs/current/queries-order.html), [MySQL 8.4 NULL handling](https://dev.mysql.com/doc/refman/8.4/en/working-with-null.html), [SQLite SELECT ordering](https://www.sqlite.org/lang_select.html#orderby).
- JSON: [PostgreSQL JSON operators](https://www.postgresql.org/docs/current/functions-json.html), [MySQL JSON search/value behavior](https://dev.mysql.com/doc/refman/8.4/en/json-search-functions.html), [SQLite JSON functions](https://www.sqlite.org/json1.html).
- Window frames: [PostgreSQL window functions](https://www.postgresql.org/docs/current/functions-window.html), [MySQL frame specification](https://dev.mysql.com/doc/refman/8.4/en/window-functions-frames.html), [SQLite window functions](https://www.sqlite.org/windowfunctions.html).
- Isolation and locking: [PostgreSQL transaction isolation](https://www.postgresql.org/docs/current/transaction-iso.html), [MySQL InnoDB isolation](https://dev.mysql.com/doc/refman/8.4/en/innodb-transaction-isolation-levels.html), [MySQL locking reads](https://dev.mysql.com/doc/refman/8.4/en/innodb-locking-reads.html), [SQLite isolation and serialized writes](https://www.sqlite.org/isolation.html).

## Free production boundary

Cloudflare Free production does not run PostgreSQL or MySQL. It returns a CI-verified reference preview with:

- `passed: false`;
- `evidenceEligible: false`;
- `offlinePreview: true`;
- an explicit `ci-reference-preview-v1` provenance marker.

The UI says `CI reference preview` and `not evidence eligible`; storing or synchronizing it cannot increase lab completion. The optional real-engine profile remains a separate deployment contract.
