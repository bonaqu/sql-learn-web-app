# Final hardening audit

Audit date: 2026-08-21. Scope: the 14-phase SQL Academy learning-system programme from planning baseline `8a713ebb8035e699b8bf66456fc538184abff95c` through the Phase 14 reviewed tree. A Git commit cannot contain its own hash, so the immutable Phase 14 head, merge SHA, workflow runs, deployment runs, health result and live-browser evidence are recorded in PR #216 and GitHub issue #82 after publication.

Status vocabulary:

- **Verified** — a current executable contract, browser scenario, production contract or versioned evidence document exists.
- **External acceptance gate** — engineering support exists, but the requested educational outcome needs consented human evidence and is not claimed.

## Master-prompt requirement matrix

| # | Requirement | Status | Authoritative current evidence |
| ---: | --- | --- | --- |
| 1 | Do not trust existing course content | Verified | `docs/core-task-contract-review.md`; `scripts/validate-core-task-progression.ts`; authored advanced validators; positive and negative evaluator fixtures |
| 2 | Deep research of SQL learning | Verified | `.supergoal/.../RESEARCH.md`; `docs/learning-journey-audit.md`; `docs/curriculum-editorial-matrix.md`; primary-source dialect evidence in `docs/interview-and-dialect-evidence.md` |
| 3 | Onboarding and personalization | Verified | `docs/onboarding-placement.md`; `scripts/validate-onboarding.ts`; `tests/e2e/onboarding.spec.ts` |
| 4 | Personalized learning graph | Verified | `docs/learning-journey-contract.md`; goal-route/switch validators; `tests/e2e/learning-path.spec.ts` |
| 5 | Correct lesson structure | Verified | `docs/beginner-lesson-loop-v1.md`; lesson-bridge and beginner-loop validators; curriculum browser tests |
| 6 | Smart SQL evaluation | Verified | versioned task-evaluation contracts, three-fixture semantic checks, final-state mutation invariants and deliberately wrong negative expectations |
| 7 | Hint system | Verified | bounded hint/solution provenance in task contracts, assessment reports, durable-evidence invalidation and analytics separation |
| 8 | AI tutor / mentor | Verified | `docs/security-privacy-ai.md`; explicit consent, Socratic authority boundary, quota/redaction validators and production smoke |
| 9 | Misconception engine | Verified | misconception taxonomy in task contracts; `scripts/validate-course-health.ts`; remediation and learner-analytics validators |
| 10 | Mastery means demonstrated knowledge | Verified | `docs/durable-mastery-state-machine.md`; independent related-task evidence, delayed retrieval and checkpoint validators |
| 11 | Spaced review, retrieval and interleaving | Verified | `scripts/validate-review-scheduling.ts`; daily-route and durable-mastery contracts; `tests/e2e/mastery-loop.spec.ts` |
| 12 | Daily learning loop | Verified | `docs/adaptive-placement-and-daily-route.md`; deterministic allocation validator; guided-journey browser coverage |
| 13 | Motivation without replacing pedagogy | Verified | calm progress/recovery UX in `docs/calm-accessible-fast-ux.md`; no XP/click/session-time mastery proxies in the metrics dictionary |
| 14 | Real-world SQL | Verified | five role tracks and production-shaped scenarios in `docs/real-world-tracks-and-capstones.md` |
| 15 | Projects | Verified | five original capstones, hidden edge fixtures, mutation final-state checks and privacy-safe portfolio export |
| 16 | Interview mode | Verified | four original five-task forms, assistance-aware scoring and calibration evidence in `docs/interview-and-dialect-evidence.md` |
| 17 | Dialects | Verified | PostgreSQL/MySQL labs, preview provenance, hydration/observability validators and exact-head real-engine CI |
| 18 | UX/UI | Verified | `docs/ux-guided-journey.md`; progressive disclosure, natural-copy validators and desktop browser journeys |
| 19 | Mobile | Verified | Pixel 7/360 px navigation, editor, table, touch-target and overflow contracts in Playwright |
| 20 | Accessibility | Verified | semantic controls, inert/focus restoration, reduced motion, contrast and zero serious/critical axe gates |
| 21 | Performance | Verified | locked budgets in `scripts/performance-budgets.ts`, bundle enforcement, production cold-profile evidence runner and PWA first-reload smoke |
| 22 | Technical stack and free-first constraint | Verified | local SQLite, Cloudflare Worker/D1/KV/AI bindings, no paid-only core dependency; `docs/dependency-governance.md` |
| 23 | Cloudflare skills and boundaries | Verified | Worker compatibility, D1 lifecycle, resource health, dry-run deploy and production lifecycle smoke contracts |
| 24 | GitHub skills and delivery process | Verified | protected default branch, exact-head Quality, Pages and Cloudflare workflow gates for every phase |
| 25 | Skills/plugins discipline | Verified | run-owned applied-skills record and phase evidence; no unavailable plugin was substituted for product proof |
| 26 | Security and privacy | Verified | `docs/security-privacy-ai.md`; exact origin, bounded payloads, rate/quota controls, secret boundaries, export/delete and retention gates |
| 27 | Learning analytics | Verified | `docs/learning-metrics-dictionary.md`; privacy-minimal allowlists, item k-anonymity, lifecycle and persona validators |
| 28 | Content quality | Verified | 240-task title/source scan, curriculum/editorial matrix, syntax frontier, duplicate/provenance and authored-topic validators |
| 29 | Avoid needless complexity | Verified | free-first architecture, lazy heavy tools, native disclosure/dialog semantics and validator-backed contracts instead of parallel scoring stacks |
| 30 | First deep audit | Verified | planning audit and reproducible baseline in `.supergoal/.../ROADMAP.md`, `RESEARCH.md`, `repo-map.md` and `STATE.md` |
| 31 | New pedagogical roadmap | Verified | 14 dependency-ordered phases with explicit evidence and acceptance criteria in `.supergoal/.../ROADMAP.md` |
| 32 | Quality gates | Verified | `npm run check`, build, bundle, full E2E, real engines, operations, dry deploy and production gates |
| 33 | Definition of success | **External acceptance gate** | code/synthetic evidence is complete, but `docs/human-learning-pilot.md` remains `NOT STARTED — EXTERNAL ACCEPTANCE GATE`; no efficacy, retention or transfer claim is made |
| 34 | Autonomy | Verified | implementation, focused fixes, CI/deployment verification and reversible resource cleanup are agent-executed; external participant consent is not fabricated |
| 35 | Required first move | Verified | deep audit/research preceded the roadmap and phase execution; the planning baseline is retained for diff verification |

## Final sub-passes

### Curriculum truth

The prerequisite graph, syntax frontier, lesson bridges, 120 core and authored advanced task contracts, unseen checkpoints, five capstones and four interview forms are checked by deterministic validators. Positive fixtures and deliberately wrong expectations exercise result semantics, while mutation tasks also assert final database state. Hints, solution exposure, assistance provenance and related-task durable evidence are distinct contracts rather than presentation-only labels.

### UX and state coverage

Desktop/mobile journeys cover account-first entry, onboarding, focused Practice, lessons, Today, Route, Review, assessment and analytics. Loading, empty, transient error, unauthorized, offline, slow response, quota, conflict and stale-client recovery have explicit copy or executable tests. Phase 14 additionally converts a raw Service Worker exception into a dismissible, non-blocking Russian notice that explicitly preserves online study.

### Edge cases and saved-state compatibility

Validators exercise empty and long SQL, Unicode, NULL, duplicates, ties, shape mismatches, large results, prohibited mutation, dated review scheduling, revision conflict and legacy payload migration. Server writes use revisioned compare-and-swap/reconciliation; invalid or older evidence fails closed rather than granting progress. Export/delete and account cascade paths remain separate from learning-state migration.

### Security and privacy

Auth sessions, exact allowed origins, headers, payload bounds, rate and neuron quotas, redaction, analytics allowlists, retention, export/delete, optional contact providers and feature flags are statically and operationally validated. AI is optional, consented and Socratic; it cannot award mastery. No raw SQL, tokens, exact timestamps or contact data enter shared course-health aggregates, and production provider flags remain fail-safe when disabled.

### Accessibility and responsive behavior

The changed product uses native buttons, radios, details and dialogs with accessible names, focus restoration and inert background regions. Desktop and Pixel 7/360 px browser gates assert keyboard navigation, 44 px targets, no horizontal overflow, reduced motion and zero serious/critical axe violations. Phase 14's PWA fallback remains a polite status and its close control is both reachable and pointer-interactive.

### Performance and PWA

Bundle enforcement locks entry, route, editor, query and transferred-resource budgets and contains an injected oversize negative fixture. Four cold production profiles (desktop/mobile, light/dark) block Service Workers to measure the network path, fail on console/page errors or overflow, and capture LCP, CLS, TBT, transfer and screenshots. The cached-old-worker smoke retains a pre-deploy browser profile and must prove a visible update with exactly one safe reload after release.

### Operations

The Windows-safe D1 scripts launch the installed Wrangler JavaScript entrypoint through the current Node executable, verify the exported SQL before use, prohibit production as a restore target and require an explicit confirmation phrase. Phase 14 exported production D1, verified required schema markers, restored 153 queries into a temporary non-production database and confirmed 28 tables. `docs/d1-backup-restore.md`, transfer runbooks and dry-run deployment document additive migration, rollback and provider-disable sequencing; the plaintext rehearsal artifacts are destroyed after final health proof.

### Diff and content review

The planning-baseline diff is scanned through the run-owned repository helper. Added-line checks reject stray debug-print calls, breakpoint statements and unresolved work markers; generated outputs, browser profiles, D1 identifiers and plaintext backups remain ignored. Task/source validators cover duplicate IDs, copied/proprietary provenance risk, learner-visible jargon and accidental schema drift.

### Regression sweep

The final matrix includes TypeScript and all deterministic validators, production build, enforced bundle budgets, all desktop/mobile Playwright projects, operations/deployment meta-contracts, Cloudflare dry deploy, PostgreSQL 14/MySQL 8 real-engine CI, production health/lifecycle smokes and live browser/PWA evidence. Exact-head CI, merge, Pages/Cloudflare deployment and default-branch equality are release-time requirements, not inferred from a local green build.

### Learner evidence

Four deterministic personas and item-health fixtures prove instrumentation, privacy, uncertainty labels and diagnostic behavior only. They do not prove teaching effectiveness. Consented Session A/B, delayed retention and transfer measurements remain the explicit external gate in `docs/human-learning-pilot.md` and GitHub issue #82; the platform is not described as having achieved the educational KPI until those results exist.

## Locked technical evidence

### Bundle and cold production trace

| Evidence | Locked result before Phase 14 publication | Gate |
| --- | ---: | --- |
| Main entry | 235.6 KiB raw / 72.6 KiB gzip | within entry budget |
| Product CSS | 234 KiB raw / 46.7 KiB gzip | within CSS budget |
| Desktop light | LCP 1020 ms, CLS 0, TBT 0, transfer 110 KiB | pass |
| Desktop dark | LCP 804 ms, CLS 0, TBT 0, transfer 110 KiB | pass |
| Mobile light | LCP 868 ms, CLS 0, TBT 0, transfer 110 KiB | pass |
| Mobile dark | LCP 816 ms, CLS 0, TBT 0, transfer 110 KiB | pass |

The same four-profile runner is repeated after deployment; its JSON/PNG artifacts and immutable run identifiers are attached to the Phase 14 release record in issue #82.

### Backup, restore and rollback

- Production export: 43,550 bytes; SHA-256 prefix `6d6b3395`; required `users`, `user_profiles`, `auth_sessions` and `progress` markers verified.
- Non-production rehearsal: 153 queries, 261 rows read, 447 rows written, 28 tables, all four required tables present.
- Restore safety: target name cannot equal production, confirmation is exact and mandatory, source SQL is hash/marker verified first.
- Release safety: additive migrations precede Worker activation; exact-head dry deploy and smoke run before acceptance; optional AI/contact provider flags can disable integrations without disabling the core course.
- Cleanup: the temporary remote rehearsal database, ignored Wrangler transfer config and plaintext local export/manifest are removed only after production health and release evidence are complete.

## Release and unresolved-risk register

| ID | Status | Risk / boundary | Required next evidence |
| --- | --- | --- | --- |
| R1 | External P1 gate | No consented Session A learner outcomes | run `docs/human-learning-pilot.md`, publish only aggregate allowed fields in #82 |
| R2 | External P2 gate | No delayed Session B retention/transfer cohort with `k >= 5` | repeat after the specified delay; suppress small cohorts |
| R3 | Workstation boundary | Docker is absent locally | exact-head Quality must run all 22 PostgreSQL/MySQL contracts and negative fixtures |
| R4 | Buyer operations | Durable backup custody and D1 Time Travel window belong to the deploying account | store an encrypted backup and record the current Cloudflare window during handoff |

Phase release chain before this reviewed tree: #185/#186/#187/#188/#189 (`391056f`), #190 (`36e6662`), #195 (`04155ae`), #196 (`c79641c`), #197/#198/#199/#200 (`81f6c13`), #201 (`b917bd2`), #202 (`4778c8d`), #203 (`1f46cd0`), #204 (`2a79fe6`), #205/#206 (`95504dd`), #207/#212 (`531d7a7`), #213 (`6e8cf54`), #214/#215 (`26035bb`). Phase 14's exact head/merge/deployment record is intentionally external and immutable in PR #216, its visual-evidence follow-up and issue #82.
