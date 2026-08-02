import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { tasks } from '../src/data/course-catalog';
import { curriculumCheckpoints, curriculumLessons } from '../src/data/complete-curriculum';
import { lessonTransitions, moduleBridgePairs, transitionIntoLesson, transitionOutOfLesson } from '../src/data/lesson-bridges';
import { canonicalModuleIds, phaseDefinitions, phaseForModule } from '../src/data/learning-structure';

assert.equal(moduleBridgePairs.length, canonicalModuleIds.length - 1);
assert.equal(lessonTransitions.length, curriculumLessons.length - 1);
assert.equal(new Set(lessonTransitions.map(item => item.id)).size, lessonTransitions.length);

for (let index = 0; index < lessonTransitions.length; index += 1) {
  const transition = lessonTransitions[index];
  const from = curriculumLessons[index];
  const to = curriculumLessons[index + 1];
  const minimumNarrativeLength = transition.kind === 'within-module' ? 45 : 70;

  assert.equal(transition.fromLessonId, from.id);
  assert.equal(transition.toLessonId, to.id);
  assert.equal(transitionIntoLesson(to.id)?.id, transition.id);
  assert.equal(transitionOutOfLesson(from.id)?.id, transition.id);
  assert.ok(transition.carryForward.length >= minimumNarrativeLength);
  assert.ok(transition.limitation.length >= minimumNarrativeLength);
  assert.ok(transition.newMentalModel.length >= minimumNarrativeLength);
  assert.ok(transition.evidencePrompt.length >= minimumNarrativeLength);

  if (from.module === to.module) {
    assert.equal(transition.kind, 'within-module');
    assert.equal(transition.checkpointId, null);
  } else {
    assert.equal(canonicalModuleIds.indexOf(to.module), canonicalModuleIds.indexOf(from.module) + 1);
    const fromPhase = phaseForModule(from.module);
    const toPhase = phaseForModule(to.module);
    const boundary = fromPhase?.id !== toPhase?.id;
    assert.equal(transition.kind, boundary ? 'phase' : 'module');
    if (boundary) {
      const checkpoint = curriculumCheckpoints.find(item => item.id === transition.checkpointId);
      assert.ok(checkpoint);
      assert.ok(checkpoint?.moduleIds.some(moduleId => fromPhase?.moduleIds.some(id => id === moduleId)));
    } else {
      assert.equal(transition.checkpointId, null);
    }
  }

  const practice = tasks.find(task => task.id === transition.practiceTaskId);
  assert.ok(practice);
  assert.equal(practice?.module, to.module);
  assert.ok(practice?.mode === 'lesson' || practice?.mode === 'practice');
}

const phaseTransitions = lessonTransitions.filter(item => item.kind === 'phase');
assert.equal(phaseTransitions.length, phaseDefinitions.length - 1);
assert.equal(transitionIntoLesson(curriculumLessons[0].id), null);
assert.equal(transitionOutOfLesson(curriculumLessons.at(-1)?.id || ''), null);

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
