import { tasks, type SqlTask } from '../data/course-catalog';
import { phaseForModule } from '../data/learning-structure';
import type { JourneyAction } from './learning-journey';
import {
  hasIndependentTaskEvidence,
  type Progress
} from './progress';

export type WorkspaceMode = 'catalog' | 'practice' | 'review' | 'interview' | 'puzzle';
export type WorkspaceReadinessStatus = 'ready' | 'preview' | 'loading';

export type WorkspaceTaskReadiness = {
  status: WorkspaceReadinessStatus;
  canRun: boolean;
  label: string;
  reason: string;
};

export type WorkspaceJourneyState = {
  action: JourneyAction;
  passedPhaseIds: readonly string[];
  completedModuleIds: readonly string[];
  eligibleModuleIds: readonly string[];
  routeModuleIds: readonly string[];
};

const taskOrder = new Map<string, number>(tasks.map((task, index) => [task.id, index]));

function ready(label: string, reason: string): WorkspaceTaskReadiness {
  return { status: 'ready', canRun: true, label, reason };
}

function preview(label: string, reason: string): WorkspaceTaskReadiness {
  return { status: 'preview', canRun: false, label, reason };
}

function frontierDescription(action: JourneyAction) {
  if (action.stage === 'lesson') return `урок «${action.title}»`;
  if (action.stage === 'guided') return `guided-задачу «${action.title}»`;
  if (action.stage === 'practice') return `самостоятельную практику «${action.title}»`;
  if (action.stage === 'checkpoint') return `checkpoint «${action.title}»`;
  if (action.stage === 'interview') return `Interview «${action.title}»`;
  if (action.stage === 'puzzle') return `SQL Puzzle «${action.title}»`;
  if (action.stage === 'assessment') return 'итоговый Assessment';
  if (action.stage === 'project') return `capstone «${action.title}»`;
  return 'текущий этап маршрута';
}

export function workspaceTaskReadiness(
  task: SqlTask,
  progress: Progress,
  journey: WorkspaceJourneyState | null,
  mode: WorkspaceMode
): WorkspaceTaskReadiness {
  if (mode === 'review') {
    return ready('Retrieval review', 'Задача уже находится в адаптивной очереди повторения.');
  }

  if (hasIndependentTaskEvidence(progress, task.id)) {
    return ready('Independent подтверждён', 'Навык уже подтверждён без подсказки; задачу можно повторить в любое время.');
  }

  if (progress.completed.includes(task.id)) {
    return ready('Повтор guided-этапа', 'Задача уже решалась; повторный запуск нужен для independent evidence или закрепления.');
  }

  if (!journey) {
    return {
      status: 'loading',
      canRun: false,
      label: 'Сверяю маршрут',
      reason: 'Загружаю lesson, checkpoint, goal и assessment evidence перед запуском.'
    };
  }

  const {
    action,
    passedPhaseIds,
    completedModuleIds,
    eligibleModuleIds,
    routeModuleIds
  } = journey;
  if (action.kind === 'complete') {
    return ready('Свободная expert-практика', 'Обязательный маршрут завершён; все задачи доступны для поддержания навыка.');
  }

  if (action.task?.id === task.id) {
    return ready('Текущий шаг маршрута', action.routeReason || action.description);
  }

  const taskPhase = phaseForModule(task.module);
  const isTransfer = task.mode === 'interview' || task.mode === 'puzzle';

  if (isTransfer) {
    if (taskPhase && passedPhaseIds.includes(taskPhase.id)) {
      return ready(
        task.mode === 'interview' ? 'Interview открыт' : 'Puzzle открыт',
        'Foundation этой фазы и её checkpoint уже пройдены.'
      );
    }
    return preview(
      task.mode === 'interview' ? 'Interview preview' : 'Puzzle preview',
      `Сначала заверши foundation фазы и её checkpoint. Единый следующий шаг — ${frontierDescription(action)}.`
    );
  }

  if (completedModuleIds.includes(task.module)) {
    return ready('Foundation-модуль открыт', 'Уроки и independent practice этого модуля уже закрыты; задачу можно повторить.');
  }

  if (action.stage === 'assessment' || action.stage === 'project') {
    return ready('Foundation доступен', 'Все обязательные модули уже пройдены; задачу можно повторить.');
  }

  if (action.moduleId === task.module) {
    if (action.stage === 'lesson') {
      return preview(
        'Сначала mental model',
        `Перед запуском задачи заверши ${frontierDescription(action)} и его knowledge checks.`
      );
    }
    if (action.task) {
      const taskIndex = taskOrder.get(task.id) ?? Number.MAX_SAFE_INTEGER;
      const frontierTaskIndex = taskOrder.get(action.task.id) ?? Number.MAX_SAFE_INTEGER;
      if (taskIndex <= frontierTaskIndex) {
        return ready('Открытый этап модуля', 'Задача находится не дальше текущего шага внутри выбранного frontier-модуля.');
      }
    }
    return preview(
      'Позже в текущем модуле · preview',
      `Сначала пройди ${frontierDescription(action)}; затем единый frontier откроет следующий task stage.`
    );
  }

  if (eligibleModuleIds.includes(task.module)) {
    const currentPosition = action.moduleId ? routeModuleIds.indexOf(action.moduleId) : -1;
    const taskPosition = routeModuleIds.indexOf(task.module);
    return preview(
      'Prerequisites готовы · позже по цели',
      currentPosition >= 0 && taskPosition >= 0
        ? `Модуль уже доступен, но цель поставила его после текущего frontier. Сначала пройди ${frontierDescription(action)}.`
        : `Модуль доступен, но единый frontier сначала ведёт через ${frontierDescription(action)}.`
    );
  }

  return preview(
    'Prerequisites не закрыты · preview',
    `Этот модуль ещё не входит в eligible frontier. Сначала пройди ${frontierDescription(action)}.`
  );
}

export function workspaceStageLabel(task: SqlTask) {
  if (task.mode === 'lesson') return 'Guided';
  if (task.mode === 'practice') return 'Practice';
  if (task.mode === 'interview') return 'Interview';
  return 'Puzzle';
}
