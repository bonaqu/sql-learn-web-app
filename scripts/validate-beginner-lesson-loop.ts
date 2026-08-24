import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import initSqlJs from 'sql.js';
import { beginnerLessonCycles, type BeginnerLessonCycle } from '../src/data/beginner-lesson-cycles';
import { curriculumLessons } from '../src/data/complete-curriculum';
import { foundationCorridorTaskIds } from '../src/data/foundation-evaluation-contracts';
import { tasks } from '../src/data/course-catalog';
import { evaluateTaskSql } from '../src/lib/task-evaluation-contract';

const expectedModules = ['sql-thinking', 'filtering', 'select'] as const;
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

function violations(cycle: Partial<BeginnerLessonCycle>) {
  const result: string[] = [];
  if (!cycle.objective || !cycle.successCriterion) result.push('measurable objective');
  if (!cycle.prediction?.prompt || cycle.prediction.options.length < 3 || cycle.prediction.correctIndex < 0) result.push('prediction');
  if (!cycle.prediction?.correctFeedback || !cycle.prediction.incorrectFeedback) result.push('prediction feedback');
  if (!cycle.workedExample?.sql || !cycle.workedExample.context || !cycle.workedExample.observation) result.push('worked example');
  if (!cycle.fadedPractice?.starterSql.includes('___') || !cycle.fadedPractice.evaluationTaskId) result.push('faded practice');
  if (!cycle.supportedTaskId || !cycle.independentTaskId || cycle.supportedTaskId === cycle.independentTaskId) result.push('practice handoff');
  if (!cycle.independentContext || /solution|эталон:\s*select/i.test(cycle.independentContext)) result.push('independent transfer');
  if (!cycle.misconception?.mismatch || !cycle.misconception.counterexample || !cycle.misconception.revisitSectionId) result.push('misconception remediation');
  if (!cycle.delayedReview) result.push('delayed review');
  if (!cycle.visualizations?.length) result.push('visualization');
  if (cycle.coveredTaskIds?.length !== 6) result.push('task coverage');
  return result;
}

const allCoveredTaskIds: string[] = [];
for (const moduleId of expectedModules) {
  const cycle = beginnerLessonCycles[moduleId];
  assert.ok(cycle, `${moduleId}: beginner cycle missing`);
  assert.deepEqual(violations(cycle), [], `${moduleId}: incomplete beginner cycle`);
  assert.equal(curriculumLessons.find(lesson => lesson.module === moduleId)?.beginnerCycle, cycle, `${moduleId}: cycle is not attached to lesson`);
  assert.ok(cycle.objective.length >= 55 && cycle.successCriterion.length >= 70, `${moduleId}: objective is not measurable enough`);
  assert.ok(cycle.workedExample.context !== cycle.independentContext, `${moduleId}: independent context repeats worked example`);
  const supportedTask = tasks.find(task => task.id === cycle.supportedTaskId && task.module === moduleId);
  const independentTask = tasks.find(task => task.id === cycle.independentTaskId && task.module === moduleId);
  const evaluationTask = tasks.find(task => task.id === cycle.fadedPractice.evaluationTaskId && task.module === moduleId);
  assert.ok(supportedTask, `${moduleId}: supported task invalid`);
  assert.ok(independentTask, `${moduleId}: independent task invalid`);
  assert.ok(evaluationTask?.evaluationContractId, `${moduleId}: faded practice needs a semantic evaluation contract`);
  assert.notEqual(evaluationTask?.id, supportedTask?.id, `${moduleId}: faded practice repeats the supported task`);
  assert.notEqual(evaluationTask?.id, independentTask?.id, `${moduleId}: faded practice leaks the independent task`);
  assert.notEqual(
    evaluationTask?.solution.toLowerCase().replace(/\s+/g, ' ').trim(),
    independentTask?.solution.toLowerCase().replace(/\s+/g, ' ').trim(),
    `${moduleId}: faded and independent solutions are identical`
  );
  const canonical = evaluateTaskSql(SQL, evaluationTask!, evaluationTask!.solution, 'practice');
  assert.equal(canonical.correct, true, `${moduleId}: faded canonical SQL fails its semantic contract`);
  assert.ok((canonical.evidence?.fixtureIds.length || 0) >= 3, `${moduleId}: faded practice lacks multi-fixture evidence`);
  assert.ok((canonical.evidence?.hiddenFixtureIds.length || 0) >= 2, `${moduleId}: faded practice lacks hidden/adversarial evidence`);
  const visibleCopy = JSON.stringify(cycle);
  assert.equal(forbiddenVisibleTerms.test(visibleCopy), false, `${moduleId}: learner copy exposes internal terminology`);
  allCoveredTaskIds.push(...cycle.coveredTaskIds);

  for (const field of ['prediction', 'workedExample', 'fadedPractice', 'misconception', 'delayedReview'] as const) {
    const mutation = { ...cycle, [field]: undefined } as Partial<BeginnerLessonCycle>;
    assert.ok(violations(mutation).length > 0, `${moduleId}: removing ${field} must break validation`);
  }
}

const semanticMutants: Record<(typeof expectedModules)[number], string> = {
  'sql-thinking': "SELECT 'ticket_id resolution_minutes from tickets';",
  filtering: 'SELECT ticket_id, resolution_minutes FROM tickets WHERE 1 = 0;',
  select: 'SELECT ticket_id, sla_minutes * 2 AS double_sla_minutes FROM tickets LIMIT 1;'
};
for (const moduleId of expectedModules) {
  const task = tasks.find(item => item.id === beginnerLessonCycles[moduleId].fadedPractice.evaluationTaskId)!;
  const result = evaluateTaskSql(SQL, task, semanticMutants[moduleId], 'practice');
  assert.equal(result.correct, false, `${moduleId}: plausible but semantically wrong faded SQL received a green result`);
  assert.ok(result.diagnostic, `${moduleId}: wrong faded SQL needs actionable diagnostic feedback`);
}

assert.deepEqual(new Set(allCoveredTaskIds), new Set(foundationCorridorTaskIds), 'Every foundation corridor task must appear exactly once in the editorial map');
assert.equal(allCoveredTaskIds.length, new Set(allCoveredTaskIds).size, 'Foundation task appears in more than one beginner cycle');
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
assert.doesNotMatch(portalSource, />Отметить раздел изученным<\/button>\s*}\s*<\/section>/, 'Foundation flow must not rely on article-completion clicks');
assert.match(cssSource, /@media \(max-width: 520px\)/, 'Phone layout missing');
assert.match(cssSource, /prefers-reduced-motion/, 'Reduced-motion support missing');
assert.match(cssSource, /min-height:\s*2\.75rem/, 'Touch targets smaller than 44px');

process.stdout.write(`Beginner lesson loop validated: ${expectedModules.length} lessons, ${allCoveredTaskIds.length} mapped tasks, 5 stage mutations per lesson.\n`);
