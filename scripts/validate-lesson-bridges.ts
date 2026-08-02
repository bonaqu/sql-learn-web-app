import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { tasks } from '../src/data/course-catalog';
import { curriculumCheckpoints, curriculumLessons } from '../src/data/complete-curriculum';
import { lessonTransitions, moduleBridgePairs, transitionIntoLesson, transitionOutOfLesson } from '../src/data/lesson-bridges';
import { canonicalModuleIds, phaseDefinitions, phaseForModule } from '../src/data/learning-structure';

assert.equal(moduleBridgePairs.length, canonicalModuleIds.length - 1, 'Every adjacent module pair needs a bridge');
assert.equal(lessonTransitions.length, curriculumLessons.length - 1, 'Every adjacent lesson pair needs a transition');
assert.equal(new Set(lessonTransitions.map(item => item.id)).size, lessonTransitions.length, 'Transition ids must be unique');

for (let index = 0; index < lessonTransitions.length; index += 1) {
  const transition = lessonTransitions[index];
  const from = curriculumLessons[index];
  const to = curriculumLessons[index + 1];

  assert.equal(transition.fromLessonId, from.id, `${transition.id} starts outside canonical lesson order`);
  assert.equal(transition.toLessonId, to.id, `${transition.id} ends outside canonical lesson order`);
  assert.equal(transitionIntoLesson(to.id)?.id, transition.id, `${transition.id} is missing from incoming lookup`);
  assert.equal(transitionOutOfLesson(from.id)?.id, transition.id, `${transition.id} is missing from outgoing lookup`);

  const narrative = {
    carryForward: transition.carryForward,
    limitation: transition.limitation,
    newMentalModel: transition.newMentalModel,
    evidencePrompt: transition.evidencePrompt
  };
  const fieldMinimums = transition.kind === 'within-module'
    ? { carryForward: 35, limitation: 40, newMentalModel: 30, evidencePrompt: 55 }
    : { carryForward: 70, limitation: 70, newMentalModel: 70, evidencePrompt: 70 };

  for (const [field, value] of Object.entries(narrative)) {
    const minimum = fieldMinimums[field as keyof typeof fieldMinimums];
    assert.ok(value.length >= minimum, `${transition.id} ${field} has ${value.length} chars; minimum is ${minimum}`);
  }
  if (transition.kind === 'within-module') {
    const totalLength = Object.values(narrative).reduce((sum, value) => sum + value.length, 0);
    assert.ok(totalLength >= 220, `${transition.id} intra-module narrative totals ${totalLength} chars; minimum is 220`);
  }

  if (from.module === to.module) {
    assert.equal(transition.kind, 'within-module', `${transition.id} must be an intra-module transition`);
    assert.equal(transition.checkpointId, null, `${transition.id} cannot introduce a checkpoint inside one module`);
  } else {
    assert.equal(canonicalModuleIds.indexOf(to.module), canonicalModuleIds.indexOf(from.module) + 1, `${transition.id} skips canonical module order`);
    const fromPhase = phaseForModule(from.module);
    const toPhase = phaseForModule(to.module);
    const boundary = fromPhase?.id !== toPhase?.id;
    assert.equal(transition.kind, boundary ? 'phase' : 'module', `${transition.id} has the wrong transition kind`);
    if (boundary) {
      const checkpoint = curriculumCheckpoints.find(item => item.id === transition.checkpointId);
      assert.ok(checkpoint, `${transition.id} crosses a phase without a real checkpoint`);
      assert.ok(checkpoint?.moduleIds.some(moduleId => fromPhase?.moduleIds.some(id => id === moduleId)), `${transition.id} checkpoint does not cover the completed phase`);
    } else {
      assert.equal(transition.checkpointId, null, `${transition.id} adds a checkpoint before the phase is complete`);
    }
  }

  const practice = tasks.find(task => task.id === transition.practiceTaskId);
  assert.ok(practice, `${transition.id} references an unknown destination practice`);
  assert.equal(practice?.module, to.module, `${transition.id} practice belongs to the wrong module`);
  assert.ok(practice?.mode === 'lesson' || practice?.mode === 'practice', `${transition.id} introduces a module through Interview or Puzzle`);
}

const phaseTransitions = lessonTransitions.filter(item => item.kind === 'phase');
assert.equal(phaseTransitions.length, phaseDefinitions.length - 1, 'Every phase boundary needs exactly one transition');
assert.equal(transitionIntoLesson(curriculumLessons[0].id), null, 'The first lesson must remain the zero-prerequisite entry');
assert.equal(transitionOutOfLesson(curriculumLessons.at(-1)?.id || ''), null, 'The final lesson must end the lesson chain');

const panel = readFileSync(new URL('../src/components/LessonContinuityPanel.tsx', import.meta.url), 'utf8');
const companion = readFileSync(new URL('../src/components/CurriculumContinuityCompanion.tsx', import.meta.url), 'utf8');
const deferred = readFileSync(new URL('../src/components/DeferredFeaturePortals.tsx', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../src/lesson-continuity.css', import.meta.url), 'utf8');
const browser = readFileSync(new URL('../tests/e2e/lesson-continuity.spec.ts', import.meta.url), 'utf8');

assert.ok(companion.includes('createPortal'), 'Continuity companion must remain inside the Curriculum Studio modal tree');
assert.ok(companion.includes('[data-testid="curriculum-studio"]'), 'Continuity companion lost its accessible portal target');
assert.ok(deferred.includes("lazy(() => import('./CurriculumContinuityCompanion'))"), 'Continuity companion is no longer lazy');
assert.ok(panel.includes("checkpoint ? <button"), 'Phase checkpoint is not the exclusive forward branch');
assert.ok(panel.includes("<CourseCompletionPanel />"), 'The final lesson no longer returns to the canonical evidence plan');
assert.ok(styles.includes('bottom: calc(76px + env(safe-area-inset-bottom))'), 'Mobile companion can overlap primary navigation');
assert.ok(browser.includes("getByRole('button', { name: /Перейти к уроку/i })).toHaveCount(0)"), 'Browser coverage no longer proves phase side doors are absent');
assert.ok(browser.includes("studio.getByTestId('curriculum-continuity-companion')"), 'Browser coverage no longer proves modal containment');

console.log(`Lesson bridges validated: ${lessonTransitions.length} lesson transitions, ${moduleBridgePairs.length} module bridges and ${phaseTransitions.length} phase boundaries with lazy accessible continuity UI.`);
