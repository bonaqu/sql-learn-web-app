import {
  capstoneProjects,
  curriculumCheckpoints,
  curriculumLessons,
  type CurriculumLesson
} from '../data/complete-curriculum';
import { modules, tasks, type SqlTask } from '../data/course-catalog';
import { canonicalModuleIds, phaseDefinitions, phaseForModule } from '../data/learning-structure';
import type { CurriculumProgressV1 } from './curriculum-progress';
import {
  goalModuleFrontier,
  safeDiagnosticBypass,
  type GoalRouteReasonCode
} from './goal-aware-route';
import type { LearnerGoal } from './learner-onboarding';
import {
  hasIndependentTaskEvidence,
  reviewQueue,
  type Progress
} from './progress';

export type JourneyStage =
  | 'lesson'
  | 'guided'
  | 'practice'
  | 'review'
  | 'checkpoint'
  | 'interview'
  | 'puzzle'
  | 'assessment'
  | 'project'
  | 'complete';

export type JourneyActionKind =
  | 'lesson'
  | 'task'
  | 'checkpoint'
  | 'assessment'
  | 'project'
  | 'complete';

export type JourneyRouteReasonCode = GoalRouteReasonCode
  | 'retrieval-review'
  | 'phase-checkpoint'
  | 'checkpoint-transfer'
  | 'final-assessment'
  | 'capstone-project'
  | 'route-complete';

export type JourneyAction = {
  kind: JourneyActionKind;
  stage: JourneyStage;
  title: string;
  description: string;
  cta: string;
  moduleId: string | null;
  moduleTitle: string | null;
  phaseId: string | null;
  phaseTitle: string | null;
  task: SqlTask | null;
  lessonId: string | null;
  checkpointId: string | null;
  projectId: string | null;
  routeReasonCode?: JourneyRouteReasonCode;
  routeReason?: string;
};

export type JourneyOptions = {
  includeReview?: boolean;
  passedCheckpointIds?: readonly string[];
  assessmentComplete?: boolean;
  bypassedModuleIds?: readonly string[];
  goal?: LearnerGoal | null;
};

export type JourneyFrontier = {
  action: JourneyAction;
  goal: LearnerGoal;
  routeModuleIds: string[];
  completedModuleIds: string[];
  eligibleModuleIds: string[];
  safeBypassedModuleIds: string[];
  passedPhaseIds: string[];
};

const moduleTitles = new Map(modules.map(([id, title]) => [id, title]));

function context(moduleId: string | null) {
  const phase = moduleId ? phaseForModule(moduleId) : null;
  return {
    moduleId,
    moduleTitle: moduleId ? moduleTitles.get(moduleId) || moduleId : null,
    phaseId: phase?.id || null,
    phaseTitle: phase?.title || null
  };
}

function withReason(
  action: JourneyAction,
  routeReasonCode: JourneyRouteReasonCode,
  routeReason: string
): JourneyAction {
  return { ...action, routeReasonCode, routeReason };
}

function lessonAction(lesson: CurriculumLesson): JourneyAction {
  return {
    kind: 'lesson',
    stage: 'lesson',
    title: lesson.title,
    description: `Сначала собери mental model, выполни runnable example и пройди knowledge check. ${lesson.subtitle}`,
    cta: 'Открыть урок',
    ...context(lesson.module),
    task: null,
    lessonId: lesson.id,
    checkpointId: null,
    projectId: null
  };
}

function taskAction(task: SqlTask, stage: JourneyStage, description: string, cta: string): JourneyAction {
  return {
    kind: 'task',
    stage,
    title: task.title,
    description,
    cta,
    ...context(task.module),
    task,
    lessonId: null,
    checkpointId: null,
    projectId: null
  };
}

function taskSatisfied(task: SqlTask, progress: Progress) {
  if (task.mode === 'lesson') return progress.completed.includes(task.id);
  return hasIndependentTaskEvidence(progress, task.id);
}

function orderedLinkedTasks(lesson: CurriculumLesson) {
  const linked = new Set(lesson.practiceTaskIds);
  return tasks.filter(task => linked.has(task.id));
}

export function foundationTasksForModule(moduleId: string) {
  return tasks.filter(task =>
    task.module === moduleId && (task.mode === 'lesson' || task.mode === 'practice')
  );
}

export function transferTasksForModule(moduleId: string) {
  return tasks.filter(task =>
    task.module === moduleId && (task.mode === 'interview' || task.mode === 'puzzle')
  );
}

function nextFoundationAction(
  moduleId: string,
  progress: Progress,
  curriculum: CurriculumProgressV1,
  bypassed: ReadonlySet<string>
): JourneyAction | null {
  if (bypassed.has(moduleId)) return null;
  const lessons = curriculumLessons.filter(lesson => lesson.module === moduleId);
  const linkedTaskIds = new Set<string>();

  for (const lesson of lessons) {
    if (!curriculum.completedLessons.includes(lesson.id)) return lessonAction(lesson);
    for (const task of orderedLinkedTasks(lesson)) {
      linkedTaskIds.add(task.id);
      if (taskSatisfied(task, progress)) continue;
      if (task.mode === 'lesson') {
        return taskAction(
          task,
          'guided',
          'Примени только что изученную модель. Подсказки допустимы: сейчас важна правильная последовательность рассуждения.',
          'Начать guided-задачу'
        );
      }
      if (task.mode === 'practice') {
        return taskAction(
          task,
          'practice',
          'Реши связанную задачу без подсказки и эталона. Обычная completion-галочка ещё не заменяет independent evidence.',
          'Начать самостоятельную практику'
        );
      }
    }
  }

  for (const task of foundationTasksForModule(moduleId)) {
    if (linkedTaskIds.has(task.id) || taskSatisfied(task, progress)) continue;
    return task.mode === 'lesson'
      ? taskAction(task, 'guided', 'Закрепи mental model на короткой guided-задаче.', 'Начать guided-задачу')
      : taskAction(task, 'practice', 'Подтверди навык самостоятельным SQL без подсказки и эталона.', 'Начать практику');
  }
  return null;
}

export function moduleFoundationComplete(
  moduleId: string,
  progress: Progress,
  curriculum: CurriculumProgressV1,
  bypassedModuleIds: readonly string[] = []
) {
  return nextFoundationAction(moduleId, progress, curriculum, new Set(bypassedModuleIds)) === null;
}

function checkpointPassedByEvidence(checkpointId: string, progress: Progress, passed: ReadonlySet<string>) {
  if (passed.has(checkpointId)) return true;
  const checkpoint = curriculumCheckpoints.find(item => item.id === checkpointId);
  return Boolean(checkpoint?.taskIds.length && checkpoint.taskIds.every(taskId =>
    hasIndependentTaskEvidence(progress, taskId)
  ));
}

function checkpointForPhase(phaseId: string) {
  const phase = phaseDefinitions.find(item => item.id === phaseId);
  if (!phase) return null;
  return curriculumCheckpoints.find(checkpoint =>
    checkpoint.moduleIds.some(moduleId => phase.moduleIds.some(id => id === moduleId))
  ) || null;
}

function checkpointAction(phaseId: string): JourneyAction | null {
  const phase = phaseDefinitions.find(item => item.id === phaseId);
  const checkpoint = checkpointForPhase(phaseId);
  if (!phase || !checkpoint) return null;
  return {
    kind: 'checkpoint',
    stage: 'checkpoint',
    title: checkpoint.title,
    description: 'Смешанная контрольная точка проверит, что знания фазы соединяются в один рабочий навык, а не существуют отдельными упражнениями.',
    cta: 'Пройти checkpoint',
    moduleId: null,
    moduleTitle: null,
    phaseId: phase.id,
    phaseTitle: phase.title,
    task: null,
    lessonId: null,
    checkpointId: checkpoint.id,
    projectId: null
  };
}

function transferAction(moduleId: string, progress: Progress): JourneyAction | null {
  for (const task of transferTasksForModule(moduleId)) {
    if (taskSatisfied(task, progress)) continue;
    if (task.mode === 'interview') {
      return taskAction(
        task,
        'interview',
        'Теперь объясни допущения и собери решение без учебных костылей — как на техническом интервью или рабочем разборе.',
        'Перейти в Interview'
      );
    }
    return taskAction(
      task,
      'puzzle',
      'Перенеси уже подтверждённый навык на непривычную формулировку. Puzzle не используется как первое знакомство с темой.',
      'Решить SQL Puzzle'
    );
  }
  return null;
}

function reviewAction(progress: Progress): JourneyAction | null {
  const task = reviewQueue(progress, 1)[0];
  if (!task) return null;
  return taskAction(
    task,
    'review',
    'Восстанови решение по памяти. Сначала попытка без перечитывания урока, затем диагностика ошибки и только потом подсказка.',
    'Начать повторение'
  );
}

function phaseRouteRank(phaseId: string, routePositions: ReadonlyMap<string, number>) {
  const phase = phaseDefinitions.find(item => item.id === phaseId);
  if (!phase) return Number.MAX_SAFE_INTEGER;
  return Math.max(...phase.moduleIds.map(moduleId => routePositions.get(moduleId) ?? Number.MAX_SAFE_INTEGER));
}

function assessmentAction(): JourneyAction {
  return {
    kind: 'assessment',
    stage: 'assessment',
    title: 'Итоговая проверка SQL',
    description: 'Проверь удержание навыков на смешанном наборе задач без привязки к одному уроку.',
    cta: 'Открыть Assessment Center',
    moduleId: null,
    moduleTitle: null,
    phaseId: null,
    phaseTitle: null,
    task: null,
    lessonId: null,
    checkpointId: null,
    projectId: null
  };
}

function projectAction(curriculum: CurriculumProgressV1): JourneyAction | null {
  const project = capstoneProjects.find(item => !curriculum.completedProjects.includes(item.id));
  if (!project) return null;
  return {
    kind: 'project',
    stage: 'project',
    title: project.title,
    description: project.summary,
    cta: 'Открыть Project Lab',
    moduleId: project.moduleIds[0] || null,
    moduleTitle: project.moduleIds[0] ? moduleTitles.get(project.moduleIds[0]) || project.moduleIds[0] : null,
    phaseId: project.moduleIds[0] ? phaseForModule(project.moduleIds[0])?.id || null : null,
    phaseTitle: project.moduleIds[0] ? phaseForModule(project.moduleIds[0])?.title || null : null,
    task: null,
    lessonId: null,
    checkpointId: null,
    projectId: project.id
  };
}

function completeAction(): JourneyAction {
  return {
    kind: 'complete',
    stage: 'complete',
    title: 'Маршрут от основ до expert SQL завершён',
    description: 'Все обязательные ступени закрыты. Дальше маршрут строится из spaced review, новых dialect labs и повторной проверки production-навыков.',
    cta: 'Открыть учебный план',
    moduleId: null,
    moduleTitle: null,
    phaseId: null,
    phaseTitle: null,
    task: null,
    lessonId: null,
    checkpointId: null,
    projectId: null
  };
}

export function buildJourneyFrontier(
  progress: Progress,
  curriculum: CurriculumProgressV1,
  options: JourneyOptions = {}
): JourneyFrontier {
  const goal = options.goal || 'full';
  const safeBypassedModuleIds = safeDiagnosticBypass(goal, options.bypassedModuleIds || []);
  const bypassed = new Set(safeBypassedModuleIds);
  const completedModuleIds = canonicalModuleIds.filter(moduleId =>
    nextFoundationAction(moduleId, progress, curriculum, bypassed) === null
  );
  const moduleFrontier = goalModuleFrontier(goal, completedModuleIds);
  const routePositions = new Map(moduleFrontier.routeModuleIds.map((moduleId, index) => [moduleId, index]));
  const passedCheckpointIds = new Set(options.passedCheckpointIds || []);
  const passedPhaseIds = phaseDefinitions
    .filter(phase => {
      const checkpoint = checkpointForPhase(phase.id);
      return Boolean(checkpoint && checkpointPassedByEvidence(checkpoint.id, progress, passedCheckpointIds));
    })
    .map(phase => phase.id);

  let action: JourneyAction | null = null;
  if (options.includeReview !== false) {
    const review = reviewAction(progress);
    if (review) {
      action = withReason(
        review,
        'retrieval-review',
        'Spaced retrieval имеет приоритет над новой темой, чтобы ранее изученное не распалось.'
      );
    }
  }

  if (!action) {
    const readyCheckpointPhase = phaseDefinitions
      .filter(phase => phase.moduleIds.every(moduleId => completedModuleIds.includes(moduleId)))
      .filter(phase => {
        const checkpoint = checkpointForPhase(phase.id);
        return Boolean(checkpoint && !checkpointPassedByEvidence(checkpoint.id, progress, passedCheckpointIds));
      })
      .sort((left, right) => phaseRouteRank(left.id, routePositions) - phaseRouteRank(right.id, routePositions))[0];
    const checkpoint = readyCheckpointPhase ? checkpointAction(readyCheckpointPhase.id) : null;
    if (checkpoint) {
      action = withReason(
        checkpoint,
        'phase-checkpoint',
        'Все foundation-модули этой фазы закрыты; mixed checkpoint обязателен до transfer и новой специализации.'
      );
    }
  }

  if (!action) {
    const passedPhases = phaseDefinitions
      .filter(phase => passedPhaseIds.includes(phase.id))
      .sort((left, right) => phaseRouteRank(left.id, routePositions) - phaseRouteRank(right.id, routePositions));
    for (const phase of passedPhases) {
      const phaseModules = [...phase.moduleIds]
        .sort((left, right) => (routePositions.get(left) ?? 0) - (routePositions.get(right) ?? 0));
      for (const moduleId of phaseModules) {
        if (bypassed.has(moduleId)) continue;
        const transfer = transferAction(moduleId, progress);
        if (!transfer) continue;
        action = withReason(
          transfer,
          'checkpoint-transfer',
          'Foundation и checkpoint уже подтверждены; теперь тот же навык проверяется без учебного scaffolding.'
        );
        break;
      }
      if (action) break;
    }
  }

  if (!action && moduleFrontier.nextModuleId) {
    const foundation = nextFoundationAction(moduleFrontier.nextModuleId, progress, curriculum, bypassed);
    if (foundation) {
      action = withReason(
        foundation,
        moduleFrontier.nextReasonCode || 'prerequisite-recovery',
        moduleFrontier.nextReason || 'Модуль является следующим prerequisite-safe шагом маршрута.'
      );
    }
  }

  if (!action) {
    const incomplete = moduleFrontier.routeModuleIds.find(moduleId => !completedModuleIds.includes(moduleId));
    if (incomplete) {
      const recovery = nextFoundationAction(incomplete, progress, curriculum, bypassed);
      if (recovery) {
        action = withReason(
          recovery,
          'prerequisite-recovery',
          'Маршрут восстанавливает недостающий prerequisite вместо небезопасного перехода вперёд.'
        );
      }
    }
  }

  if (!action && !options.assessmentComplete) {
    action = withReason(
      assessmentAction(),
      'final-assessment',
      'Все обязательные модули, checkpoints и transfer закрыты; пора проверить смешанное удержание навыков.'
    );
  }

  if (!action) {
    const project = projectAction(curriculum);
    action = project
      ? withReason(project, 'capstone-project', 'Assessment закрыт; capstone собирает знания в воспроизводимый production-артефакт.')
      : withReason(completeAction(), 'route-complete', 'Все обязательные evidence-ступени академии завершены.');
  }

  return {
    action,
    goal,
    routeModuleIds: moduleFrontier.routeModuleIds,
    completedModuleIds,
    eligibleModuleIds: moduleFrontier.eligibleModuleIds,
    safeBypassedModuleIds,
    passedPhaseIds
  };
}

export function nextJourneyAction(
  progress: Progress,
  curriculum: CurriculumProgressV1,
  options: JourneyOptions = {}
): JourneyAction {
  return buildJourneyFrontier(progress, curriculum, options).action;
}

export function journeyStageForTask(task: SqlTask): JourneyStage {
  if (task.mode === 'lesson') return 'guided';
  if (task.mode === 'practice') return 'practice';
  if (task.mode === 'interview') return 'interview';
  return 'puzzle';
}
