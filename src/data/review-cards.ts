import { modules, tasks } from './course-catalog';

export type ReviewCard = {
  id: string;
  moduleId: string;
  moduleTitle: string;
  prompt: string;
  answer: string;
  example: string;
  trap: string;
};

export const reviewCards: ReviewCard[] = modules.map(([moduleId, moduleTitle]) => {
  const guide = tasks.find(task => task.module === moduleId)?.guide;
  if (!guide) throw new Error(`Missing guide for ${moduleId}`);
  return {
    id: `review-${moduleId}`,
    moduleId,
    moduleTitle,
    prompt: `Объясни ключевую модель темы «${moduleTitle}» и назови одну проверку перед запуском SQL.`,
    answer: guide.mentalModel,
    example: guide.example,
    trap: guide.commonMistakes[0] || 'Проверь контракт результата и данные перед выводом.'
  };
});
