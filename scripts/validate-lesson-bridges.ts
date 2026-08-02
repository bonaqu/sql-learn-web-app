import assert from 'node:assert/strict';
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

  assert.equal(transition.fromLessonId, from.id);
  assert.equal(transition.toLessonId, to.id);
  assert.equal(transitionIntoLesson(to.id)?.id, transition.id);
  assert.equal(transitionOutOfLesson(from.id)?.id, transition.id);
  assert.ok(transition.carryForward.length >= 70);
  assert.ok(transition.limitation.length >= 70);
  assert.ok(transition.newMentalModel.length >= 70);
  assert.ok(transition.evidencePrompt.length >= 70);

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

console.log(`Lesson bridges validated: ${lessonTransitions.length} lesson transitions, ${moduleBridgePairs.length} module bridges and ${phaseTransitions.length} phase boundaries.`);
