import { phaseDefinitions } from './learning-structure';
import type { LearnerGoal } from '../lib/learner-onboarding';

export type ProfessionalTrackId = 'general' | 'support' | 'analyst' | 'backend' | 'data-engineering';

export interface TrackJobTask {
  id: string;
  title: string;
  evidence: string;
  moduleIds: string[];
}

export interface ProfessionalTrack {
  id: ProfessionalTrackId;
  learnerGoal: LearnerGoal;
  title: string;
  outcome: string;
  sharedPrerequisiteModuleIds: string[];
  specialistModuleIds: string[];
  competencies: string[];
  jobTasks: TrackJobTask[];
  capstoneProjectIds: string[];
  capstoneOutcome: string;
}

const sharedPrerequisiteModuleIds = [...phaseDefinitions[0].moduleIds];

export const professionalTracks: ProfessionalTrack[] = [
  {
    id: 'general',
    learnerGoal: 'full',
    title: 'Профессиональный SQL',
    outcome: 'Проектировать проверяемые запросы, безопасно читать и изменять данные и объяснять ограничения результата.',
    sharedPrerequisiteModuleIds,
    specialistModuleIds: ['joins', 'cte', 'data-quality', 'transactions', 'explain'],
    competencies: ['result contracts', 'joins', 'aggregation', 'NULL semantics', 'transactions', 'plan evidence'],
    jobTasks: [
      { id: 'general-result-contract', title: 'Согласовать контракт результата с заказчиком', evidence: 'SQL, контрольные строки и явная гранулярность', moduleIds: ['sql-thinking', 'joins', 'grouping'] },
      { id: 'general-quality-review', title: 'Проверить данные и объяснить ограничения решения', evidence: 'Профиль качества, NULL policy и воспроизводимая проверка', moduleIds: ['data-quality', 'transactions', 'explain'] }
    ],
    capstoneProjectIds: ['project-executive-mart'],
    capstoneOutcome: 'Cross-functional operating review: проверяемая витрина, plan evidence и письменный контракт использования.'
  },
  {
    id: 'support',
    learnerGoal: 'support',
    title: 'Поддержка и расследования',
    outcome: 'Восстанавливать историю инцидента, считать SLA и находить дубли/NULL без ложных выводов.',
    sharedPrerequisiteModuleIds,
    specialistModuleIds: ['joins', 'dates', 'support', 'data-quality', 'incident-investigation'],
    competencies: ['investigations', 'SLA', 'history', 'duplicates', 'NULL'],
    jobTasks: [
      { id: 'support-timeline', title: 'Восстановить историю обращения и точку нарушения SLA', evidence: 'Детерминированная event timeline и проверяемый breach state', moduleIds: ['joins', 'dates', 'incident-investigation'] },
      { id: 'support-identity', title: 'Найти дубли клиента и неизвестные контакты', evidence: 'NULL-aware профиль и канонические duplicate groups', moduleIds: ['text', 'data-quality', 'null-logic-advanced'] }
    ],
    capstoneProjectIds: ['project-incident-command'],
    capstoneOutcome: 'Incident investigation pack: timeline, SLA/backlog contract и приоритет эскалации.'
  },
  {
    id: 'analyst',
    learnerGoal: 'analyst',
    title: 'Продуктовая аналитика',
    outcome: 'Принимать решение по метрикам, датам, cohort/funnel и оконной динамике, фиксируя population и denominator.',
    sharedPrerequisiteModuleIds,
    specialistModuleIds: ['joins', 'grouping', 'dates', 'windows', 'conditional-aggregation', 'window-frames'],
    competencies: ['metrics', 'dates', 'cohorts', 'funnels', 'windows'],
    jobTasks: [
      { id: 'analyst-metric', title: 'Определить продуктовую метрику и её denominator', evidence: 'Metric contract с population, периодом и NULL policy', moduleIds: ['grouping', 'dates', 'conditional-aggregation'] },
      { id: 'analyst-cohort-funnel', title: 'Сравнить cohort/funnel и объяснить изменение', evidence: 'Cohort/funnel SQL, window delta и decision note', moduleIds: ['joins', 'dates', 'windows', 'window-frames'] }
    ],
    capstoneProjectIds: ['project-analytics-decision'],
    capstoneOutcome: 'Decision memo с cohort/funnel evidence, динамикой и ограничениями причинной интерпретации.'
  },
  {
    id: 'backend',
    learnerGoal: 'backend',
    title: 'Backend и целостность данных',
    outcome: 'Безопасно менять схему и строки, управлять транзакциями/locking и подтверждать индексные и security решения.',
    sharedPrerequisiteModuleIds,
    specialistModuleIds: ['schema', 'dml', 'transactions', 'concurrency', 'indexes', 'explain', 'sql-security', 'schema-evolution'],
    competencies: ['schema', 'DML', 'transactions', 'locking', 'indexes', 'injection', 'migrations'],
    jobTasks: [
      { id: 'backend-migration', title: 'Провести обратимую миграцию и безопасный DML backfill', evidence: 'Транзакционный SQL и проверка конечного состояния/инвариантов', moduleIds: ['schema', 'dml', 'transactions', 'schema-evolution'] },
      { id: 'backend-runtime', title: 'Разобрать locking, индекс и injection boundary', evidence: 'Concurrency trace, реальный plan evidence и параметризованный boundary', moduleIds: ['concurrency', 'indexes', 'explain', 'sql-security'] }
    ],
    capstoneProjectIds: ['project-backend-integrity'],
    capstoneOutcome: 'Безопасная status migration с final-state invariants, rollback note и engine-specific concurrency evidence.'
  },
  {
    id: 'data-engineering',
    learnerGoal: 'data-engineering',
    title: 'Data engineering',
    outcome: 'Строить воспроизводимые quality/modeling pipelines с явными входами, grain, проверками и повторным запуском.',
    sharedPrerequisiteModuleIds,
    specialistModuleIds: ['data-quality', 'schema', 'cte', 'set-ops', 'json-sql', 'transactions'],
    competencies: ['quality', 'modeling', 'pipelines', 'reproducibility'],
    jobTasks: [
      { id: 'de-quality-model', title: 'Спрофилировать источник и спроектировать доверенную модель', evidence: 'Quality checks, model grain и data contract', moduleIds: ['data-quality', 'schema', 'set-ops'] },
      { id: 'de-reproducible-pipeline', title: 'Собрать идемпотентный и воспроизводимый pipeline', evidence: 'Staged SQL, run metadata и одинаковый результат повторного запуска', moduleIds: ['cte', 'transactions', 'json-sql'] }
    ],
    capstoneProjectIds: ['project-data-trust'],
    capstoneOutcome: 'Reproducible customer-quality pipeline с public/hidden quality gates и traceable model output.'
  }
];

export function professionalTrack(trackId: ProfessionalTrackId) {
  return professionalTracks.find(track => track.id === trackId) || null;
}

export function professionalTrackForGoal(goal: LearnerGoal | null | undefined) {
  return professionalTracks.find(track => track.learnerGoal === (goal || 'full')) || professionalTracks[0];
}
