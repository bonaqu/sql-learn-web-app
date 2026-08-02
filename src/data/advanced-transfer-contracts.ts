import { advancedModules } from './advanced-syllabus';
import type { SqlTask } from './course';

const advancedModuleIds = new Set<string>(advancedModules.map(([id]) => id));

function baseTitle(task: SqlTask) {
  return task.title.replace(/^(?:Interview|Puzzle)\s*[·:]\s*/i, '').trim();
}

function interviewTask(task: SqlTask): SqlTask {
  const mistake = task.guide.commonMistakes[0] || 'непроверенное допущение';
  return {
    ...task,
    title: `Interview · ${baseTitle(task)}`,
    description: `${task.description} Перед запуском зафиксируй гранулярность результата, главное допущение, production failure mode и verification query. SQL должен быть воспроизводимым без подсказок и эталона.`,
    starter: `-- Interview contract
-- 1. Что означает одна строка результата?
-- 2. Какое допущение и failure mode нужно проверить?
-- 3. Каким control total или verification query докажешь корректность?
`,
    hints: [
      `Гранулярность: одной фразой определи, что означает одна строка результата для задачи «${baseTitle(task)}».`,
      `Failure mode: объясни, как решение исключает риск «${mistake}».`,
      'Verification: до основного SQL назови control total, обратную выборку или другой запрос, который обнаружит неверный результат.'
    ]
  };
}

function puzzleTask(task: SqlTask): SqlTask {
  const mentalModel = task.guide.mentalModel;
  const mistake = task.guide.commonMistakes[0] || 'скрытый edge case';
  return {
    ...task,
    title: `Puzzle · ${baseTitle(task)}`,
    description: `${task.description} Перенеси инвариант темы на непривычную формулировку, не копируя учебный шаблон буквально. До запуска назови edge case и признак, по которому поймёшь, что перенос модели сломался.`,
    starter: `-- Puzzle transfer
-- 1. Какой инвариант из темы сохраняется?
-- 2. Что в этой формулировке непривычно?
-- 3. Какой edge case обязан пережить результат?
`,
    hints: [
      `Инвариант: используй модель модуля как ограничение, а не как готовый шаблон — ${mentalModel}`,
      `Edge case: проверь риск «${mistake}» на данных, где простое копирование решения дало бы ошибку.`,
      'Самопроверка: найди контрпример, NULL/cardinality boundary или нестабильный порядок, который должен выдержать запрос.'
    ]
  };
}

export function applyAdvancedTransferContracts(source: readonly SqlTask[]): SqlTask[] {
  return source.map(task => {
    if (!advancedModuleIds.has(task.module)) return task;
    if (task.mode === 'interview') return interviewTask(task);
    if (task.mode === 'puzzle') return puzzleTask(task);
    return task;
  });
}
