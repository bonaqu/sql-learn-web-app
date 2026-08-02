import {
  capstoneProjects,
  curriculumCheckpoints,
  curriculumLessons,
  type CurriculumLesson
} from '../data/complete-curriculum';
import { modules, tasks, type SqlTask } from '../data/course-catalog';
import { phaseDefinitions, phaseForModule } from '../data/learning-structure';
import type { CurriculumProgressV1 } from './curriculum-progress';
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
  | 'review'
  | 'checkpoint'
  | 'assessment'
  | 'project'
  | 'complete';

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
};

export type JourneyOptions = {
  includeReview?: boolean;
  passedCheckpointIds?: readonly string[];
  assessmentComplete?: boolean;
  preferredModuleIds?: readonly string[];
  bypassedModuleIds?: readonly string[];
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

function orderedModuleIds(preferred: readonly string[] = []) {
  const preference = new Set(preferred);
  return phaseDefinitions.flatMap(phase => {
    const moduleIds = [...phase.moduleIds];
    return [
      ...moduleIds.filter(moduleId => preference.has(moduleId)),
      ...moduleIds.filter(moduleId => !preference.has(moduleId))
    ];
  });
}

export function nextJourneyAction(
  progress: Progress,
  curriculum: CurriculumProgressV1,
  options: JourneyOptions = {}
): JourneyAction {
  if (options.includeReview !== false) {
    const review = reviewAction(progress);
    if (review) return review;
  }

  const passedCheckpoints = new Set(options.passedCheckpointIds || []);
  const bypassedModules = new Set(options.bypassedModuleIds || []);
  const preferredModules = options.preferredModuleIds || [];
  const orderedModules = orderedModuleIds(preferredModules);

  for (const phase of phaseDefinitions) {
    const phaseModules = orderedModules.filter(moduleId =>
      phase.moduleIds.some(id => id === moduleId)
    );
    for (const moduleId of phaseModules) {
      const foundation = nextFoundationAction(moduleId, progress, curriculum, bypassedModules);
      if (foundation) return foundation;
    }

    const checkpoint = checkpointForPhase(phase.id);
    if (checkpoint && !checkpointPassedByEvidence(checkpoint.id, progress, passedCheckpoints)) {
      return checkpointAction(phase.id) || lessonAction(curriculumLessons[0]);
    }

    for (const moduleId of phaseModules) {
      if (bypassedModules.has(moduleId)) continue;
      const transfer = transferAction(moduleId, progress);
      if (transfer) return transfer;
    }
  }

  if (!options.assessmentComplete) {
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

  const project = capstoneProjects.find(item => !curriculum.completedProjects.includes(item.id));
  if (project) {
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

export function journeyStageForTask(task: SqlTask): JourneyStage {
  if (task.mode === 'lesson') return 'guided';
  if (task.mode === 'practice') return 'practice';
  if (task.mode === 'interview') return 'interview';
  return 'puzzle';
}
