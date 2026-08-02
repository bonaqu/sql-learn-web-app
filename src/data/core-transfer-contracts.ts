import { modules as coreModules } from './course';
import type { SqlTask } from './course';

const coreModuleIds = new Set<string>(coreModules.map(([id]) => id));

function baseTitle(task: SqlTask) {
  return task.title.replace(/^(?:Interview|Puzzle)\s*[·:]\s*/i, '').trim();
}

function interviewTask(task: SqlTask): SqlTask {
  return {
    ...task,
    title: `Interview · ${baseTitle(task)}`,
    description: `${task.description} Перед SQL назови, что означает одна строка результата, какое условие нельзя потерять и каким коротким контрольным запросом проверишь ответ.`,
    starter: `-- Interview mini-contract
-- 1. Что означает одна строка результата?
-- 2. Какое условие нельзя потерять?
-- 3. Каким контрольным запросом проверишь ответ?
`,
    hints: [
      `Одна строка: сформулируй гранулярность задачи «${baseTitle(task)}» без SQL-терминов.`,
      `Главное условие: выбери одно ограничение из чек-листа модуля — ${task.guide.checklist[0]}.`,
      'Контроль: назови COUNT(*), обратный фильтр или несколько конкретных строк для сверки.'
    ]
  };
}

function puzzleTask(task: SqlTask): SqlTask {
  const edgeCase = task.guide.commonMistakes[0] || 'пограничный случай';
  return {
    ...task,
    title: `Puzzle · ${baseTitle(task)}`,
    description: `${task.description} Перенеси правило темы на новую формулировку: назови сохраняемый инвариант, один edge case и правило стабильного вывода.`,
    starter: `-- Puzzle mini-contract
-- 1. Какое правило темы должно сохраниться?
-- 2. Какой edge case проверишь?
-- 3. Что сделает вывод стабильным и проверяемым?
`,
    hints: [
      `Инвариант: перескажи своими словами модель модуля — ${task.guide.mentalModel}`,
      `Edge case: проверь риск «${edgeCase}».`,
      'Стабильность: проверь NULL, число строк и явный tie-breaker там, где порядок важен.'
    ]
  };
}

export function applyCoreTransferContracts(source: readonly SqlTask[]): SqlTask[] {
  return source.map(task => {
    if (!coreModuleIds.has(task.module)) return task;
    if (task.mode === 'interview') return interviewTask(task);
    if (task.mode === 'puzzle') return puzzleTask(task);
    return task;
  });
}
