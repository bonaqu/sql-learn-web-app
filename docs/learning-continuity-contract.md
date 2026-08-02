# Learning continuity contract

SQL Academy treats the course as one evidence-backed progression, not as independent portals or a flat task catalogue.

## Canonical progression

A learner advances through:

1. mental model and lesson knowledge checks;
2. guided SQL application;
3. independent practice without hints or a viewed reference;
4. the checkpoint for the completed phase;
5. Interview and Puzzle transfer tasks;
6. final assessment;
7. capstone evidence.

Today, Adaptive Learning Path, Curriculum Studio and the SQL workspace must resolve the same canonical frontier.

## Every adjacent lesson needs a transition

`src/data/lesson-bridges.ts` owns the transition between every two adjacent lessons. A transition must explain four different things:

- **carryForward** — the exact model or invariant retained from the previous lesson;
- **limitation** — a concrete question, failure mode or scale boundary the previous model cannot solve;
- **newMentalModel** — the new abstraction introduced by the destination lesson;
- **evidencePrompt** — the observable work that proves the learner can make the transition.

Do not replace these fields with generic prose such as “continue learning”, “the next topic is harder” or a paraphrase of the lesson title.

## Module and phase boundaries

An adjacent module transition must follow `canonicalModuleIds`. A module cannot be inserted only by appending tasks or lessons.

When a transition crosses a phase boundary:

- the previous phase checkpoint is mandatory;
- the continuity UI exposes the checkpoint as the only forward action;
- destination practice and the next lesson may be described as the goal, but are not direct side doors;
- Interview and Puzzle never introduce the new module.

## Evidence rules

Reading a card is not mastery. A valid transition points to a destination lesson and an applied task, but course advancement continues to use the shared evidence policy:

- all required lesson sections and knowledge checks;
- independent SQL evidence where required;
- completed checkpoint reports at phase boundaries;
- assessment and immutable capstone reports at the end of the course.

Guided success may prepare a learner, but it cannot replace independent evidence.

## Curriculum Studio UI

`CurriculumContinuityCompanion` is lazy-loaded only with Curriculum Studio. It is portalled inside the modal DOM tree so keyboard focus, screen-reader isolation and escape behavior remain correct.

The companion is collapsed by default. When expanded, it shows:

- what the learner carries from the previous lesson;
- why that model is no longer sufficient;
- the new model introduced now;
- the evidence required for the next transition.

On mobile it stays above the primary bottom navigation and uses a bounded scroll region.

## Adding or reordering content

A content change is incomplete until all of the following are updated:

1. canonical module and lesson order;
2. the incoming and outgoing transition narratives;
3. destination practice ownership;
4. checkpoint mapping if a phase boundary moves;
5. validator expectations and browser coverage.

Run:

```bash
npm run validate:lesson-bridges
npm run check
npm run build
npm run test:e2e
```

The validator rejects gaps, reordered modules, shallow narratives, unknown tasks, Interview/Puzzle introductions, missing phase checkpoints, non-lazy UI wiring and accessibility regressions in the companion architecture.
