# Coherent goal-aware SQL journey contract

SQL Academy must present one explainable learning frontier across onboarding, Today, Curriculum Studio, Practice, Review, Interview, Puzzle, checkpoints, assessments and projects.

The source catalog may remain physically stable for editing, search and deterministic IDs. The learner route must not infer readiness from that array position. It is computed from prerequisites, evidence, checkpoint state, remediation and the selected goal.

## Shared beginner foundation

A learner with no executable evidence starts from the same foundation for every goal:

1. SQL thinking;
2. `SELECT`;
3. filtering;
4. sorting;
5. aggregates;
6. grouping.

Self-reported experience cannot skip this foundation. A diagnostic may bypass only a **contiguous prerequisite-safe prefix** of the selected route. Once the first missing or uncertain module is encountered, later strong scores do not bypass the gap.

Uncertainty defaults downward. A learner is never advanced merely because a career goal or self-report sounds advanced.

## Goal-aware module frontier

After the shared foundation, `support`, `analyst`, `backend`, `interview` and `full` act as transparent priority profiles over modules whose prerequisites are already complete.

The goal may:

- choose between multiple currently eligible modules;
- change which eligible branch is recommended first;
- change future week-plan emphasis and learner-facing rationale.

The goal may not:

- open a module with missing prerequisites;
- skip a ready checkpoint;
- bypass active checkpoint remediation;
- use Interview or Puzzle as first exposure;
- remove required expert outcomes or capstones;
- invalidate evidence already earned when the goal changes.

The route is a deterministic topological ordering. A prerequisite cycle or deadlock is a build failure, not a reason to fall back silently to physical catalog order.

## Within-module progression

For every module, the default development ladder is:

1. **Lesson** — mental model, runnable example and knowledge check.
2. **Guided task** — a task in `lesson` mode where hints are acceptable.
3. **Independent practice** — `practice` tasks completed without hints or the reference solution.
4. **Retrieval review** — delayed recall for weak or due tasks.
5. **Checkpoint** — executable evidence that the phase can be used under mixed conditions.
6. **Interview** — explanation and solution under time/ambiguity pressure.
7. **Puzzle** — transfer to a less familiar formulation.
8. **Assessment / project** — broader retained and applied evidence.

A module may omit a stage when it has no matching artifact, but a later available stage must never become the primary recommendation while an earlier stage is incomplete.

## Frontier priority

The unified selector applies this priority:

1. due retrieval review;
2. targeted repair from the latest failed completed checkpoint attempt;
3. explicit retry of that checkpoint after every targeted weak task has fresh independent evidence;
4. another ready but unpassed phase checkpoint;
5. Interview/Puzzle transfer opened by a passed checkpoint;
6. the selected goal's highest-priority eligible foundation module;
7. prerequisite recovery when evidence is incomplete or contradictory;
8. final assessment;
9. capstone project;
10. completed-route maintenance.

Checkpoint failure temporarily outranks career specialization. Changing goal may reorder later eligible work, but it must not change the active remediation action for identical evidence.

An unrelated due retrieval item may remain above checkpoint remediation according to the existing spaced-repetition policy. The learner-facing explanation must make both obligations visible rather than silently hiding the failed checkpoint.

## Failed checkpoint remediation

A completed failed report creates a temporary remediation state owned by its checkpoint phase.

- Only valid reports for the current learner are considered.
- `expired`, `abandoned`, cross-user and unknown checkpoint/module/task data are ignored.
- The **latest completed attempt** controls pass or fail state. A later failure reactivates remediation even after an older pass; a later pass clears it.
- Historical `bestScore` may remain visible for reporting, but it cannot override a later failed attempt for routing, eligibility or phase completion.
- Remediation modules are intersected with checkpoint membership, deduplicated and ordered by lowest module score, then canonical route order.
- Every weak module receives a deterministic discriminating Practice task and a separate Interview/Puzzle transfer task; neither may be a task from the failed checkpoint.
- The Practice step counts only with new independent evidence after the failed report timestamp. Transfer counts only with independent evidence later than that Practice evidence, so a pre-solved or out-of-order task cannot repair the module.
- Placement or diagnostic bypass is ignored for a module explicitly contradicted by the failed checkpoint.
- Completing remediation does not mark the checkpoint passed. It only unlocks an explicit checkpoint retry.
- Transfer, specialization and later checkpoints remain closed until a real later attempt passes.

Raw checkpoint report fields are interpreted only in the evidence/remediation domain. Today, Learning Path, goal preview and Workspace consume normalized remediation state or frontier metadata; React components must not sort attempts, inspect `moduleScores`/`taskScores`, or infer pass state independently.

## Evidence rules

- Merely opening or completing lesson text is not applied mastery.
- Guided completion does not count as independent evidence.
- Interview and Puzzle never introduce unseen syntax.
- A phase checkpoint becomes the primary step only after every foundation module in that phase is complete.
- A passed checkpoint opens transfer for that phase, not unrelated advanced modules.
- Assessment and project evidence complement, rather than replace, missing fundamentals.
- Diagnostic bypass is accepted only as a contiguous prerequisite-safe prefix.
- Goal changes affect future selection only; completed evidence remains valid.
- Latest checkpoint attempt controls current pass/fail state; best historical score is reporting evidence only.

## One frontier across product surfaces

The same frontier snapshot must provide:

- goal;
- ordered route module IDs;
- completed module IDs;
- currently eligible module IDs;
- safely bypassed diagnostic prefix;
- passed phase IDs;
- active checkpoint remediation, if any;
- next action;
- a machine-readable reason code and learner-facing explanation.

It drives:

- the main **Today** recommendation and failed-checkpoint banner;
- the first-week onboarding plan;
- lesson → guided → independent continuation;
- Practice execution gates;
- Interview/Puzzle opening;
- checkpoint remediation and retry priority;
- goal-switch preview;
- post-success navigation;
- cross-device resume.

Adaptive Learning Path and evidence-graph recommendations must consume the same frontier contract or an explicit projection of it. They must not calculate a conflicting next module from raw array indexes or raw checkpoint reports.

## Workspace behavior

The full catalog remains browseable, but execution is capability-gated by the frontier:

- completed modules are repeatable;
- the current module follows its lesson/task stage;
- another prerequisite-complete module is visible as **eligible but later by goal**;
- a module with missing prerequisites remains preview-only;
- transfer is runnable only after its phase checkpoint;
- active remediation keeps the weak task or checkpoint retry executable while later transfer remains preview-only;
- route completion opens free expert practice.

Physical phase position, `moduleOrderIndex`, `earlierPhase` and `laterPhase` are not readiness evidence.

## First-week plan

The onboarding plan is generated from the selected goal route after the same safe diagnostic prefix. Beginners and deferred-placement learners start from the shared foundation. A truly advanced diagnostic resumes at the first unproven module and may reveal different analyst/backend/support priorities.

The week still includes review and sustainable pacing; personalization does not mean seven unrelated new topics.

## Regression definition

A change is a route regression when any primary surface:

- uses `tasks.find(...)` or physical array order as its recommendation;
- opens a module with missing prerequisites;
- skips a ready checkpoint for a goal-preferred module;
- allows an older pass or best score to override a later failed checkpoint;
- opens Interview/Puzzle before checkpoint evidence;
- accepts a non-contiguous diagnostic bypass;
- produces a different next action from the shared frontier for the same evidence;
- parses raw checkpoint `moduleScores`, `taskScores` or attempt ordering in UI code;
- hides why the step is next.

All five goals, failed→discriminate→transfer→retry→pass transitions, beginner and advanced placement bands, workspace gates and desktop/mobile resume must be validated on one exact head before merge.
