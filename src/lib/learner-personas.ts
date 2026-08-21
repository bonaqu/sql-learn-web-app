import { tasks } from '../data/course-catalog';
import { curriculumLessons } from '../data/complete-curriculum';
import { lessonChecks } from '../data/lesson-checks';
import type { CurriculumProgressV1 } from './curriculum-progress';
import type { LearningAnalyticsEvent, LearningAnalyticsState } from './learning-analytics';
import {
  emptyOnboardingProfile,
  type LearnerGoal,
  type LearnerOnboardingProfile,
  type PlacementLevel
} from './learner-onboarding';
import { defaultProgress, type Progress, type TaskStats } from './progress';

export const PERSONA_EVIDENCE_VERSION = 1 as const;
export const PERSONA_SEED = 'sql-academy-personas-2026-08-21';
const BASE_TIME = '2026-08-17T09:00:00.000Z';

export type LearnerPersonaId = 'zero' | 'partial' | 'role-focused' | 'returning';

export type LearnerPersonaFixture = {
  version: 1;
  id: LearnerPersonaId;
  seed: string;
  label: string;
  goal: LearnerGoal;
  progress: Progress;
  onboarding: LearnerOnboardingProfile;
  curriculum: CurriculumProgressV1;
  analytics: LearningAnalyticsState;
  expected: {
    action: 'new' | 'continue' | 'role-transfer' | 'review';
    nextTaskId: string;
    prerequisiteSafe: true;
  };
};

function iso(days = 0, minutes = 0) {
  const date = new Date(BASE_TIME);
  date.setUTCDate(date.getUTCDate() + days);
  date.setUTCMinutes(date.getUTCMinutes() + minutes);
  return date.toISOString();
}

function taskStats(taskId: string, index: number, returning = false): TaskStats {
  const completedAt = iso(returning ? -10 : 0, index);
  return {
    attempts: 1,
    incorrect: 0,
    hintsUsed: 0,
    solutionViews: 0,
    independentPasses: 1,
    lastIndependentAt: completedAt,
    lastAttemptAt: completedAt,
    completedAt,
    ...(returning && index < 6 ? {
      retrievalDueAt: iso(-7, index),
      retrievalScheduledAt: iso(-10, index),
      retrievalIntervalDays: 3,
      retrievalEvidenceVersion: 'durable-mastery-v1',
      retrievalSourceTaskId: taskId
    } : {})
  };
}

function progress(completedCount: number, returning = false): Progress {
  const completed = tasks.slice(0, completedCount).map(task => task.id);
  return {
    ...defaultProgress,
    completed,
    taskStats: Object.fromEntries(completed.map((taskId, index) => [taskId, taskStats(taskId, index, returning)])),
    xp: tasks.slice(0, completedCount).reduce((sum, task) => sum + task.xp, 0),
    streak: returning ? 4 : completedCount > 0 ? 1 : 0,
    history: defaultProgress.history.map((item, index) => ({ ...item, solved: index < Math.min(7, completedCount) ? 1 : 0 })),
    lastTask: completed.at(-1),
    lastStudyDate: iso(returning ? -10 : 0).slice(0, 10)
  };
}

function curriculum(state: Progress): CurriculumProgressV1 {
  const completed = new Set(state.completed);
  const lessons = curriculumLessons.filter(lesson => lesson.practiceTaskIds.every(taskId => completed.has(taskId)));
  return {
    version: 1,
    completedSections: lessons.flatMap(lesson => lesson.sections.map(section => section.id)),
    completedLessons: lessons.map(lesson => lesson.id),
    completedProjects: [],
    answers: Object.fromEntries(lessons.flatMap(lesson => lessonChecks(lesson).map(check => [check.id, {
      optionIndex: check.correctIndex,
      correct: true,
      answeredAt: BASE_TIME
    }]))),
    projectDrafts: {},
    bookmark: lessons.length ? {
      lessonId: lessons.at(-1)!.id,
      sectionId: lessons.at(-1)!.sections.at(-1)?.id || lessons.at(-1)!.sections[0].id,
      updatedAt: BASE_TIME
    } : null,
    updatedAt: BASE_TIME
  };
}

function onboarding(goal: LearnerGoal, level: PlacementLevel | null, completedCount: number): LearnerOnboardingProfile {
  const profile = emptyOnboardingProfile();
  return {
    ...profile,
    goal,
    experience: completedCount === 0 ? 'none' : completedCount < 30 ? 'basics' : 'regular',
    programmingExperience: goal === 'backend' || goal === 'data-engineering' ? 'professional' : 'some',
    priorSqlExperience: completedCount === 0 ? 'none' : completedCount < 30 ? 'course' : 'work',
    placement: {
      ...profile.placement,
      status: level ? 'completed' : 'deferred',
      reportId: level ? `persona-placement-${level}` : null,
      score: level === 'working' ? 72 : level === 'developing' ? 48 : level === 'advanced' ? 88 : null,
      level,
      recommendedTrack: goal === 'analyst' ? 'analytics' : goal === 'support' ? 'support' : goal === 'backend' ? 'performance' : goal === 'data-engineering' ? 'data-engineering' : 'fundamentals',
      strongModuleIds: completedCount >= 12 ? ['sql-thinking', 'filtering'] : [],
      focusModuleIds: [tasks[Math.min(completedCount, tasks.length - 1)].module],
      confidenceLow: level ? 60 : null,
      confidenceHigh: level ? 82 : null,
      decisionReason: level ? 'Deterministic seeded placement for product-contract verification.' : 'Placement intentionally deferred.',
      diagnosticTaskCount: level ? 5 : null,
      completedAt: level ? BASE_TIME : null
    },
    completedAt: BASE_TIME,
    updatedAt: BASE_TIME
  };
}

function analytics(userId: string, completedCount: number, returning = false): LearningAnalyticsState {
  const events: LearningAnalyticsEvent[] = [{
    version: 1,
    id: 'persona-session-start-0001',
    sessionId: 'persona-session-0001',
    occurredAt: iso(returning ? -10 : 0),
    type: 'session_started'
  }];
  tasks.slice(0, Math.min(3, completedCount)).forEach((task, index) => {
    events.push({
      version: 1,
      id: `persona-attempt-${String(index + 1).padStart(4, '0')}`,
      sessionId: 'persona-session-0001',
      occurredAt: iso(returning ? -10 : 0, index + 1),
      type: 'attempted',
      taskId: task.id,
      moduleId: task.module,
      correct: true,
      independent: true
    }, {
      version: 1,
      id: `persona-independent-${String(index + 1).padStart(4, '0')}`,
      sessionId: 'persona-session-0001',
      occurredAt: iso(returning ? -10 : 0, index + 2),
      type: returning ? 'retention_checked' : 'independent_pass',
      taskId: task.id,
      moduleId: task.module,
      correct: true,
      independent: true
    });
  });
  return {
    version: 1,
    userId,
    sharing: 'off',
    events,
    experimentVariants: { 'remediation-copy-v1': 'control' },
    updatedAt: BASE_TIME
  };
}

const definitions: Record<LearnerPersonaId, { label: string; goal: LearnerGoal; count: number; level: PlacementLevel | null; action: LearnerPersonaFixture['expected']['action']; returning?: boolean }> = {
  zero: { label: 'Zero-evidence learner', goal: 'full', count: 0, level: null, action: 'new' },
  partial: { label: 'Partial foundation learner', goal: 'support', count: 12, level: 'developing', action: 'continue' },
  'role-focused': { label: 'Role-focused analyst', goal: 'analyst', count: 120, level: 'working', action: 'role-transfer' },
  returning: { label: 'Returning learner with review debt', goal: 'backend', count: 30, level: 'developing', action: 'review', returning: true }
};

export function buildLearnerPersona(id: LearnerPersonaId, userId = `persona-${id}`): LearnerPersonaFixture {
  const definition = definitions[id];
  const state = progress(definition.count, definition.returning);
  const nextTaskId = definition.returning ? state.completed[0] : tasks[Math.min(definition.count, tasks.length - 1)].id;
  return {
    version: PERSONA_EVIDENCE_VERSION,
    id,
    seed: PERSONA_SEED,
    label: definition.label,
    goal: definition.goal,
    progress: state,
    onboarding: onboarding(definition.goal, definition.level, definition.count),
    curriculum: curriculum(state),
    analytics: analytics(userId, definition.count, definition.returning),
    expected: { action: definition.action, nextTaskId, prerequisiteSafe: true }
  };
}

export function learnerPersonaEvidence(userIdPrefix = 'persona') {
  return (Object.keys(definitions) as LearnerPersonaId[]).map(id => {
    const fixture = buildLearnerPersona(id, `${userIdPrefix}-${id}`);
    const nextIndex = tasks.findIndex(task => task.id === fixture.expected.nextTaskId);
    const prerequisiteSafe = fixture.expected.action === 'review'
      ? fixture.progress.completed.includes(fixture.expected.nextTaskId)
      : tasks.slice(0, nextIndex).every(task => fixture.progress.completed.includes(task.id));
    return {
      version: fixture.version,
      id: fixture.id,
      seed: fixture.seed,
      goal: fixture.goal,
      completed: fixture.progress.completed.length,
      action: fixture.expected.action,
      nextTaskId: fixture.expected.nextTaskId,
      prerequisiteSafe,
      analyticsEvents: fixture.analytics.events.length,
      completedLessons: fixture.curriculum.completedLessons.length,
      rawSqlStored: false,
      generatedAt: BASE_TIME
    };
  });
}
