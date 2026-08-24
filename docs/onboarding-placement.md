# Learner Onboarding and Placement Contract

## Purpose

The onboarding flow does not ask a learner to choose a difficulty and then trust that answer. It separates three inputs:

1. **Goal** changes the examples, route emphasis and explanation context.
2. **Schedule** defines a sustainable weekly contract.
3. **Executable placement** supplies evidence about current SQL skill.

Self-report is useful for tone and pacing, but it never unlocks advanced content, changes certificate requirements or creates mastery evidence.

## Placement policy

Placement uses the completed `diagnostic` assessment report with the latest `completedAt` timestamp. Expired or abandoned attempts are ignored.

Overall levels:

- `0–41`: foundation;
- `42–64`: developing;
- `65–81`: working;
- `82–100`: advanced.

A requested specialist track is recommended only when the overall diagnostic score is at least 65. A lower score always starts from `fundamentals`, regardless of self-reported experience.

Module evidence remains independent from the global placement score:

- score `>=80` becomes a strong-module signal;
- score `<70` may enter the initial focus list;
- lesson prerequisites still use module mastery, completed lessons, executable checkpoints and diagnostic module evidence from the common readiness policy.

Placement does not mass-unlock modules.

## Deferring placement

A learner may explicitly defer placement. The platform then:

- records `placement.status = deferred`;
- recommends `fundamentals`;
- builds a conservative first-week plan;
- preserves the option to run placement later;
- does not reset task, lesson, checkpoint, assessment or review evidence.

## Weekly contract

The learner selects:

- 15, 25 or 40 minutes per study day;
- at least two days per week;
- gentle, steady or intensive pacing.

The first-week plan uses only selected days. Each session has one primary outcome: placement, orientation, lesson, independent practice or retrieval review.

Recovery rule:

> Do not double the next session after a missed day. Move only one next step; when review debt exists, replace a new topic with review.

This prevents punishment loops and unrealistic catch-up plans.

## Persistence and conflict handling

Local profile key:

`sql-academy-onboarding-v1:<userId>`

Cloud endpoint:

`GET/PUT /api/onboarding/profile`

Contract header:

`x-onboarding-contract: onboarding-v1`

D1 stores a versioned JSON payload with optimistic revision. Conflicts are resolved deterministically using `updatedAt`; if timestamps are equal, the richer serialized profile wins. Offline edits remain local and retry on onboarding changes or reconnect.

The profile contains learning preferences and assessment references only. It does not contain employer data, work SQL, email content or production database identifiers.

## Re-placement

Re-placement:

- keeps the last completed placement valid while the retake is in progress; a learner without completed evidence is marked `pending`;
- opens the existing Diagnostic SQL Check;
- preserves all prior educational evidence;
- selects the next blueprint-equivalent v4 form instead of repeating the known task set;
- recalculates the recommended route from the newest completed diagnostic;
- rebuilds the first-week plan only after the learner accepts the result.

## Quality contract

The deterministic validator must cover:

- safe profile sanitization;
- placement thresholds;
- latest-completed report selection;
- four non-overlapping blueprint-equivalent retake forms and stale-autosave isolation;
- self-report not bypassing weak executable evidence;
- strong/focus module selection;
- defer behavior;
- selected-day and minute preservation;
- recovery rule;
- conflict resolution;
- onboarding readiness conditions.

Browser coverage must verify the wizard, Diagnostic handoff, result return, cross-device hydration and mobile overflow. Production smoke must verify D1 revisions, invalid payload rejection, conflict response and account cascade cleanup.
