import { SqlTask } from '../data/course-catalog';

export type MentorMode = 'next-step' | 'debug' | 'concept' | 'review';

export type MentorContext = {
  mode: MentorMode;
  sql: string;
  task: SqlTask;
  message?: string;
  attempts: number;
  hintsUsed: number;
};

const has = (sql: string, pattern: RegExp) => pattern.test(sql.toLowerCase());

export function localMentor(context: MentorContext) {
  const normalized = context.sql.trim();
  const findings: string[] = [];

  if (!normalized) findings.push('Редактор пуст. Начни с SELECT и перечисли только нужные столбцы.');
  if (has(normalized, /select\s+\*/)) findings.push('Замени SELECT * явным списком столбцов, чтобы результат был предсказуемым.');
  if (has(normalized, /=\s*null\b/)) findings.push('NULL нельзя сравнивать через =. Используй IS NULL или IS NOT NULL.');
  if (has(normalized, /count\s*\(/) && !has(normalized, /group\s+by/) && /по каждому|по сервис|по инженер|по приоритет/i.test(context.task.description)) {
    findings.push('Агрегат считает весь набор. Для показателя по категориям нужен GROUP BY.');
  }
  if (has(normalized, /join\b/) && !has(normalized, /\bon\b/)) findings.push('JOIN должен содержать условие ON, связывающее ключи таблиц.');
  if (has(normalized, /left\s+join/) && has(normalized, /count\s*\(\s*\*\s*\)/)) findings.push('При LEFT JOIN COUNT(*) считает и строки без совпадения. Считай ключ правой таблицы.');
  if (has(normalized, /like\s+'%/)) findings.push('Шаблон с ведущим % обычно не использует обычный B-tree индекс.');
  if (has(normalized, /group\s+by/) && !has(normalized, /order\s+by/) && /отсорт|сначала|рейтинг|первые/i.test(context.task.description)) {
    findings.push('Добавь детерминированный ORDER BY, включая вторичный ключ при равенстве.');
  }
  if (context.message?.startsWith('Ошибка SQLite:')) findings.push(`SQLite сообщает: ${context.message.replace('Ошибка SQLite:', '').trim()}`);

  const firstHint = context.task.hints[Math.min(context.hintsUsed, context.task.hints.length - 1)];
  if (context.mode === 'concept') {
    return `Концепт «${context.task.topic}»:\n\n${context.task.guide.mentalModel}\n\nРабочий чек-лист:\n• ${context.task.guide.checklist.join('\n• ')}`;
  }
  if (context.mode === 'review') {
    return `Перед повторной попыткой:\n• Сформулируй ожидаемые строки и столбцы словами.\n• ${firstHint}\n• Сравни каждый оператор SQL с одним требованием задачи.`;
  }
  if (context.mode === 'next-step') {
    return findings.length
      ? `Следующий шаг:\n${findings[0]}\n\nНе переписывай весь запрос сразу — измени только этот фрагмент и снова запусти проверку.`
      : `Следующий шаг:\n${firstHint}\n\nПосле изменения проверь форму результата: названия столбцов, число строк и порядок.`;
  }

  return findings.length
    ? `Диагностика:\n• ${findings.join('\n• ')}\n\nНачни с первой причины: она чаще всего объясняет остальное.`
    : 'Синтаксис выглядит правдоподобно. Сверь выбранные столбцы, фильтр, порядок строк и обработку NULL с формулировкой задачи.';
}
