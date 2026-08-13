import { assessmentItemBank } from '../src/data/assessment-blueprints.ts';
import { checkpointTaskList } from '../src/data/checkpoint-task-bank.ts';
import { interviewSessionBank } from '../src/data/interview-session-bank.ts';
import { tasks } from '../src/data/course-catalog.ts';
import { calibrationSnapshot } from '../src/lib/assessment-calibration.ts';
import { assessmentFormOverlap, selectAssessmentForm, type AssessmentSelectionReport } from '../src/lib/assessment-selection.ts';
import { evaluateInterviewExplanation, interviewProseComplete } from '../src/lib/interview-rubric.ts';
import { defaultProgress } from '../src/lib/progress.ts';

const failures: string[] = [];
const assert = (condition: unknown, message: string) => { if (!condition) failures.push(message); };
const normalizeSql = (value: string) => value
  .replace(/--[^\n]*/g, ' ')
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/\s+/g, ' ')
  .replace(/;+$/g, '')
  .trim()
  .toLowerCase();

const interviewTasks = tasks.filter(task => task.mode === 'interview' && task.evaluationContractId && task.learningContract);
const interviewIds = new Set(interviewTasks.map(task => task.id));
const nonInterviewSolutions = new Map<string, string[]>();
for (const task of [...tasks.filter(item => item.mode !== 'interview'), ...checkpointTaskList()]) {
  const key = normalizeSql(task.solution);
  nonInterviewSolutions.set(key, [...(nonInterviewSolutions.get(key) || []), task.id]);
}

assert(interviewSessionBank.length === interviewTasks.length, 'Every authored Interview task must have session metadata');
assert(interviewSessionBank.length >= 20, 'Interview bank is too small for diverse unfamiliar forms');
assert(new Set(interviewSessionBank.map(item => item.taskId)).size === interviewSessionBank.length, 'Interview session IDs must be unique');
assert(new Set(interviewSessionBank.map(item => item.pattern)).size >= 8, 'Interview bank needs at least eight reasoning patterns');
assert(new Set(interviewSessionBank.map(item => item.difficulty)).size === 4, 'Interview bank must cover all four difficulty bands');
assert(new Set(interviewSessionBank.map(item => item.originality.contextId)).size === interviewSessionBank.length, 'Interview contexts must be original');
assert(new Set(interviewSessionBank.map(item => item.originality.solutionFamily)).size === interviewSessionBank.length, 'Interview solution families must be original');
assert(assessmentItemBank.filter(item => item.eligibleModes.includes('interview')).every(item => interviewIds.has(item.taskId)), 'Interview simulation still reuses practice tasks');

const forms = Array.from({ length: 4 }, (_, index) => {
  const reports: AssessmentSelectionReport[] = Array.from({ length: index }, (__, reportIndex) => ({
    mode: 'interview',
    status: 'abandoned',
    completedAt: `2026-08-13T10:0${reportIndex}:00.000Z`,
    taskScores: []
  }));
  return selectAssessmentForm({
    mode: 'interview',
    progress: defaultProgress,
    userId: 'phase10-interview-forms-000000000001',
    reports,
    calibration: calibrationSnapshot([])
  });
});
assert(new Set(forms.flatMap(form => form.tasks.map(task => task.id))).size === interviewSessionBank.length, 'Four Interview forms must use the full authored bank without task reuse');
for (const form of forms) {
  assert(form.tasks.length === 5 && form.distinctModules === 5 && form.distinctSkills === 5, `${form.formId}: Interview form is not sufficiently diverse`);
}
for (let left = 0; left < forms.length; left += 1) {
  for (let right = left + 1; right < forms.length; right += 1) {
    assert(assessmentFormOverlap(forms[left].tasks, forms[right].tasks) === 0, `${forms[left].formId}/${forms[right].formId}: Interview tasks are reused`);
  }
}

for (const session of interviewSessionBank) {
  const task = interviewTasks.find(item => item.id === session.taskId);
  assert(Boolean(task), `${session.taskId}: session is not backed by an authored Interview task`);
  if (!task) continue;
  assert(Boolean(task.evaluationContractId), `${task.id}: hidden deterministic contract is missing`);
  assert(task.evaluationContractId === session.hiddenContractId, `${task.id}: session contract drifted`);
  assert(task.learningContract?.contextId === session.originality.contextId, `${task.id}: original context is not pinned`);
  assert(task.learningContract?.solutionFamily === session.originality.solutionFamily, `${task.id}: solution family is not pinned`);
  assert(!nonInterviewSolutions.has(normalizeSql(task.solution)), `${task.id}: normalized solution duplicates ${nonInterviewSolutions.get(normalizeSql(task.solution))?.join(', ')}`);
  assert(session.timing.learningMode === 'untimed-default', `${task.id}: learning timing is not optional/untimed`);
  assert(session.timing.simulationMode === 'bounded-35-minutes', `${task.id}: simulation timing is not bounded`);
  assert(session.timing.resumePolicy === 'persist-deadline-and-answers', `${task.id}: timed resume policy is missing`);
  assert(session.rubric.proseAuthority === 'human-review-required', `${task.id}: prose can be mistaken for AI authority`);
}

const completeInput = {
  explanation: 'Одна строка соответствует целевой сущности; сначала фиксируется grain, затем фильтр и стабильный порядок.',
  alternative: 'Альтернатива — CTE; она читаемее, но добавляет этап.',
  edgeCases: 'NULL, дубли и одинаковые значения sort key требуют явной обработки.'
};
assert(interviewProseComplete(completeInput), 'Complete explanation rubric was rejected');
const reviewed = evaluateInterviewExplanation(completeInput, true, true);
assert(reviewed.complete && reviewed.reviewStatus === 'awaiting-human-review' && reviewed.proseScore === null, 'Prose rubric must separate completeness from human review');
const missing = evaluateInterviewExplanation({ explanation: 'short' }, true, true);
assert(!missing.complete && missing.reviewStatus === 'missing' && missing.proseScore === null, 'Missing prose must remain visible without an invented score');

if (failures.length) {
  console.error(`Interview session validation failed with ${failures.length} issue(s):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

const patternMatrix = Object.entries(Object.groupBy(interviewSessionBank, item => item.pattern))
  .map(([pattern, items]) => `${pattern}:${items?.length || 0}`)
  .join(', ');
console.log(`Interview sessions validated: ${interviewSessionBank.length} original tasks in four non-overlapping forms, ${new Set(interviewSessionBank.map(item => item.pattern)).size} reasoning patterns, four difficulty bands, hidden contracts, untimed learning, bounded resumable simulation and human-review prose rubric. ${patternMatrix}`);
