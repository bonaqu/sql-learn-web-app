# Course-health evidence register

## Current status

| Evidence | Status | Result | Boundary |
| --- | --- | --- | --- |
| Metric/event dictionary | ready | independent, assistance, misconception, remediation, retention, debt, stall, placement and transfer decisions defined | clicks/session length/XP rejected as mastery |
| Payload/privacy validator | passed locally | strict allowlists reject SQL/free text and task/lesson mismatches | production confirmation required after merge |
| D1 lifecycle | passed locally | export, opt-out, explicit delete and account cascade cover module and item aggregates | production confirmation required after merge |
| Item-health cases | passed locally | zero, low-sample, task jump, lesson explanation, misconception, hint, placement and retention cases | seeded cases prove logic, not actual course quality |
| Synthetic personas | passed locally | zero, partial, role-focused and returning reports use fixed seed; desktop/mobile journeys passed | exact-head CI evidence required |
| Human pilot field kit | ready | consent notice, observer checklist, invalid-by-default aggregate template and strict validator | owner must authenticate consent and source custody |
| Human Session A | external gate | no participants/results | do not claim educational KPI |
| Human Session B | external gate | no delayed results | do not claim retention/transfer |

## Evidence locations

- Metric dictionary: `docs/learning-metrics-dictionary.md`
- Privacy threat model: `docs/learning-analytics-privacy.md`
- Deterministic persona snapshot: `docs/evidence/learner-personas.json`
- Pilot protocol: `docs/human-learning-pilot.md`
- Pilot field kit: `docs/human-learning-pilot-field-kit.md`
- Invalid-by-default aggregate template: `docs/human-learning-pilot-report.template.json`
- Aggregate evidence directory: `docs/evidence/pilot/`
- Aggregate validator: `scripts/validate-human-pilot-evidence.ts`
- Issue/duplicate register: `docs/course-health-issue-register.md`
- Automated gates: `scripts/validate-learning-analytics.ts`, `scripts/validate-course-health.ts`, `scripts/validate-learning-analytics-lifecycle.ts`, `scripts/validate-learner-personas.ts`

## Result record schema

Human results, when authorized, must contain only release SHA, coded band, aggregate denominators/numerators, Wilson intervals, bounded assistance provenance, task/lesson IDs, outcome definitions and issue links. Names, contacts, raw SQL, exact timestamps, recordings and employer/client data are forbidden.

Published band and journey rows require at least five contributors. Smaller bands are represented only by the combined `suppressedParticipants` count. A `complete` report additionally requires non-empty `n >= 5` denominators for every KPI and a publishable Session A plus Session B journey. Structural validation does not authenticate consent or prove efficacy.
