export const INTERVIEW_PROSE_LIMITS = {
  explanation: { minimum: 40, maximum: 1_200 },
  alternative: { minimum: 20, maximum: 800 },
  edgeCases: { minimum: 20, maximum: 800 }
} as const;

export type InterviewProseInput = {
  explanation?: string;
  alternative?: string;
  edgeCases?: string;
};

export type InterviewExplanationRubric = {
  deterministicSqlPassed: boolean;
  explanationSubmitted: boolean;
  alternativeSubmitted: boolean;
  edgeCasesSubmitted: boolean;
  complete: boolean;
  reviewStatus: 'not-required' | 'missing' | 'awaiting-human-review';
  proseScore: null;
  authority: 'deterministic-sql-plus-human-prose-review';
};

function submitted(value: string | undefined, minimum: number) {
  return String(value || '').trim().length >= minimum;
}

export function interviewProseComplete(input: InterviewProseInput) {
  return submitted(input.explanation, INTERVIEW_PROSE_LIMITS.explanation.minimum)
    && submitted(input.alternative, INTERVIEW_PROSE_LIMITS.alternative.minimum)
    && submitted(input.edgeCases, INTERVIEW_PROSE_LIMITS.edgeCases.minimum);
}

export function evaluateInterviewExplanation(
  input: InterviewProseInput,
  deterministicSqlPassed: boolean,
  required: boolean
): InterviewExplanationRubric {
  if (!required) {
    return {
      deterministicSqlPassed,
      explanationSubmitted: false,
      alternativeSubmitted: false,
      edgeCasesSubmitted: false,
      complete: true,
      reviewStatus: 'not-required',
      proseScore: null,
      authority: 'deterministic-sql-plus-human-prose-review'
    };
  }
  const explanationSubmitted = submitted(input.explanation, INTERVIEW_PROSE_LIMITS.explanation.minimum);
  const alternativeSubmitted = submitted(input.alternative, INTERVIEW_PROSE_LIMITS.alternative.minimum);
  const edgeCasesSubmitted = submitted(input.edgeCases, INTERVIEW_PROSE_LIMITS.edgeCases.minimum);
  const complete = explanationSubmitted && alternativeSubmitted && edgeCasesSubmitted;
  return {
    deterministicSqlPassed,
    explanationSubmitted,
    alternativeSubmitted,
    edgeCasesSubmitted,
    complete,
    reviewStatus: complete ? 'awaiting-human-review' : 'missing',
    proseScore: null,
    authority: 'deterministic-sql-plus-human-prose-review'
  };
}
