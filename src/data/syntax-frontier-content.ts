import type { SqlTask } from './course';
import type { CurriculumLesson } from './curriculum';

type TaskLearningOverride = Pick<SqlTask, 'title' | 'description' | 'starter' | 'solution' | 'hints'>;

const taskOverrides: Readonly<Record<string, TaskLearningOverride>> = {
  'task-131': {
    title: 'Additive migration: support_channel',
    description: 'Создай временную таблицу service_contracts, добавь совместимый NOT NULL столбец support_channel с DEFAULT через ALTER TABLE и верни данные после миграции.',
    starter: `CREATE TEMP TABLE service_contracts(
  service TEXT PRIMARY KEY,
  timeout_minutes INTEGER NOT NULL
);
INSERT INTO service_contracts VALUES ('VPN', 30), ('LMS', 45);

-- Добавь support_channel TEXT NOT NULL DEFAULT 'portal'

SELECT service, timeout_minutes, support_channel
FROM service_contracts
ORDER BY service;`,
    solution: `CREATE TEMP TABLE service_contracts(service TEXT PRIMARY KEY, timeout_minutes INTEGER NOT NULL); INSERT INTO service_contracts VALUES ('VPN', 30), ('LMS', 45); ALTER TABLE service_contracts ADD COLUMN support_channel TEXT NOT NULL DEFAULT 'portal'; SELECT service, timeout_minutes, support_channel FROM service_contracts ORDER BY service;`,
    hints: [
      'Additive migration сохраняет существующие столбцы и строки.',
      "Используй ALTER TABLE service_contracts ADD COLUMN support_channel TEXT NOT NULL DEFAULT 'portal'.",
      'Контрольный SELECT должен доказать, что старые строки получили безопасный DEFAULT.'
    ]
  },
  'task-151': {
    title: 'Условные counts через FILTER',
    description: 'По каждому сервису посчитай все обращения, Critical-обращения и закрытые обращения через aggregate FILTER, сохранив один общий набор строк.',
    starter: `SELECT
  service,
  COUNT(*) AS total_count,
  COUNT(*) FILTER (WHERE ) AS critical_count,
  COUNT(*) FILTER (WHERE ) AS closed_count
FROM tickets
GROUP BY service
ORDER BY service;`,
    solution: `SELECT service, COUNT(*) AS total_count, COUNT(*) FILTER (WHERE priority = 'Critical') AS critical_count, COUNT(*) FILTER (WHERE status = 'Closed') AS closed_count FROM tickets GROUP BY service ORDER BY service;`,
    hints: [
      "Первый FILTER проверяет priority = 'Critical'.",
      "Второй FILTER проверяет status = 'Closed'.",
      'COUNT(*) без FILTER остаётся общим denominator для контрольной сверки.'
    ]
  }
};

const lessonExampleTaskIds: Readonly<Record<string, string>> = {
  'lesson-schema-evolution-foundation': 'task-131',
  'lesson-conditional-aggregation-foundation': 'task-151'
};

export function syntaxFrontierTaskOverride(taskId: string) {
  return taskOverrides[taskId] || null;
}

export function applySyntaxFrontierTaskOverrides(source: readonly SqlTask[]): SqlTask[] {
  return source.map(task => {
    const override = syntaxFrontierTaskOverride(task.id);
    return override ? { ...task, ...override, hints: [...override.hints] } : task;
  });
}

export function applySyntaxFrontierLessonOverrides(source: readonly CurriculumLesson[]): CurriculumLesson[] {
  return source.map(lesson => {
    const taskId = lessonExampleTaskIds[lesson.id];
    const override = taskId ? syntaxFrontierTaskOverride(taskId) : null;
    if (!override) return lesson;
    return {
      ...lesson,
      example: {
        ...lesson.example,
        title: `Runnable example · ${override.title}`,
        description: override.description,
        sql: override.solution
      }
    };
  });
}

export const syntaxFrontierContentTaskIds = Object.freeze(Object.keys(taskOverrides));
