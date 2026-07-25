import {
  capstoneProjects,
  curriculumCheckpoints as coreCheckpoints,
  curriculumLessons as coreLessons,
  curriculumSearch as coreSearch,
  lessonById as coreLessonById,
  lessonForModule as coreLessonForModule
} from './curriculum';
import { advancedCurriculumCheckpoints, advancedCurriculumLessons } from './advanced-curriculum';

export type {
  CapstoneProject,
  CourseModuleId,
  CurriculumCheckpoint,
  CurriculumLesson,
  CurriculumSection,
  CurriculumSectionKind,
  GlossaryEntry,
  KnowledgeCheck,
  ProjectDeliverable,
  RunnableExample
} from './curriculum';

export { capstoneProjects };

const normalizedCoreLessons = coreLessons.map(lesson => lesson.id === 'lesson-cte'
  ? { ...lesson, title: 'CTE и этапы запроса' }
  : lesson);

export const curriculumLessons = [...normalizedCoreLessons, ...advancedCurriculumLessons];
export const curriculumCheckpoints = [...coreCheckpoints, ...advancedCurriculumCheckpoints];

export function lessonById(id: string) {
  return curriculumLessons.find(lesson => lesson.id === id) || coreLessonById(id);
}

export function lessonForModule(moduleId: string) {
  return curriculumLessons.find(lesson => lesson.module === moduleId) || coreLessonForModule(moduleId as never);
}

export function curriculumSearch(query: string) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return curriculumLessons;
  const coreMatches = new Set(coreSearch(query).map(lesson => lesson.id));
  return curriculumLessons.filter(lesson => {
    if (coreMatches.has(lesson.id)) return true;
    const text = [
      lesson.title,
      lesson.subtitle,
      ...lesson.objectives,
      ...lesson.sections.flatMap(section => [section.title, section.lead, ...section.paragraphs, ...section.bullets]),
      ...lesson.glossary.flatMap(item => [item.term, item.definition]),
      lesson.example.title,
      lesson.example.description,
      lesson.check.question,
      ...lesson.check.options
    ].join(' ').toLowerCase();
    return text.includes(normalized);
  });
}
