import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { applyAdvancedAuthoredCatalogOverrides } from '../src/data/advanced-authored-catalog';
import { advancedModules, advancedTasks } from '../src/data/advanced-syllabus';
import { applyAdvancedTaskProgression } from '../src/data/advanced-task-progression';
import { tasks } from '../src/data/course-catalog';
import { applySyntaxFrontierTaskOverrides } from '../src/data/syntax-frontier-content';
import { stripSqlCommentsAndLiterals } from '../src/data/sql-syntax-frontier';
import type { SqlTask } from '../src/data/course-catalog';

const advancedModuleIds = new Set(advancedModules.map(([id]) => id));
const baseline = new Map(
  applyAdvancedTaskProgression(
    applySyntaxFrontierTaskOverrides(
      applyAdvancedAuthoredCatalogOverrides(advancedTasks)
    )
  ).map(task => [task.id, task])
);

function invariantContract(task: SqlTask) {
  return {
    id: task.id,
    module: task.module,
    topic: task.topic,
    difficulty: task.difficulty,
    mode: task.mode,
    xp: task.xp,
    solution: task.solution,
    guide: task.guide
  };
}

let interviewCount = 0;
let puzzleCount = 0;

for (const task of tasks.filter(item => advancedModuleIds.has(item.module))) {
  const expected = baseline.get(task.id);
  assert.ok(expected, `${task.id}: missing advanced baseline task contract`);
  assert.deepEqual(invariantContract(task), invariantContract(expected!), `${task.id}: transfer framing changed identity, SQL, XP, difficulty or guide`);

  const transfer = task.mode === 'interview' || task.mode === 'puzzle';
  if (!transfer) {
    assert.deepEqual(task, expected, `${task.id}: advanced non-transfer task was rewritten by transfer framing`);
    continue;
  }

  assert.equal(stripSqlCommentsAndLiterals(task.starter).trim(), '', `${task.id}: transfer task still exposes executable SQL scaffold`);
  assert.ok(task.starter.includes('--'), `${task.id}: transfer starter must contain a reasoning checklist`);
  assert.equal(task.hints.length, 3, `${task.id}: transfer task needs exactly three progressive reasoning hints`);
  assert.notEqual(task.description, expected?.description, `${task.id}: transfer prompt did not change`);
  assert.notEqual(task.starter, expected?.starter, `${task.id}: transfer scaffold did not change`);
  assert.equal(task.solution, expected?.solution, `${task.id}: transfer solution contract changed`);

  if (task.mode === 'interview') {
    interviewCount += 1;
    assert.ok(task.title.startsWith('Interview · '), `${task.id}: Interview title is not explicit`);
    for (const marker of ['гранулярность', 'failure mode', 'verification query']) {
      assert.ok(task.description.toLowerCase().includes(marker), `${task.id}: Interview description is missing ${marker}`);
    }
    assert.ok(task.hints[0].includes('Гранулярность:'), `${task.id}: Interview hint 1 must define result grain`);
    assert.ok(task.hints[1].includes('Failure mode:'), `${task.id}: Interview hint 2 must address failure mode`);
    assert.ok(task.hints[2].includes('Verification:'), `${task.id}: Interview hint 3 must define evidence`);
  } else {
    puzzleCount += 1;
    assert.ok(task.title.startsWith('Puzzle · '), `${task.id}: Puzzle title is not explicit`);
    for (const marker of ['инвариант', 'непривычную', 'edge case']) {
      assert.ok(task.description.toLowerCase().includes(marker), `${task.id}: Puzzle description is missing ${marker}`);
    }
    assert.ok(task.hints[0].includes('Инвариант:'), `${task.id}: Puzzle hint 1 must identify the transferable invariant`);
    assert.ok(task.hints[1].includes('Edge case:'), `${task.id}: Puzzle hint 2 must address an edge case`);
    assert.ok(task.hints[2].includes('Самопроверка:'), `${task.id}: Puzzle hint 3 must request a counterexample`);
  }
}

assert.equal(interviewCount, advancedModules.length * 2, 'Advanced track must contain two Interview tasks per module');
assert.equal(puzzleCount, advancedModules.length * 2, 'Advanced track must contain two Puzzle tasks per module');

for (const [moduleId] of advancedModules) {
  const moduleTasks = tasks.filter(task => task.module === moduleId);
  assert.equal(moduleTasks.filter(task => task.mode === 'interview').length, 2, `${moduleId}: Interview transfer count drifted`);
  assert.equal(moduleTasks.filter(task => task.mode === 'puzzle').length, 2, `${moduleId}: Puzzle transfer count drifted`);
}

const appSource = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
assert.ok(appSource.includes('visibleHints === 0 && !solutionViewedThisSession'), 'Independent evidence no longer rejects hint or solution use');
assert.ok(appSource.includes("task.mode === 'interview'"), 'Interview tasks are not routed to their dedicated workspace');
assert.ok(appSource.includes("task.mode === 'puzzle'"), 'Puzzle tasks are not routed to their dedicated workspace');
assert.ok(appSource.includes("view === 'interview'"), 'Interview workspace filter disappeared');
assert.ok(appSource.includes("view === 'puzzle'"), 'Puzzle workspace filter disappeared');

console.log(`Advanced transfer contracts validated: ${interviewCount} Interview and ${puzzleCount} Puzzle tasks with blank SQL scaffolds, explicit reasoning prompts and unchanged solution identity.`);
