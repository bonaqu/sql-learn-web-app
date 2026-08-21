# Calm, accessible, fast learning UX

Phase 12 turns the default shell into a smaller first visit and keeps advanced depth behind explicit actions. This document is the measurable UX/performance contract; `scripts/performance-budgets.ts` is its executable source of truth.

## First-visit decision

The product keeps an authenticated onramp instead of adding a guest progress mode.

- A guest task would require a second progress identity, migration and conflict policy before the first account sync. That duplicates the state model and creates a credible risk of losing or mixing attempts and verified results.
- The first viewport now states the value before asking for credentials: 240 checked tasks, 44 connected lessons, adaptive review and local SQLite.
- It also gives the concrete reason for the account, says the platform is free and cardless, and makes clear that email is optional.
- The authenticated Academy, curriculum catalog and progress engine are not downloaded for a guest. The onramp therefore remains transparent without charging first-time visitors for the whole application.

This choice changes no stored schema, authentication policy or learner evidence. A future guest mode requires an explicit migration/conflict design, not a client-only shortcut.

## Interaction contract

- Primary touch targets are at least **44 × 44 CSS px** at the 320 px and 360 px checks.
- Closed mobile navigation has `aria-hidden="true"` and `inert`; the page behind an open drawer is inert. Escape closes the drawer and focus returns to the opener.
- Practice initially exposes 12 frontier/nearby tasks (24 while filtering). The full catalog remains reachable through a named disclosure.
- Route shows one primary `Начать сессию` action. AI planning and goal switching live in `Настройки маршрута`; locked phases cannot expand.
- Lesson explanation and examples remain in a collapsed native `details`; the runnable SQL action stays visible.
- Custom single-choice groups use `radiogroup`/`radio`, `aria-checked`, roving `tabindex`, and Arrow/Home/End selection based on the focused option.

Automated coverage checks keyboard focus, dialog return, accessible state, 44 px targets, no page overflow, reduced motion and zero serious/critical axe findings. Tables and Monaco keep their own deliberate internal overflow rather than widening the page.

## Measured baseline and result

Measurements use a built Vite preview, Chromium, disabled Service Worker for cold first-visit samples, three comparable runs and the median. TBT is the sum of the portions of observed long tasks over 50 ms. Action timing covers trigger-to-ready UI. Resource entries retain the request waterfall and decoded cost.

| Journey | Baseline | Phase 12 result | Enforced budget |
|---|---:|---:|---:|
| Guest first visit transfer | 271.4 KiB | 108.9 KiB | 180 KiB |
| Guest first visit decoded | 1,012.5 KiB | 374.1 KiB | 600 KiB |
| Guest first visit LCP | 444 ms | 408 ms median (396/408/424) | 2,000 ms |
| Guest first visit CLS / TBT | no observed long task | 0 / 0 ms | 0.1 / 200 ms |
| Authenticated Today | — | LCP 884 ms; CLS 0.0009; TBT 0 ms | 2,500 ms / 0.1 / 400 ms |
| Route open | — | 498 ms; TBT 0 ms | 2,000 ms / 300 ms |
| Practice + Monaco + SQLite | — | 572 ms; TBT 20 ms | 6,000 ms / 1,000 ms |
| First SQL query | — | 149 ms; TBT 7 ms | 1,500 ms / 300 ms |

The main entry changed from 454.05 KiB raw / 135.26 KiB gzip to 240.32 KiB raw / 74.86 KiB gzip. First-visit transfer fell by about 60%.

## Root causes and lazy boundaries

| Bottleneck | Root cause | Change | Guard |
|---|---|---|---|
| Guest downloaded the Academy | `App`, agents and course modules were below the auth gate in the static graph | `AuthenticatedAcademy` is a post-auth lazy boundary | Guest waterfall forbids that chunk |
| Auth pulled the course catalog | progress XP lookup imported all tasks | deterministic task-XP contract plus dynamic progress sync | Guest waterfall forbids catalog/progress |
| Heavy editor/runtime risk | Monaco and SQL WASM are large by design | retain action-only lazy loading; no preload | Today waterfall forbids Monaco/WASM; Practice waits for readiness |
| Regression budgets were generous | entry allowed 460/155 KiB | entry is limited to 300/95 KiB; a negative fixture injects 80 KiB | `validate:bundle` must fail the injected fixture |
| Browser budgets were prose only | no shared numeric contract | exported journey budgets plus +1 rejection validator | `validate:performance-budgets` runs inside `validate:bundle` |

INP needs field interaction traffic and is therefore not invented from a lab run. The automated lab reports TBT and explicit interaction completion times; production telemetry may add INP only under the existing privacy/consent contract.

## PWA update proof

`scripts/pwa-first-reload-smoke.mjs` uses a persistent Chromium profile. `seed` stores the current production controller, cache name, Worker SHA-256 and hashed entry. After deployment, `verify` requires the first navigation to remain on that old entry, waits for the real Workbox update prompt, confirms the update, then requires exactly one reload, a different entry hash and a different Worker hash.

The UI additionally prevents immediate update while an assessment or dirty editor state exists. Offline status and local SQLite remain covered by the production-build browser matrix.
