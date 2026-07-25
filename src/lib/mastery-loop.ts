import {
  curriculumLessons,
  type CurriculumLesson
} from '../data/complete-curriculum';
import type { CurriculumProgressV1 } from './curriculum-progress';
import { diagnosticForKind } from './attempt-diagnostics';
import {
  hasIndependentTaskEvidence,
  moduleErrorSummary,
  type Progress
} from './progress';
import type { ReviewState } from './spaced-repetition';

export type MasteryStepStatus = 'done' | 'current' | 'blocked' | 'scheduled';

export type LessonMasteryState = {
  lessonId: string;
  moduleId: string;
  sectionsCompleted: number;
  sectionsTotal: number;
  theoryComplete: boolean;
  checkCorrect: boolean;
  independentTaskIds: string[];
  requiredTaskIds: string[];
  applied: boolean;
  reviewIntroduced: boolean;
  reviewRepetitions: number;
  retained: boolean;
  mastered: boolean;
  durableMastery: boolean;
  nextAction: 'study' | 'check' | 'practice' | 'review' | 'continue';
  nextTaskId: string | null;
  blocker: string | null;
};

export function lessonMasteryState(
  lesson: CurriculumLesson,
  progress: Progress,
  curriculum: CurriculumProgressV1,
  reviewState?: ReviewState
): LessonMasteryState {
  const sectionsCompleted = lesson.sections.filter(section => curriculum.completedSections.includes(section.id)).length;
  const validCompletedLesson = curriculum.completedLessons.includes(lesson.id);
  const theoryComplete = validCompletedLesson || sectionsCompleted === lesson.sections.length;
  const checkCorrect = validCompletedLesson || Boolean(curriculum.answers[lesson.check.id]?.correct);
  const independentTaskIds = lesson.practiceTaskIds.filter(taskId => hasIndependentTaskEvidence(progress, taskId));
  const applied = independentTaskIds.length > 0;
  const review = reviewState?.schedules[`review-${lesson.module}`];
  const reviewIntroduced = Boolean(review?.introducedAt);
  const reviewRepetitions = review?.repetitions || 0;
  const retained = reviewRepetitions > 0;
  const mastered = theoryComplete && checkCorrect && applied;
  const durableMastery = mastered && retained;

  let nextAction: LessonMasteryState['nextAction'] = 'continue';
  let blocker: string | null = null;
  if (!theoryComplete) {
    nextAction = 'study';
    blocker = `Изучи все разделы урока (${sectionsCompleted}/${lesson.sections.length}).`;
  } else if (!checkCorrect) {
    nextAction = 'check';
    blocker = 'Пройди knowledge check без угадывания.';
  } else if (!applied) {
    nextAction = 'practice';
    blocker = 'Реши связанную SQL-задачу без подсказки и открытого решения.';
  } else if (!retained) {
    nextAction = 'review';
    blocker = reviewIntroduced
      ? 'Закрепи модель в Review Deck, когда карточка станет due.'
      : 'Retrieval card будет введена после синхронизации evidence.';
  }

  return {
    lessonId: lesson.id,
    moduleId: lesson.module,
    sectionsCompleted,
    sectionsTotal: lesson.sections.length,
    theoryComplete,
    checkCorrect,
    independentTaskIds,
    requiredTaskIds: [...lesson.practiceTaskIds],
    applied,
    reviewIntroduced,
    reviewRepetitions,
    retained,
    mastered,
    durableMastery,
    nextAction,
    nextTaskId: lesson.practiceTaskIds.find(taskId => !hasIndependentTaskEvidence(progress, taskId))
      || lesson.practiceTaskIds[0]
      || null,
    blocker
  };
}

export function moduleAppliedLessonScore(
  moduleId: string,
  progress: Progress,
  curriculum: CurriculumProgressV1
) {
  const lessons = curriculumLessons.filter(lesson => lesson.module === moduleId);
  if (!lessons.length) return { completed: 0, total: 0, score: 0, lessonIds: [] as string[] };
  const mastered = lessons.filter(lesson => lessonMasteryState(lesson, progress, curriculum).mastered);
  return {
    completed: mastered.length,
    total: lessons.length,
    score: Math.round(mastered.length / lessons.length * 100),
    lessonIds: mastered.map(lesson => lesson.id)
  };
}

export function lessonRemediation(progress: Progress, lesson: CurriculumLesson) {
  const [top] = moduleErrorSummary(progress, lesson.module);
  if (!top) return null;
  const diagnostic = diagnosticForKind(top.kind);
  const taskId = lesson.practiceTaskIds
    .map(id => ({ id, count: progress.taskStats[id]?.errorKinds?.[top.kind] || 0 }))
    .sort((left, right) => right.count - left.count || left.id.localeCompare(right.id))[0]?.id
    || lesson.practiceTaskIds[0]
    || null;
  return {
    kind: top.kind,
    count: top.count,
    title: diagnostic.title,
    explanation: diagnostic.explanation,
    nextStep: diagnostic.nextStep,
    atlasId: diagnostic.atlasId,
    taskId
  };
}

export function masterySummary(
  progress: Progress,
  curriculum: CurriculumProgressV1,
  reviewState?: ReviewState
) {
  const states = curriculumLessons.map(lesson => lessonMasteryState(lesson, progress, curriculum, reviewState));
  return {
    lessons: states.length,
    theoryComplete: states.filter(state => state.theoryComplete && state.checkCorrect).length,
    applied: states.filter(state => state.mastered).length,
    retained: states.filter(state => state.durableMastery).length,
    pendingPractice: states.filter(state => state.theoryComplete && state.checkCorrect && !state.applied).length,
    pendingReview: states.filter(state => state.mastered && !state.retained).length
  };
}
