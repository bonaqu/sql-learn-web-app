# Commercial Product Roadmap

This document tracks the work required to turn SQL Academy from a technically rich production MVP into a transferable commercial product.

## Product principle

The learner should never need to understand the internal architecture of the academy. After authentication, the product must answer three questions in order:

1. What outcome do I want?
2. What should I do today?
3. What happens after I finish this step?

Advanced tools remain available, but they do not compete with the primary learning journey.

## Phase 1 — guided learner experience

Completed in the guided learner journey delivered by PR #83.

- [x] Automatically open the goal / schedule / placement setup for a new account.
- [x] Replace the feature-directory home screen with a “Today” screen and one primary action.
- [x] Reduce permanent navigation to Today, My plan, Learn, Practice and Review.
- [x] Move catalog, interview, exams, checkpoints, projects, dialects, achievements, mentor and analytics under one “All tools” disclosure.
- [x] Keep all existing deep features accessible and preserve keyboard/mobile accessibility.
- [x] Add regression tests for first-run and returning-user journeys.

## Phase 2 — transferable product package

- [x] Replace hard-coded owner/domain branding and API origins with environment-driven product configuration.
- [x] Add a clean-install deployment runbook for a buyer-owned GitHub and Cloudflare account.
- [ ] Add staging/production environment guidance and rollback/restore procedures.
- [ ] Add deterministic package locking and a dependency/license inventory.
- [ ] Add explicit source-code licensing and third-party notices.

## Phase 3 — commercial operations

- [ ] Add privacy-safe admin health endpoints and a minimal operator dashboard.
- [ ] Add backup/export and restore verification for D1 data.
- [ ] Add incident, support and account-recovery runbooks.
- [ ] Add configurable retention, support contacts and legal-page links.
- [ ] Add load/abuse gates and production alert guidance.

## Phase 4 — dormant paid integrations

All integrations are default-off and fail closed on the current Cloudflare Free deployment.

- [x] Capability endpoint exposing only enabled/disabled states.
- [ ] Turnstile verification adapter.
- [ ] Email delivery adapter and verified-email auth flow.
- [ ] SMS delivery adapter and verified-phone auth flow.
- [ ] Buyer activation guide, secret matrix and provider-specific tests.
- [ ] Hidden UI until the buyer explicitly enables a complete provider configuration.

## Completion rule

A phase is complete only after:

- TypeScript and domain validators pass;
- production build and bundle budgets pass;
- desktop/mobile/axe journeys pass;
- Cloudflare Free dry-run remains valid;
- GitHub Pages and Cloudflare production both succeed after merge.
