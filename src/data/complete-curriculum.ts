import {
  capstoneProjects,
  curriculumCheckpoints as coreCheckpoints,
  curriculumLessons as coreLessons,
  curriculumSearch as coreSearch,
  lessonById as coreLessonById,
  lessonForModule as coreLessonForModule,
  type CurriculumLesson
} from './curriculum';
import { advancedCurriculumCheckpoints, advancedCurriculumLessons } from './advanced-curriculum';
import { tasks } from './course-catalog';
import {
  applyCoreCheckpointTaskLinks,
  applyCoreLessonTaskLinks
} from './core-curriculum-progression';
import { moduleOrderIndex, phaseDefinitions } from './learning-structure';
import { applySyntaxFrontierLessonOverrides } from './syntax-frontier-content';
import { beginnerLessonCycle } from './beginner-lesson-cycles';

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

const normalizedCoreLessons = applyCoreLessonTaskLinks(
  coreLessons.map(lesson => lesson.id === 'lesson-cte'
    ? { ...lesson, title: 'CTE и этапы запроса' }
    : lesson),
  tasks
).map(lesson => ({ ...lesson, beginnerCycle: beginnerLessonCycle(lesson.module) }));
const normalizedCoreCheckpoints = applyCoreCheckpointTaskLinks(coreCheckpoints);

function diversifyAdvancedLesson(lesson: CurriculumLesson): CurriculumLesson {
  return {
    ...lesson,
    sections: lesson.sections.map(section => ({
      ...section,
      bullets: section.bullets.map(item => section.kind === 'concept'
        ? `Объясни модель: ${item}`
        : section.kind === 'workflow'
          ? `Проверь на данных: ${item}`
          : `Диагностируй failure mode: ${item}`)
    }))
  };
}

function alignAdvancedLessonExample(lesson: CurriculumLesson): CurriculumLesson {
  const exampleTask = tasks.find(task => task.id === lesson.practiceTaskIds[0]);
  if (!exampleTask) return lesson;
  return {
    ...lesson,
    example: {
      ...lesson.example,
      description: exampleTask.description,
      sql: exampleTask.solution
    }
  };
}

const normalizedAdvancedLessons = applySyntaxFrontierLessonOverrides(
  advancedCurriculumLessons.map(diversifyAdvancedLesson)
).map(alignAdvancedLessonExample);
const sourceLessons = [...normalizedCoreLessons, ...normalizedAdvancedLessons];
const lessonSourceOrder = new Map<string, number>(sourceLessons.map((lesson, index) => [lesson.id, index]));
const checkpointOrder = new Map<string, number>(phaseDefinitions.map((phase, index) => [phase.id, index]));

export const curriculumLessons = [...sourceLessons].sort((left, right) =>
  moduleOrderIndex(left.module) - moduleOrderIndex(right.module)
  || (lessonSourceOrder.get(left.id) ?? 0) - (lessonSourceOrder.get(right.id) ?? 0)
  || left.id.localeCompare(right.id)
);

export const curriculumCheckpoints = [...normalizedCoreCheckpoints, ...advancedCurriculumCheckpoints]
  .sort((left, right) => {
    const leftPhase = phaseDefinitions.find(phase =>
      left.moduleIds.some(moduleId => phase.moduleIds.some(id => id === moduleId))
    )?.id;
    const rightPhase = phaseDefinitions.find(phase =>
      right.moduleIds.some(moduleId => phase.moduleIds.some(id => id === moduleId))
    )?.id;
    return (checkpointOrder.get(leftPhase || '') ?? Number.MAX_SAFE_INTEGER)
      - (checkpointOrder.get(rightPhase || '') ?? Number.MAX_SAFE_INTEGER)
      || left.id.localeCompare(right.id);
  });

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
