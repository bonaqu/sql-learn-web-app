import { concurrencyAuthoredTaskEvidence } from './advanced-authored-concurrency';
import { conditionalAggregationAuthoredTaskEvidence } from './advanced-authored-conditional-aggregation';
import { advancedAuthoredTaskEvidence } from './advanced-authored-content';
import { incidentInvestigationAuthoredTaskEvidence } from './advanced-authored-incident-investigation';
import { advancedJoinsAuthoredTaskEvidence } from './advanced-authored-joins';
import { jsonSqlAuthoredTaskEvidence } from './advanced-authored-json-sql';
import { nullLogicAuthoredTaskEvidence } from './advanced-authored-null-logic';
import { paginationAuthoredTaskEvidence } from './advanced-authored-pagination';
import { recursiveCteAuthoredTaskEvidence } from './advanced-authored-recursive-cte';
import { schemaEvolutionAuthoredTaskEvidence } from './advanced-authored-schema-evolution';
import { sqlSecurityAuthoredTaskEvidence } from './advanced-authored-sql-security';
import { windowFramesAuthoredTaskEvidence } from './advanced-authored-window-frames';
import type { SqlTask } from './course';
import {
  ADVANCED_EVIDENCE_CONTRACT_VERSION,
  ADVANCED_TASK_EVALUATION_CONTRACT_VERSION
} from '../lib/task-evaluation-types';

export {
  ADVANCED_EVIDENCE_CONTRACT_VERSION,
  ADVANCED_TASK_EVALUATION_CONTRACT_VERSION
};

export type AdvancedEvaluationProbeKind = 'state-variation' | 'adversarial-reduction';
export const fixedInputAdvancedTaskIds = ['task-141', 'task-171', 'task-229'] as const;

export type AdvancedTaskEvaluationContract = {
  version: typeof ADVANCED_TASK_EVALUATION_CONTRACT_VERSION;
  id: string;
  taskId: string;
  inputPolicy: 'varied-input' | 'fixed-input';
  evidenceTags: string[];
  probes: Array<{
    id: string;
    label: string;
    visibility: 'hidden' | 'adversarial';
    kind: AdvancedEvaluationProbeKind;
  }>;
};

const authoredEvidence: Readonly<Record<string, readonly string[]>> = {
  ...advancedAuthoredTaskEvidence,
  ...schemaEvolutionAuthoredTaskEvidence,
  ...nullLogicAuthoredTaskEvidence,
  ...conditionalAggregationAuthoredTaskEvidence,
  ...advancedJoinsAuthoredTaskEvidence,
  ...recursiveCteAuthoredTaskEvidence,
  ...windowFramesAuthoredTaskEvidence,
  ...jsonSqlAuthoredTaskEvidence,
  ...sqlSecurityAuthoredTaskEvidence,
  ...concurrencyAuthoredTaskEvidence,
  ...paginationAuthoredTaskEvidence,
  ...incidentInvestigationAuthoredTaskEvidence
};

export const advancedTaskEvaluationContracts: readonly AdvancedTaskEvaluationContract[] = Object.entries(authoredEvidence)
  .map(([taskId, evidenceTags]) => ({
    version: ADVANCED_TASK_EVALUATION_CONTRACT_VERSION,
    id: `advanced:${taskId}`,
    taskId,
    inputPolicy: fixedInputAdvancedTaskIds.some(id => id === taskId) ? 'fixed-input' as const : 'varied-input' as const,
    evidenceTags: [...evidenceTags],
    probes: fixedInputAdvancedTaskIds.some(id => id === taskId) ? [] : [
      {
        id: `${taskId}:hidden-state-variation`,
        label: 'Скрытая вариация данных',
        visibility: 'hidden' as const,
        kind: 'state-variation' as const
      },
      {
        id: `${taskId}:adversarial-reduction`,
        label: 'Контрпример с сокращённым состоянием',
        visibility: 'adversarial' as const,
        kind: 'adversarial-reduction' as const
      }
    ]
  }))
  .sort((left, right) => left.taskId.localeCompare(right.taskId));

const contractsById = new Map(advancedTaskEvaluationContracts.map(contract => [contract.id, contract]));

export function advancedTaskEvaluationContract(id: string) {
  return contractsById.get(id) || null;
}

export function applyAdvancedEvaluationContracts(source: readonly SqlTask[]): SqlTask[] {
  return source.map(task => {
    const contract = contractsById.get(`advanced:${task.id}`);
    return contract ? { ...task, evaluationContractId: contract.id } : task;
  });
}
