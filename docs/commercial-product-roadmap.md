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
- [x] Add staging/production environment guidance and guarded rollback/restore procedures.
- [ ] Add deterministic package locking and a dependency/license inventory.
- [x] Add explicit proprietary source-code licensing.
- [ ] Generate and verify complete third-party notices.

## Phase 3 — commercial operations

- [x] Add privacy-safe admin health endpoints hidden behind a feature flag and user-ID allowlist.
- [x] Add checksummed D1 export, independent verification and non-production restore rehearsal.
- [ ] Add complete incident, support and account-recovery runbooks.
- [ ] Add configurable retention beyond the current bounded feature policies.
- [x] Make support, privacy and terms links product-configurable.
- [x] Add scheduled public health probing and default-off Turnstile abuse protection.
- [ ] Complete buyer alert routing and independent operational acceptance.

## Phase 4 — dormant paid integrations

All integrations are default-off and fail closed on the current Cloudflare Free deployment.

- [x] Capability endpoint exposing only enabled/disabled states.
- [x] Turnstile Siteverify enforcement for public register/login/password-reset routes.
- [x] Provider-neutral private HTTPS delivery adapter for email and SMS challenges.
- [x] Privacy-safe contact challenge core: expiry, resend/rate limits, bounded attempts, HMAC verifiers and one-time signed tickets.
- [x] Atomically bind a verified email or phone ticket to account creation.
- [x] Atomically attach one verified contact per channel to an authenticated account using the current password.
- [x] Reset a password through an already bound verified contact and revoke every active session.
- [ ] Add passwordless contact login. This is not implied by verification or password reset and requires a separate threat model.
- [ ] Add buyer-specific provider deliverability, bounce/failure monitoring and acceptance tests.
- [ ] Add learner UI for enabled verified-contact registration, attachment and recovery while keeping it absent when disabled.

## Current verified-contact boundary

CR2B supplies challenge delivery and confirmation. CR2C adds backend account binding with durable one-time consumption receipts and transactional registration, attachment and password reset.

The existing username/password/recovery-code contract remains available and unchanged. Verified-contact routes stay hidden while their server capability is disabled or incomplete. No passwordless login or learner-facing verified-contact UI is claimed yet.

## Completion rule

A phase is complete only after:

- TypeScript and domain validators pass;
- production build and bundle budgets pass;
- desktop/mobile/axe journeys pass;
- Cloudflare Free dry-run remains valid;
- GitHub Pages and Cloudflare production both succeed after merge.

External legal review, independent penetration testing, real-provider deliverability and validation with paying learners are acceptance activities outside repository-only engineering evidence.
