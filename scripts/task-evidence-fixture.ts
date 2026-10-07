import {
  ADVANCED_EVIDENCE_CONTRACT_VERSION,
  ADVANCED_TASK_EVALUATION_CONTRACT_VERSION,
  advancedTaskEvaluationContract
} from '../src/data/advanced-evaluation-contracts';
import type { SqlTask } from '../src/data/course-catalog';
import { evaluationContractForTask } from '../src/data/foundation-evaluation-contracts';
import {
  FOUNDATION_EVIDENCE_CONTRACT_VERSION,
  TASK_EVALUATION_CONTRACT_VERSION
} from '../src/lib/task-evaluation-contract';
import type { TaskStats } from '../src/lib/progress';
import type { TaskEvaluationEvidence } from '../src/lib/task-evaluation-types';

export function taskContractEvidenceFixture(task: SqlTask): TaskEvaluationEvidence | undefined {
  if (!task.evaluationContractId) return undefined;
  if (task.evaluationContractId.startsWith('advanced:')) {
    const contract = advancedTaskEvaluationContract(task.evaluationContractId);
    if (!contract || contract.taskId !== task.id) throw new Error(`${task.id}: advanced evidence fixture contract is missing`);
    return {
      contractId: contract.id,
      contractVersion: ADVANCED_TASK_EVALUATION_CONTRACT_VERSION,
      evidenceContractVersion: ADVANCED_EVIDENCE_CONTRACT_VERSION,
      fixtureIds: ['public-disposable', ...contract.probes.map(probe => probe.id)],
      hiddenFixtureIds: contract.probes.map(probe => probe.id)
    };
  }
  const contract = evaluationContractForTask(task.id);
  if (!contract || contract.id !== task.evaluationContractId) throw new Error(`${task.id}: foundation evidence fixture contract is missing`);
  return {
    contractId: contract.id,
    contractVersion: TASK_EVALUATION_CONTRACT_VERSION,
    evidenceContractVersion: FOUNDATION_EVIDENCE_CONTRACT_VERSION,
    fixtureIds: contract.fixtures.map(fixture => fixture.id),
    hiddenFixtureIds: contract.fixtures.filter(fixture => fixture.visibility !== 'public').map(fixture => fixture.id)
  };
}

export function taskEvidenceFixture(task: SqlTask): Partial<TaskStats> {
  const evidence = taskContractEvidenceFixture(task);
  return evidence ? {
    evidenceContractVersion: evidence.evidenceContractVersion,
    evaluationContractId: evidence.contractId,
    evaluationContractVersion: evidence.contractVersion,
    validatedFixtureIds: evidence.fixtureIds,
    hiddenFixtureIds: evidence.hiddenFixtureIds
  } : {};
}
