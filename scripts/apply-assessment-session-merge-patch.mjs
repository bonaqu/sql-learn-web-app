import { readFileSync, writeFileSync } from 'node:fs';

const file = new URL('../src/lib/assessment.ts', import.meta.url);
const source = readFileSync(file, 'utf8');

const before = `export function updateAssessmentAnswer(session: AssessmentSession, taskId: string, patch: Partial<AssessmentAnswer>) {
  const previous = session.answers[taskId];
  if (!previous) return session;
  return saveAssessmentSession({
    ...session,
    answers: { ...session.answers, [taskId]: { ...previous, ...patch } }
  });
}`;

const after = `export function mergeAssessmentAnswer(previous: AssessmentAnswer, patch: Partial<AssessmentAnswer>) {
  const timerOnlyPatch = patch.elapsedSeconds !== undefined
    && patch.attempts === undefined
    && patch.incorrect === undefined
    && patch.correct === undefined
    && patch.skipped === undefined
    && patch.interviewerUses === undefined;
  const requestedElapsed = patch.elapsedSeconds ?? previous.elapsedSeconds;
  return {
    ...previous,
    ...patch,
    attempts: Math.max(previous.attempts, patch.attempts ?? previous.attempts),
    incorrect: Math.max(previous.incorrect, patch.incorrect ?? previous.incorrect),
    interviewerUses: Math.max(previous.interviewerUses, patch.interviewerUses ?? previous.interviewerUses),
    elapsedSeconds: timerOnlyPatch
      ? Math.max(previous.elapsedSeconds + 5, requestedElapsed)
      : Math.max(previous.elapsedSeconds, requestedElapsed),
    correct: previous.correct || patch.correct === true,
    skipped: patch.skipped ?? previous.skipped,
    completedAt: patch.completedAt || previous.completedAt
  } satisfies AssessmentAnswer;
}

export function updateAssessmentAnswer(session: AssessmentSession, taskId: string, patch: Partial<AssessmentAnswer>) {
  const stored = loadAssessmentSession(session.userId);
  const base = stored?.id === session.id ? stored : session;
  const previous = base.answers[taskId];
  if (!previous) return base;
  return saveAssessmentSession({
    ...base,
    answers: { ...base.answers, [taskId]: mergeAssessmentAnswer(previous, patch) }
  });
}`;

if (source.includes('export function mergeAssessmentAnswer(')) {
  console.log('Assessment merge patch is already applied.');
  process.exit(0);
}

const occurrences = source.split(before).length - 1;
if (occurrences !== 1) throw new Error(`Expected one updateAssessmentAnswer implementation, found ${occurrences}.`);
writeFileSync(file, source.replace(before, after));
console.log('Applied monotonic assessment session merge.');
