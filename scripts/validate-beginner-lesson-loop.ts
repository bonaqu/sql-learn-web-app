import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import initSqlJs from 'sql.js';
import { beginnerLessonCycles, type BeginnerLessonCycle } from '../src/data/beginner-lesson-cycles';
import { curriculumLessons } from '../src/data/complete-curriculum';
import { tasks } from '../src/data/course-catalog';
import { evaluateTaskSql } from '../src/lib/task-evaluation-contract';

const forbiddenVisibleTerms = /\b(mastery|frontier|foundation|evidence|placement|independent|guided|preview|mental model)\b/i;
const require = createRequire(import.meta.url);
const wasmPath = require.resolve('sql.js/dist/sql-wasm.wasm');
const SQL = await initSqlJs({ locateFile: () => wasmPath });

const noviceJourneySources = [
  '../src/App.tsx',
  '../src/components/AuthGate.tsx',
  '../src/components/CapabilityAuthScreen.tsx',
  '../src/components/BeginnerLessonLoop.tsx',
  '../src/components/CurriculumPortal.tsx',
  '../src/components/ConceptCheckPanel.tsx',
  '../src/components/LessonMasteryPanel.tsx'
] as const;

function learnerCopyLeaks(source: string) {
  const candidates: string[] = [];
  for (const line of source.split(/\r?\n/)) {
    for (const match of line.matchAll(/(['"`])((?:\\.|(?!\1).)*)\1/g)) {
      candidates.push(match[2].replace(/\$\{[^{}]+\}/g, '').replace(/\$\{.*$/, ''));
    }
    for (const match of line.matchAll(/>([^<>{}]*)</g)) candidates.push(match[1]);
  }
  return candidates.filter(copy => forbiddenVisibleTerms.test(copy) && (/[А-Яа-яЁё]/.test(copy) || copy.includes('✓') || /mental model\s*:/i.test(copy)));
}

function violations(cycle: Partial<BeginnerLessonCycle>, expectedCoverage: number) {
  const result: string[] = [];
  if (!cycle.objective || !cycle.successCriterion) result.push('measurable objective');
  if (!cycle.prediction?.prompt || cycle.prediction.options.length < 3 || cycle.prediction.correctIndex < 0) result.push('prediction');
  if (!cycle.prediction?.correctFeedback || !cycle.prediction.incorrectFeedback) result.push('prediction feedback');
  if (!cycle.workedExample?.sql || !cycle.workedExample.context || !cycle.workedExample.observation) result.push('worked example');
  if (!cycle.fadedPractice?.starterSql.includes('___') || !cycle.fadedPractice.evaluationTaskId) result.push('faded practice');
  if (!cycle.supportedTaskId || !cycle.independentTaskId || cycle.supportedTaskId === cycle.independentTaskId) result.push('practice handoff');
  if (!cycle.independentContext || /\bsolution\b|эталон:\s*select/i.test(cycle.independentContext)) result.push('independent transfer');
  if (!cycle.misconception?.mismatch || !cycle.misconception.counterexample || !cycle.misconception.revisitSectionId) result.push('misconception remediation');
  if (!cycle.delayedReview) result.push('delayed review');
  if (!cycle.visualizations?.length) result.push('visualization');
  if (cycle.coveredTaskIds?.length !== expectedCoverage) result.push('task coverage');
  return result;
}

assert.equal(curriculumLessons.length, 44, 'Complete curriculum must contain 44 lessons');
assert.equal(Object.keys(beginnerLessonCycles).length, 3, 'Three opening lessons must retain their hand-authored cycles');

const allCoveredTaskIds: string[] = [];
for (const lesson of curriculumLessons) {
  const cycle = lesson.beginnerCycle;
  assert.ok(cycle, `${lesson.id}: lesson cycle missing`);
  assert.deepEqual(violations(cycle, lesson.practiceTaskIds.length), [], `${lesson.id}: incomplete lesson cycle`);
  assert.equal(cycle.module, lesson.module, `${lesson.id}: cycle attached to the wrong module`);
  assert.deepEqual(cycle.coveredTaskIds, lesson.practiceTaskIds, `${lesson.id}: cycle does not cover its authored task block`);
  assert.ok(cycle.objective.length >= 55 && cycle.successCriterion.length >= 70, `${lesson.id}: objective is not measurable enough`);
  assert.ok(cycle.workedExample.context !== cycle.independentContext, `${lesson.id}: independent context repeats worked example`);
  assert.ok(lesson.sections.some(section => section.id === cycle.misconception.revisitSectionId), `${lesson.id}: remediation target is outside the lesson`);

  const supportedTask = tasks.find(task => task.id === cycle.supportedTaskId && task.module === lesson.module);
  const independentTask = tasks.find(task => task.id === cycle.independentTaskId && task.module === lesson.module);
  const evaluationTask = tasks.find(task => task.id === cycle.fadedPractice.evaluationTaskId && task.module === lesson.module);
  assert.ok(supportedTask, `${lesson.id}: supported task invalid`);
  assert.ok(independentTask, `${lesson.id}: independent task invalid`);
  assert.ok(evaluationTask, `${lesson.id}: faded practice task invalid`);
  assert.equal(supportedTask.mode, 'lesson', `${lesson.id}: supported handoff must start from a lesson-mode task`);
  assert.equal(evaluationTask.mode, 'practice', `${lesson.id}: faded practice must use a practice-mode task`);
  assert.equal(independentTask.mode, 'puzzle', `${lesson.id}: independent transfer must use a puzzle-mode task`);
  assert.notEqual(evaluationTask.id, supportedTask.id, `${lesson.id}: faded practice repeats the supported task`);
  assert.notEqual(evaluationTask.id, independentTask.id, `${lesson.id}: faded practice leaks the independent task`);
  assert.notEqual(
    cycle.fadedPractice.starterSql.toLowerCase().replace(/\s+/g, ' ').trim(),
    evaluationTask.solution.toLowerCase().replace(/\s+/g, ' ').trim(),
    `${lesson.id}: faded practice exposes the full canonical solution`
  );
  assert.notEqual(
    evaluationTask.solution.toLowerCase().replace(/\s+/g, ' ').trim(),
    independentTask.solution.toLowerCase().replace(/\s+/g, ' ').trim(),
    `${lesson.id}: faded and independent solutions are identical`
  );

  const canonical = evaluateTaskSql(SQL, evaluationTask, evaluationTask.solution, 'practice');
  assert.equal(canonical.correct, true, `${lesson.id}: faded canonical SQL fails its semantic evaluator`);
  if (evaluationTask.evaluationContractId) {
    assert.ok((canonical.evidence?.fixtureIds.length || 0) >= 3, `${lesson.id}: faded practice lacks multi-fixture evidence`);
    assert.ok((canonical.evidence?.hiddenFixtureIds.length || 0) >= 2, `${lesson.id}: faded practice lacks hidden/adversarial evidence`);
  } else {
    assert.equal(evaluationTask.evaluationPolicy, 'disposable-script', `${lesson.id}: advanced faded practice needs an isolated disposable evaluator`);
    assert.equal(canonical.evidence, null, `${lesson.id}: disposable comparison must not claim hidden-fixture evidence`);
  }

  const mutant = evaluateTaskSql(SQL, evaluationTask, 'SELECT 1 AS incorrect_lesson_result;', 'practice');
  assert.equal(mutant.correct, false, `${lesson.id}: semantically wrong faded SQL received a green result`);
  assert.ok(mutant.diagnostic, `${lesson.id}: wrong faded SQL needs actionable diagnostic feedback`);

  const orchestrationCopy = [
    cycle.objective,
    cycle.successCriterion,
    cycle.prediction.correctFeedback,
    cycle.prediction.incorrectFeedback,
    cycle.fadedPractice.successFeedback,
    cycle.fadedPractice.retryFeedback,
    cycle.misconception.mismatch,
    cycle.delayedReview
  ].join(' ');
  assert.equal(forbiddenVisibleTerms.test(orchestrationCopy), false, `${lesson.id}: lesson-cycle glue copy exposes internal terminology`);
  allCoveredTaskIds.push(...cycle.coveredTaskIds);

  for (const field of ['prediction', 'workedExample', 'fadedPractice', 'misconception', 'delayedReview'] as const) {
    const mutation = { ...cycle, [field]: undefined } as Partial<BeginnerLessonCycle>;
    assert.ok(violations(mutation, lesson.practiceTaskIds.length).length > 0, `${lesson.id}: removing ${field} must break validation`);
  }
}

assert.deepEqual(new Set(allCoveredTaskIds), new Set(tasks.map(task => task.id)), 'Every course task must appear in exactly one lesson-cycle editorial block');
assert.equal(allCoveredTaskIds.length, tasks.length, 'Lesson-cycle editorial map has missing or extra task references');
assert.equal(allCoveredTaskIds.length, new Set(allCoveredTaskIds).size, 'A task appears in more than one lesson cycle');
for (const task of tasks) {
  assert.equal(forbiddenVisibleTerms.test(task.title), false, `${task.id}: task list title exposes internal terminology`);
}

const loopSource = readFileSync(new URL('../src/components/BeginnerLessonLoop.tsx', import.meta.url), 'utf8');
const portalSource = readFileSync(new URL('../src/components/CurriculumPortal.tsx', import.meta.url), 'utf8');
const conceptSource = readFileSync(new URL('../src/components/ConceptCheckPanel.tsx', import.meta.url), 'utf8');
const cssSource = readFileSync(new URL('../src/styles-curriculum.css', import.meta.url), 'utf8');

for (const sourcePath of noviceJourneySources) {
  const source = readFileSync(new URL(sourcePath, import.meta.url), 'utf8');
  assert.deepEqual(learnerCopyLeaks(source), [], `${sourcePath}: Russian learner copy exposes internal terminology`);
}

assert.match(loopSource, /worked-example-locked/, 'Worked SQL must stay hidden until prediction');
assert.match(loopSource, /workedCompleted && <article className="beginner-loop-card faded"/, 'Faded practice must stay locked until the worked example runs');
assert.match(loopSource, /fadedFeedback\?\.correct \? <article className="beginner-transfer"/, 'Independent transfer must stay locked until semantic faded-practice success');
assert.match(loopSource, /onStageComplete\(lesson\.sections\[0\]\.id\)/, 'Prediction must produce progress evidence');
assert.match(loopSource, /onStageComplete\(lesson\.sections\[1\]\.id\)/, 'Worked example must produce progress evidence');
assert.match(loopSource, /onStageComplete\(lesson\.sections\[2\]\.id\)/, 'Faded practice must produce progress evidence');
assert.match(loopSource, /<fieldset>/, 'Prediction requires semantic fieldset');
assert.match(loopSource, /<caption>/, 'Visual tables require captions');
assert.match(loopSource, /aria-live="polite"/, 'Dynamic feedback requires live status');
assert.match(loopSource, /initSqlJs/, 'Lesson loop must use shared local SQLite runtime');
assert.match(loopSource, /evaluateTaskSql/, 'Faded practice must use the shared semantic evaluator');
assert.doesNotMatch(loopSource, /requiredFragments/, 'Faded practice must not fall back to SQL substring checks');
assert.doesNotMatch(loopSource + portalSource + conceptSource, /https:\/\/sql\.js\.org/, 'Lesson flow must not fetch SQLite WASM from the network');
assert.ok(curriculumLessons.every(lesson => lesson.beginnerCycle), 'Manual article-completion fallback must be unreachable in the complete curriculum');
assert.match(cssSource, /@media \(max-width: 520px\)/, 'Phone layout missing');
assert.match(cssSource, /prefers-reduced-motion/, 'Reduced-motion support missing');
assert.match(cssSource, /min-height:\s*2\.75rem/, 'Touch targets smaller than 44px');

process.stdout.write(`Complete lesson loop validated: ${curriculumLessons.length}/44 lessons, ${allCoveredTaskIds.length}/${tasks.length} mapped tasks, 5 stage mutations and one semantic mutant per lesson.\n`);
