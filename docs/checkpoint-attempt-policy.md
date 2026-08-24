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

The Worker returns the bounded 50-report cloud page in the same order:

```sql
ORDER BY completed_at DESC, attempt_number DESC, id DESC
```

This ordering matters before the limit is applied. Two devices must receive the same bounded candidate set even when several attempts share a completion timestamp. The client still validates and reorders the returned payload through the canonical comparator rather than trusting server response order as pass evidence.

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

## Migration and integrity boundary

Task history migrated from older progress formats remains visible in `progress.completed` and task statistics, but it is not checkpoint evidence. There is no inferred checkpoint pass from a task checkbox, an assisted pass, an independent task pass or a completed checkpoint task bank item.

Only the current immutable completed checkpoint report can satisfy a checkpoint gate. When a migrated learner has no such report, the UI preserves their task history and asks for a new checkpoint attempt. This fail-closed rule avoids silently granting mastery when old progress has no provenance proving that a controlled checkpoint session happened.

## Cross-device contract

Saving reports to D1 must preserve their owner, report ID, checkpoint ID, completion timestamp, attempt number, score, historical best and pass flag. A second authenticated browser with no local checkpoint history must reconstruct the same:

- current attempt;
- current pass count;
- historical best;
- remediation or next-checkpoint gate.

Local/cloud merge is deterministic regardless of which reports were already present locally or in what order the server returned them.

## Ownership boundary

Raw report validation, owner filtering, date parsing and current-attempt ordering live only in `checkpoint-attempt-policy.ts`.

- remediation consumes the canonical snapshot;
- Journey evidence consumes the canonical snapshot;
- `checkpoints.ts` uses current state for pass and eligibility;
- skill evidence and complete readiness use current state for completion;
- React surfaces consume snapshot projections and never sort reports to infer pass state.

A regression exists when any surface uses `bestCheckpointReport`, `bestScore`, `history.filter(report => report.passed)` or a local `completedAt` sort to decide whether a checkpoint is currently passed.
