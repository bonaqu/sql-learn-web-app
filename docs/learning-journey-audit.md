# Learning journey audit

## Confirmed fragmentation before this change

1. The Today page selected `tasks.find(...)` from a focus module or from the physical catalog order. It did not know whether the relevant lesson, independent practice or phase checkpoint had been completed.
2. Adaptive daily sessions selected the globally lowest mastery among unlocked modules. A later untouched module could therefore outrank the active beginner module simply because zero is numerically lower.
3. The second module was effectively unlocked without evidence, and later modules needed only one completed task in the preceding module.
4. Curriculum lessons, task catalog and phase definitions were assembled in separate files without one canonical ordering source.
5. Practice, Interview and Puzzle were filters over task mode, not explicit stages in one development ladder.
6. A completed task could satisfy navigation even when the successful attempt used hints or a revealed solution.
7. Future first-week plan rows displayed completion icons although the plan did not store completion evidence.

## Remediation in this slice

- canonical phase/module/mode/difficulty ordering shared by curriculum and task catalog;
- unified journey selector aware of lesson completion, independent task evidence, checkpoints, assessments and projects;
- Today page driven by the selector and live evidence events;
- stronger sequential module unlock and canonical adaptive-session focus;
- Interview/Puzzle treated as transfer stages after foundation and checkpoint evidence;
- cross-surface navigation for lesson, task, checkpoint, assessment and project actions;
- mandatory journey validator covering ordering, prerequisites, guided-vs-independent evidence and the beginner entry point.

## Follow-up audit targets

- expose stage readiness and lock reasons directly inside Practice / Interview / Puzzle lists;
- add explicit next-step controls after a successful task rather than returning to a generic list;
- align onboarding week-plan execution with the same selector beyond the first-week copy;
- evaluate whether every module has enough mode diversity and whether some Expert tasks need prerequisite corrections;
- add real browser coverage for transitions lesson → task → checkpoint → transfer;
- review lesson prose and examples for conceptual continuity after structural sequencing is green.
