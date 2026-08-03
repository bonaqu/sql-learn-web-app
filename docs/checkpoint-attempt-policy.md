# Checkpoint current-attempt policy

Checkpoint evidence has two different meanings that must never be conflated:

- **current attempt state** answers whether the learner is currently allowed to progress;
- **historical best** records the highest verified score the learner has ever achieved.

## Canonical snapshot

All completed checkpoint reports are normalized by `checkpoint-attempt-policy.ts`.

A report participates only when it:

- belongs to the expected learner;
- has `version: 1`;
- has status `completed`;
- references a known checkpoint;
- has a valid completion timestamp and stable report ID.

For each checkpoint, the current attempt is selected deterministically by:

1. latest `completedAt`;
2. highest `attemptNumber` when timestamps are equal;
3. lexicographically highest report ID when both are equal.

The same comparator orders local storage and merged local/cloud histories. Input order and sync partition must not change the snapshot.

## Current state

The current attempt controls:

- checkpoint pass/fail;
- eligibility for the next checkpoint;
- transfer access;
- phase completion;
- module checkpoint evidence;
- Learning Path checkpoint counts;
- complete readiness;
- certificate eligibility;
- failed-checkpoint remediation.

An older pass followed by a newer fail means the checkpoint is currently failed. The older pass remains historical evidence but cannot open any gate.

A newer passing attempt restores current pass state immediately.

## Historical best

Historical best is the maximum verified `score` or persisted `bestScore` among valid completed attempts for the checkpoint.

It may be shown in:

- checkpoint history;
- reports;
- progress analytics;
- coaching context.

It must not satisfy a current pass gate, increase current checkpoint completion, or preserve a certificate after a later failed attempt.

Checkpoint Center displays both values explicitly:

- `Текущая попытка #N: score`;
- `Исторический максимум: best`.

## Legacy fallback

Legacy task completion may infer a checkpoint pass only when there is no valid completed attempt for that checkpoint.

Once any valid completed report exists:

- its current pass/fail state is authoritative;
- legacy task completion cannot override a failure;
- expired and abandoned sessions do not count as completed attempts and therefore do not suppress fallback by themselves.

## Ownership boundary

Raw report validation, owner filtering, date parsing and current-attempt ordering live only in `checkpoint-attempt-policy.ts`.

- remediation consumes the canonical snapshot;
- Journey evidence consumes the canonical snapshot;
- `checkpoints.ts` uses current state for pass and eligibility;
- skill evidence and complete readiness use current state for completion;
- React surfaces consume snapshot projections and never sort reports to infer pass state.

A regression exists when any surface uses `bestCheckpointReport`, `bestScore`, `history.filter(report => report.passed)` or a local `completedAt` sort to decide whether a checkpoint is currently passed.
