import { assessmentItem, type AssessmentDifficultyBand, type AssessmentReasoningSkill } from './assessment-blueprints';
import { tasks } from './course-catalog';

export type InterviewReasoningPattern =
  | 'contract-first'
  | 'counterexample'
  | 'grain-and-cardinality'
  | 'decomposition'
  | 'boundary-analysis'
  | 'safe-change'
  | 'plan-evidence'
  | 'threat-model'
  | 'incident-hypothesis';

export type InterviewSessionDefinition = {
  taskId: string;
  hiddenContractId: string;
  reasoningSkill: AssessmentReasoningSkill;
  pattern: InterviewReasoningPattern;
  difficulty: AssessmentDifficultyBand;
  timing: {
    learningMode: 'untimed-default';
    simulationMode: 'bounded-35-minutes';
    resumePolicy: 'persist-deadline-and-answers';
  };
  rubric: {
    explanationPrompt: string;
    alternativePrompt: string;
    edgeCasesPrompt: string;
    proseAuthority: 'human-review-required';
  };
  originality: {
    contextId: string;
    solutionFamily: string;
    source: 'sql-academy-authored';
  };
};

const patternBySkill: Record<AssessmentReasoningSkill, InterviewReasoningPattern> = {
  'result-contract': 'contract-first',
  'row-selection': 'counterexample',
  aggregation: 'grain-and-cardinality',
  relationships: 'grain-and-cardinality',
  'query-structure': 'decomposition',
  'time-series': 'boundary-analysis',
  'data-shaping': 'counterexample',
  'safe-write': 'safe-change',
  performance: 'plan-evidence',
  security: 'threat-model',
  operations: 'incident-hypothesis'
};

export const interviewSessionBank: readonly InterviewSessionDefinition[] = tasks
  .filter(task => task.mode === 'interview' && task.evaluationContractId && task.learningContract)
  .map(task => {
    const item = assessmentItem(task.id);
    if (!item || !task.evaluationContractId || !task.learningContract) {
      throw new Error(`Interview task ${task.id} is missing its authored assessment contract`);
    }
    return {
      taskId: task.id,
      hiddenContractId: task.evaluationContractId,
      reasoningSkill: item.reasoningSkill,
      pattern: patternBySkill[item.reasoningSkill],
      difficulty: item.difficultyBand,
      timing: {
        learningMode: 'untimed-default',
        simulationMode: 'bounded-35-minutes',
        resumePolicy: 'persist-deadline-and-answers'
      },
      rubric: {
        explanationPrompt: 'Кратко объясни grain результата, порядок шагов и почему запрос выполняет контракт.',
        alternativePrompt: 'Назови один рабочий альтернативный подход и его компромисс.',
        edgeCasesPrompt: 'Зафиксируй NULL, дубли, ties или границу времени, способную изменить ответ.',
        proseAuthority: 'human-review-required'
      },
      originality: {
        contextId: task.learningContract.contextId,
        solutionFamily: task.learningContract.solutionFamily,
        source: 'sql-academy-authored'
      }
    };
  });

const sessionByTaskId = new Map(interviewSessionBank.map(item => [item.taskId, item]));

export function interviewSessionForTask(taskId: string) {
  return sessionByTaskId.get(taskId) || null;
}
