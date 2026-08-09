import type { JourneyStage } from './learning-journey';

export const journeyStageLabels: Record<JourneyStage, string> = {
  lesson: 'Урок',
  guided: 'Практика с подсказками',
  practice: 'Самостоятельная практика',
  review: 'Повторение',
  checkpoint: 'Контрольный этап',
  interview: 'Интервью',
  puzzle: 'SQL-головоломка',
  assessment: 'Итоговая проверка',
  project: 'Итоговый проект',
  complete: 'Маршрут завершён'
};

export function journeyStageLabel(stage: JourneyStage) {
  return journeyStageLabels[stage];
}
