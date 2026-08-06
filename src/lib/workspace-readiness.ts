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
  completedModuleIds?: readonly string[];
  eligibleModuleIds?: readonly string[];
  routeModuleIds?: readonly string[];
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
  if (action.stage === 'guided') return `задачу с пошаговой поддержкой «${action.title}»`;
  if (action.stage === 'practice') return `самостоятельную практику «${action.title}»`;
  if (action.stage === 'checkpoint') return `контрольную точку «${action.title}»`;
  if (action.stage === 'interview') return `задачу в формате интервью «${action.title}»`;
  if (action.stage === 'puzzle') return `SQL-головоломку «${action.title}»`;
  if (action.stage === 'assessment') return 'итоговую проверку';
  if (action.stage === 'project') return `итоговый проект «${action.title}»`;
  return 'текущий этап маршрута';
}

export function workspaceTaskReadiness(
  task: SqlTask,
  progress: Progress,
  journey: WorkspaceJourneyState | null,
  mode: WorkspaceMode
): WorkspaceTaskReadiness {
  if (mode === 'review') {
    return ready('Повторение по памяти', 'Задача уже находится в адаптивной очереди повторения.');
  }

  if (hasIndependentTaskEvidence(progress, task.id)) {
    return ready('Самостоятельное решение подтверждено', 'Навык уже подтверждён без подсказки; задачу можно повторить в любое время.');
  }

  if (progress.completed.includes(task.id)) {
    return ready('Повтор задачи с поддержкой', 'Задача уже решалась; повторный запуск поможет подтвердить навык самостоятельно или лучше его закрепить.');
  }

  if (!journey) {
    return {
      status: 'loading',
      canRun: false,
      label: 'Сверяю маршрут',
      reason: 'Загружаю данные об уроках, контрольных точках, цели обучения и итоговой проверке перед запуском.'
    };
  }

  const action = journey.action;
  const passedPhaseIds = journey.passedPhaseIds.length
    ? journey.passedPhaseIds
    : action.frontierPassedPhaseIds || [];
  const completedModuleIds = journey.completedModuleIds
    || action.frontierCompletedModuleIds
    || [];
  const eligibleModuleIds = journey.eligibleModuleIds
    || action.frontierEligibleModuleIds
    || [];
  const routeModuleIds = journey.routeModuleIds
    || action.frontierRouteModuleIds
    || [];
  if (action.kind === 'complete') {
    return ready('Свободная экспертная практика', 'Обязательный маршрут завершён; все задачи доступны для поддержания навыка.');
  }

  if (action.task?.id === task.id) {
    return ready('Текущий шаг маршрута', action.routeReason || action.description);
  }

  const taskPhase = phaseForModule(task.module);
  const isTransfer = task.mode === 'interview' || task.mode === 'puzzle';

  if (isTransfer) {
    if (taskPhase
      && passedPhaseIds.includes(taskPhase.id)
      && completedModuleIds.includes(task.module)) {
      return ready(
        task.mode === 'interview' ? 'Задача-интервью открыта' : 'Головоломка открыта',
        'Базовые задания этого модуля и контрольная точка его фазы уже пройдены.'
      );
    }
    return preview(
      task.mode === 'interview' ? 'Задача-интервью · предпросмотр' : 'Головоломка · предпросмотр',
      `Сначала заверши базовые задания модуля и контрольную точку его фазы. Единый следующий шаг — ${frontierDescription(action)}.`
    );
  }

  if (completedModuleIds.includes(task.module)) {
    return ready('Базовый модуль открыт', 'Уроки и самостоятельная практика этого модуля уже пройдены; задачу можно повторить.');
  }

  if (action.stage === 'assessment' || action.stage === 'project') {
    return ready('Базовые задания доступны', 'Все обязательные модули уже пройдены; задачу можно повторить.');
  }

  if (action.moduleId === task.module) {
    if (action.stage === 'lesson') {
      return preview(
        'Сначала разберись в модели',
        `Перед запуском задачи заверши ${frontierDescription(action)} и ответь на его контрольные вопросы.`
      );
    }
    if (action.task) {
      const taskIndex = taskOrder.get(task.id) ?? Number.MAX_SAFE_INTEGER;
      const frontierTaskIndex = taskOrder.get(action.task.id) ?? Number.MAX_SAFE_INTEGER;
      if (taskIndex <= frontierTaskIndex) {
        return ready('Открытый этап модуля', 'Задача находится не дальше текущего шага внутри выбранного модуля.');
      }
    }
    return preview(
      'Позже в текущем модуле · предпросмотр',
      `Сначала пройди ${frontierDescription(action)}; после этого маршрут откроет следующий тип задач.`
    );
  }

  if (eligibleModuleIds.includes(task.module)) {
    const currentPosition = action.moduleId ? routeModuleIds.indexOf(action.moduleId) : -1;
    const taskPosition = routeModuleIds.indexOf(task.module);
    return preview(
      'Предварительные темы пройдены · позже по цели',
      currentPosition >= 0 && taskPosition >= 0
        ? `Модуль уже доступен, но выбранная цель поставила его после текущего шага. Сначала пройди ${frontierDescription(action)}.`
        : `Модуль уже доступен, но единый маршрут сначала ведёт через ${frontierDescription(action)}.`
    );
  }

  return preview(
    'Предварительные темы не пройдены · предпросмотр',
    `Этот модуль пока недоступен по учебному маршруту. Сначала пройди ${frontierDescription(action)}.`
  );
}

export function workspaceStageLabel(task: SqlTask) {
  if (task.mode === 'lesson') return 'С поддержкой';
  if (task.mode === 'practice') return 'Практика';
  if (task.mode === 'interview') return 'Интервью';
  return 'Головоломка';
}
