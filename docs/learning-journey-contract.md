# Coherent SQL journey contract

SQL Academy must present one consistent learning route across Curriculum Studio, Practice, Review, Interview, Puzzle, checkpoints, assessments and projects.

## Canonical progression

For every module, the default development ladder is:

1. **Lesson** — mental model, runnable example and knowledge check.
2. **Guided task** — a task in `lesson` mode where hints are acceptable.
3. **Independent practice** — `practice` tasks completed without hints or the reference solution.
4. **Retrieval review** — delayed recall for weak or due tasks.
5. **Checkpoint** — executable evidence that the phase can be used under mixed conditions.
6. **Interview** — explanation and solution under time/ambiguity pressure.
7. **Puzzle** — transfer to a less familiar formulation.
8. **Assessment / project** — broader retained and applied evidence.

A module may omit a stage when it has no matching artifact, but later stages must never become the default recommendation while an earlier available stage is still incomplete.

## Ordering rules

- Phase and module order comes from `phaseDefinitions`.
- Lesson order comes from `curriculumLessons` inside each module.
- Task order is stable by mode (`lesson`, `practice`, `interview`, `puzzle`), difficulty and source position.
- Curriculum prerequisites must point to modules earlier in the canonical route or to explicit diagnostic bypass evidence.
- A recommendation may return to review at any point when retrieval is due.
- The learner may browse the full catalog, but the primary route must explain why a step is recommended and what it unlocks.

## Evidence rules

- Merely opening or completing lesson text is not equivalent to applied mastery.
- Guided completion does not count as independent evidence.
- Interview and puzzle work must not be the first exposure to a concept.
- A phase checkpoint is recommended only after its modules have enough lesson/practice evidence.
- Assessment and project evidence complement, rather than replace, missing fundamentals unless an explicit diagnostic bypass threshold is met.

## Product surfaces

The same journey selector must drive:

- the main “Сегодня” recommendation;
- `buildDailySession` in Adaptive Learning Path;
- module recommendations in the evidence graph;
- connected next/previous task navigation;
- mode labels and locked-stage explanations;
- curriculum links to practice and the next module.

Any surface that uses raw `tasks.find(...)`, physical array order or an unrelated mode filter as its primary recommendation is considered a regression.
