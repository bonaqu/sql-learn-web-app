import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { modules as coreModules, tasks as rawCoreTasks } from '../src/data/course';
import { applyCoreTaskProgression } from '../src/data/core-task-progression';
import { applyFoundationCorridorOverrides } from '../src/data/foundation-corridor';
import { tasks } from '../src/data/course-catalog';
import { stripSqlCommentsAndLiterals } from '../src/data/sql-syntax-frontier';
import type { SqlTask } from '../src/data/course-catalog';

const coreModuleIds = new Set(coreModules.map(([id]) => id));
const baseline = new Map(applyCoreTaskProgression(applyFoundationCorridorOverrides(rawCoreTasks)).map(task => [task.id, task]));

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

for (const task of tasks.filter(item => coreModuleIds.has(item.module))) {
  const expected = baseline.get(task.id);
  assert.ok(expected, `${task.id}: missing core baseline task contract`);
  assert.deepEqual(invariantContract(task), invariantContract(expected!), `${task.id}: core transfer framing changed identity, SQL, XP, difficulty or guide`);

  const transfer = task.mode === 'interview' || task.mode === 'puzzle';
  if (!transfer) {
    assert.deepEqual(task, expected, `${task.id}: core foundation task was rewritten by transfer framing`);
    continue;
  }

  assert.equal(stripSqlCommentsAndLiterals(task.starter).trim(), '', `${task.id}: core transfer task still exposes executable SQL scaffold`);
  assert.equal(task.hints.length, 3, `${task.id}: core transfer task needs three progressive hints`);
  assert.notEqual(task.description, expected?.description, `${task.id}: core transfer prompt did not change`);
  assert.notEqual(task.starter, expected?.starter, `${task.id}: core transfer scaffold did not change`);
  assert.equal(task.solution, expected?.solution, `${task.id}: core transfer solution changed`);

  if (task.mode === 'interview') {
    interviewCount += 1;
    assert.ok(task.title.startsWith('Interview · '), `${task.id}: Interview title is not explicit`);
    for (const marker of ['одна строка', 'условие', 'контрольным запросом']) {
      assert.ok(task.description.toLowerCase().includes(marker), `${task.id}: Interview description is missing ${marker}`);
    }
    assert.ok(task.hints[0].includes('Одна строка:'), `${task.id}: Interview hint 1 must define grain`);
    assert.ok(task.hints[1].includes('Главное условие:'), `${task.id}: Interview hint 2 must preserve a condition`);
    assert.ok(task.hints[2].includes('Контроль:'), `${task.id}: Interview hint 3 must define a check`);
  } else {
    puzzleCount += 1;
    assert.ok(task.title.startsWith('Puzzle · '), `${task.id}: Puzzle title is not explicit`);
    for (const marker of ['инвариант', 'edge case', 'стабильного вывода']) {
      assert.ok(task.description.toLowerCase().includes(marker), `${task.id}: Puzzle description is missing ${marker}`);
    }
    assert.ok(task.hints[0].includes('Инвариант:'), `${task.id}: Puzzle hint 1 must identify the invariant`);
    assert.ok(task.hints[1].includes('Edge case:'), `${task.id}: Puzzle hint 2 must identify an edge case`);
    assert.ok(task.hints[2].includes('Стабильность:'), `${task.id}: Puzzle hint 3 must require stable output`);
  }
}

assert.equal(interviewCount, coreModules.length, 'Core track must contain one Interview task per module');
assert.equal(puzzleCount, coreModules.length, 'Core track must contain one Puzzle task per module');

for (const [moduleId] of coreModules) {
  const moduleTasks = tasks.filter(task => task.module === moduleId);
  assert.equal(moduleTasks.filter(task => task.mode === 'interview').length, 1, `${moduleId}: core Interview count drifted`);
  assert.equal(moduleTasks.filter(task => task.mode === 'puzzle').length, 1, `${moduleId}: core Puzzle count drifted`);
}

const appSource = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
assert.ok(appSource.includes('visibleHints === 0 && !solutionViewedThisSession'), 'Independent evidence no longer rejects hint or reference use');
assert.ok(appSource.includes("task.mode === 'interview'"), 'Interview workspace routing disappeared');
assert.ok(appSource.includes("task.mode === 'puzzle'"), 'Puzzle workspace routing disappeared');

console.log(`Core transfer contracts validated: ${interviewCount} Interview and ${puzzleCount} Puzzle tasks with beginner reasoning prompts, blank SQL scaffolds and unchanged solution identity.`);
