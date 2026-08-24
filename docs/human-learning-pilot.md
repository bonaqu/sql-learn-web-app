# Consented human-learning pilot protocol

## Status and ownership

Status: **NOT STARTED — EXTERNAL ACCEPTANCE GATE**.

No consenting participant results exist in this repository. Automated personas verify product contracts only; they cannot establish retention, transfer, clarity or educational efficacy. The product owner must coordinate recruitment, consent and observation before anyone changes this status.

Owner coordination record: `PENDING`. Result files may be attached under `docs/evidence/pilot/` only after the consent checklist is complete. Do not commit names, contact details, recordings, raw SQL, employer data or screen captures containing private data.

Turnkey owner materials are in `docs/human-learning-pilot-field-kit.md`. Start from `docs/human-learning-pilot-report.template.json`, then validate the reviewed aggregate with `npm run validate:pilot-evidence -- <file>`. The validator checks structure and privacy-safe arithmetic; it cannot authenticate consent or replace owner review.

## Participant bands

Target 12–20 consenting adults, with no coercive employment relationship to the observer:

- 4–6 zero/practically-zero SQL learners;
- 4–6 partial learners who completed a basic course but lack independent transfer confidence;
- 2–4 role-focused learners from support/analytics/backend/data engineering;
- 2–4 returning learners tested after a 7–14 day delay.

This is a formative product pilot, not a statistically powered claim. Results must retain denominators and uncertainty; no subgroup under five is published.

## Consent boundary

Before the first task, the participant receives a plain-language notice covering purpose, duration, collected observations, optional analytics, withdrawal, deletion and compensation. Consent must be affirmative and revocable. Declining analytics does not block product use or compensation.

Observers may record task outcome, assistance level, bounded misconception family, next-step clarity and coarse friction. They must not record learner SQL, result rows, credentials, contact data, employer/client data, free-form private notes, camera/audio or screen recording. Think-aloud is optional; the participant may stop it without leaving the pilot.

## Sessions and tasks

### Session A — first use (45–60 minutes)

1. Understand the account-first value proposition and privacy explanation.
2. Complete or defer placement.
3. Follow the recommended lesson/task without observer navigation help.
4. Solve one independent task after fading.
5. Solve one unseen related transfer task.
6. Explain the next recommended step in the participant’s own words.

### Session B — delayed retrieval (15–25 minutes, 7–14 days later)

1. Return without reviewing the prior solution.
2. Follow the Today recommendation.
3. Complete one related-but-non-identical retrieval task.
4. Complete one role-relevant transfer task when prerequisite-safe.
5. Export/delete analytics if requested and confirm the result.

## Outcome definitions

- **Independent task success:** executable semantic contract passes without hint, solution or observer help.
- **Delayed retention:** due related-but-non-identical task passes independently in Session B.
- **Transfer:** unseen context/fixture passes independently; repeating the same query is not transfer.
- **Next-step clarity:** participant can identify the next action and why it is next without observer prompting.
- **Friction/abandonment:** task stopped, navigation loop, unrecoverable error or more than five minutes without a comprehensible next action.
- **Assistance dependence:** hint/solution/observer help occurs before the successful result; the eventual result is not relabeled independent.

## Formative thresholds

These thresholds trigger investigation; they do not prove efficacy:

- at least 70% independent success on the first prerequisite-safe task, with denominator shown;
- at least 60% delayed retention among participants who return for Session B;
- at least 60% independent transfer among prerequisite-eligible participants;
- at least 80% next-step clarity;
- less than 20% abandonment attributable to product friction;
- no P0 privacy/data-loss/accessibility incident.

Every proportion must include `n`, numerator and a 90% Wilson interval. Missing follow-up is reported separately, never counted as retained or failed without explanation.

## Observation procedure

1. Use a disposable pilot account and a clean browser profile.
2. Record only coded participant band and consent receipt ID stored outside the repository.
3. Let the participant act; intervene only for safety, hard product failure or after the declared stall threshold.
4. Mark every hint, solution and observer intervention before outcome scoring.
5. Run the deletion flow when requested and verify the account/session lifecycle.
6. Enter an aggregate row in the evidence register; destroy temporary observer notes according to the consent notice.

## Stop and rollback rules

Stop the session immediately for privacy leakage, credential exposure, data loss, distress, inaccessible blocking UI or a participant withdrawal. Stop the whole pilot and roll back the affected release for any P0, repeated account-state corruption, incorrect independent-pass attribution, or serious/critical accessibility blocker. Pause recruitment for a P1 affecting two participants until triaged. P2 copy/friction findings may continue only when the participant can proceed safely.

## Issue template

- ID / priority: `P0|P1|P2`
- Evidence: cohort, `n`, numerator, interval, journey/task contract, release SHA
- Expected / observed
- Assistance provenance
- Privacy-safe reproduction (no SQL/private literals)
- Plausible interpretation and alternative
- Duplicate search links
- Acceptance criteria (at least two verifiable bullets)
- Rollback/stop relevance
- Owner and status

## Completion rule

The educational KPI and full-goal claim remain open until valid consent, Session A evidence and delayed Session B evidence are attached. A green build, synthetic personas or `n < 5` course-health slice cannot close this gate.
