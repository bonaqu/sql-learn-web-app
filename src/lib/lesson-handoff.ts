import type { CurriculumLesson } from '../data/complete-curriculum';
import { lessonChecksComplete } from '../data/lesson-checks';
import type { CurriculumProgressV1 } from './curriculum-progress';
import type { JourneyAction } from './learning-journey';

export type LessonHandoff = {
  target: 'cycle' | 'questions' | 'journey';
  title: string;
  description: string;
  cta: string;
};

// A lesson's editorial transfer task is not necessarily runnable yet. The
// learning route owns prerequisites; lesson buttons must use that same route.
export function lessonHandoff(
  lesson: CurriculumLesson,
  curriculum: CurriculumProgressV1,
  action: JourneyAction
): LessonHandoff {
  if (!lesson.sections.every(section => curriculum.completedSections.includes(section.id))) {
    return {
      target: 'cycle',
      title: 'Сначала закончи упражнение урока',
      description: 'Ответь на прогноз, выполни пример и дополни SQL. Прочтение текста не заменяет эти шаги.',
      cta: 'Вернуться к упражнению'
    };
  }
  if (!lessonChecksComplete(lesson, curriculum.answers)) {
    return {
      target: 'questions',
      title: 'Теперь объясни, как работает запрос',
      description: 'Ответь на вопросы ниже. После них откроется следующий доступный шаг практики.',
      cta: 'Ответить на вопросы урока'
    };
  }
  return {
    target: 'journey',
    title: `Следующий шаг: ${action.title}`,
    description: action.description,
    cta: action.cta
  };
}
