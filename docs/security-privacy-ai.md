# Security, privacy and optional Socratic AI

Verified against the repository and current primary Cloudflare documentation on 2026-08-24.

## Boundary and threat model

| Asset / boundary | Main risk | Enforced control | Residual risk |
|---|---|---|---|
| App shell and API | XSS, framing, MIME confusion, referrer/device API leakage | Header-delivered CSP, `frame-ancestors 'none'`, `X-Frame-Options: DENY`, `nosniff`, `no-referrer`, restrictive Permissions Policy | `style-src 'unsafe-inline'` remains for Monaco/runtime component styles; scripts do not receive `unsafe-inline` or broad `unsafe-eval` |
| Bearer session | Cross-origin leak or persistent theft | Authorization attaches only to exact trusted origins; token lives in per-tab `sessionStorage`; only non-secret account metadata remains in `localStorage`; server sessions expire after 12 hours; logout, device revocation, password change and account deletion revoke server records | Any same-origin XSS running in the active tab can read the token; the strict CSP, self-hosted dependencies and short lifetime reduce, but cannot eliminate, that risk |
| Service worker | Cached private API data or stale security code | Workbox precaches static assets only; `/api/` is excluded from navigation fallback and API responses use `no-store`; prompt-based update and outdated-cache cleanup remain enabled | A previously installed worker can control one reload, so update behavior remains part of browser regression coverage |
| Remote AI context | SQL, questions or report text contain private or adversarial content | Mentor, Assessment Interviewer and Assessment Debrief share an explicit per-tab opt-in. SQL comments, quoted/dollar literals, long tokens and numeric literals are removed; common email, bearer, phone and secret patterns are redacted. Prompt data is a JSON object inside a named untrusted-data envelope; sizes, output and time are bounded | Table/column identifiers can still be private. The UI tells learners exactly what is sent and permits immediate revocation |
| Assessment debrief | A full report could expose identity, SQL or authored prose | The provider receives only scores, measurement bands, assistance counters and bounded taxonomy fields. User ID, SQL, local debrief, task titles/descriptions and free-form interview prose are omitted | Aggregate learning measurements can still reveal a learner's performance profile, so consent remains mandatory |
| Logs and analytics | Raw SQL or secrets persist indefinitely | AI endpoints never log request bodies or provider payloads; pipeline logs contain only request ID, route and error class (never exception text); analytics schemas reject unknown/free-text/SQL fields | Cloudflare platform metadata still records normal request telemetry according to the account configuration |
| AI authority | Hallucinated output changes mastery | Every AI response contains `masteryAwarded: false` and has no evidence mutation path. Strict per-purpose validation rejects full SQL, control characters, oversized output and false authority claims; deterministic local evaluation and local debrief remain authoritative | A learner can still choose to follow a wrong suggestion, so source and verification state stay visible |

Cloudflare Worker-generated API responses use the same header policy in `worker/http-security.ts`; static app assets use `public/_headers`, the [documented Workers Static Assets header mechanism](https://developers.cloudflare.com/workers/static-assets/headers/). The duplicated policies are checked together to prevent drift.

## Shared atomic Free-tier budget

The old assessment KV read-modify-write counter was not a strict concurrency boundary. Mentor, Interviewer and Debrief now all reserve from the two D1 rows created by migration `0024_mentor_ai_quota.sql`: `global` and `profile:<id>`. One conditional `UPDATE ... RETURNING` changes both rows only when both limits fit. D1 `batch()` creates the rows and performs that update as a transaction; failed quota predicates modify neither counter. There is no separate assessment allowance that can race or bypass the application limit.

The reservation is deliberately conservative:

- model: `@cf/meta/llama-3.2-1b-instruct`;
- reservation: 20 neurons per remote request across all three surfaces;
- learner budget: 400 neurons, or 20 requests/day;
- application budget: 8,000 neurons, or 400 requests/day;
- 20% of the current 10,000-neuron free allocation remains outside the application reservation;
- worst case is under 2,000 D1 row writes/day including quota rows and their primary-key records.

Cloudflare currently documents [10,000 Neurons per day](https://developers.cloudflare.com/workers-ai/platform/pricing/) in the shared free allocation, reset at 00:00 UTC. The selected model is documented at 2,457 neurons per million input tokens and 18,252 per million output tokens. D1 currently documents [5 million rows read and 100,000 rows written per day](https://developers.cloudflare.com/d1/platform/pricing/) on Workers Free. Cloudflare documents `D1Database.batch()` as transactional and sequential in the [D1 Worker API](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch).

The quota reserves a fixed worst-case allowance before calling the provider. Timeout, malformed output and provider failure therefore cannot overrun the application budget, though a failed inference can consume a reservation.

## Socratic and failure contract

Without informed opt-in, with `AI_MENTOR_ENABLED=off`, without an AI binding, after quota exhaustion, on timeout, provider error, prompt injection or malformed/full-solution output, every AI surface returns or retains a deterministic local answer. `AI_MENTOR_ENABLED` is the application-wide emergency switch despite its legacy name. No assessment endpoint can call the provider while it is off.

The Mentor three-step ladder is:

1. one question about the expected result;
2. one conceptual direction and a single edit;
3. bounded diagnostics without the finished query.

The UI always labels either `Cloudflare Workers AI` or a local response. Assessment consent is unchecked by default, stored only in the current tab and can be revoked immediately; without it, Interviewer runs locally and Debrief keeps the already-visible local report. Remote responses never alter progress. Any generated SQL is labelled unverified because the Worker does not execute arbitrary model output.

Emergency rollback is configuration-only: set `AI_MENTOR_ENABLED=off` and redeploy. Core lessons, SQLite evaluation, local interviewer, local debrief, diagnostics and progress continue without Workers AI.
