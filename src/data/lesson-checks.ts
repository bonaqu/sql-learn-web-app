import type { CurriculumLesson, KnowledgeCheck } from './complete-curriculum';
import {
  conceptsForModule,
  type ConceptCheckKind,
  type CurriculumConcept,
  type CurriculumMisconception
} from './concept-inventory';

export interface DiagnosticKnowledgeCheck extends KnowledgeCheck {
  kind: ConceptCheckKind;
  conceptId: string;
  required: boolean;
  optionFeedback: string[];
  misconceptionIds: Array<string | null>;
  remediation: string;
}

type AnswerLike = { correct?: boolean } | undefined;

function stableHash(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  return hash;
}

function rotate<T>(values: T[], offset: number) {
  if (!values.length) return values;
  const normalized = ((offset % values.length) + values.length) % values.length;
  return [...values.slice(normalized), ...values.slice(0, normalized)];
}

function shuffledCheck(input: {
  id: string;
  kind: ConceptCheckKind;
  concept: CurriculumConcept;
  question: string;
  correct: { text: string; feedback: string };
  distractors: Array<{ text: string; feedback: string; misconceptionId?: string }>;
  explanation: string;
  remediation: string;
}): DiagnosticKnowledgeCheck {
  const tagged = [
    { ...input.correct, correct: true, misconceptionId: null as string | null },
    ...input.distractors.map(item => ({ ...item, correct: false, misconceptionId: item.misconceptionId || null }))
  ];
  const items = rotate(tagged, stableHash(input.id) % tagged.length);
  return {
    id: input.id,
    kind: input.kind,
    conceptId: input.concept.id,
    required: true,
    question: input.question,
    options: items.map(item => item.text),
    correctIndex: items.findIndex(item => item.correct),
    explanation: input.explanation,
    optionFeedback: items.map(item => item.feedback),
    misconceptionIds: items.map(item => item.misconceptionId),
    remediation: input.remediation
  };
}

function misconceptionFeedback(item: CurriculumMisconception) {
  return `Это соответствует misconception «${item.label}». ${item.explanation} ${item.remediation}`;
}

function enhancedOriginalCheck(lesson: CurriculumLesson, concept: CurriculumConcept): DiagnosticKnowledgeCheck {
  const misconceptions = concept.misconceptions;
  return {
    ...lesson.check,
    kind: 'explanation',
    conceptId: concept.id,
    required: true,
    optionFeedback: lesson.check.options.map((_, index) => {
      if (index === lesson.check.correctIndex) return lesson.check.explanation;
      return misconceptionFeedback(misconceptions[index % misconceptions.length]);
    }),
    misconceptionIds: lesson.check.options.map((_, index) => index === lesson.check.correctIndex
      ? null
      : misconceptions[index % misconceptions.length].id),
    remediation: `Вернись к mental model «${concept.title}»: ${concept.mentalModel}`
  };
}

function diagnosisCheck(lesson: CurriculumLesson, concept: CurriculumConcept): DiagnosticKnowledgeCheck {
  const [target, alternate, third] = concept.misconceptions;
  return shuffledCheck({
    id: `${lesson.id}-diagnosis-${target.id}`,
    kind: 'diagnosis',
    concept,
    question: `Какой вывод точнее диагностирует заблуждение «${target.label}»?`,
    correct: {
      text: target.explanation,
      feedback: `Верно. ${target.remediation}`
    },
    distractors: [
      {
        text: alternate.explanation,
        feedback: misconceptionFeedback(alternate),
        misconceptionId: alternate.id
      },
      {
        text: third.explanation,
        feedback: misconceptionFeedback(third),
        misconceptionId: third.id
      },
      {
        text: 'Проблемы нет: если SQL выполнился без exception, результат автоматически корректен.',
        feedback: `Успешное выполнение доказывает только допустимость SQL, но не mental model и не контракт результата. ${target.remediation}`,
        misconceptionId: target.id
      }
    ],
    explanation: `${target.explanation} Исправление: ${target.remediation}`,
    remediation: target.remediation
  });
}

function transferCheck(lesson: CurriculumLesson, concept: CurriculumConcept): DiagnosticKnowledgeCheck {
  const [first, second, third] = concept.misconceptions;
  return shuffledCheck({
    id: `${lesson.id}-transfer-${concept.id}`,
    kind: 'transfer',
    concept,
    question: `Какое evidence лучше всего подтверждает mental model «${concept.title}» в новой задаче?`,
    correct: {
      text: concept.evidence,
      feedback: `Верно: это проверяет перенос модели, а не узнавание формулировки.`
    },
    distractors: [
      {
        text: 'Запрос выполнился без ошибки один раз на текущих данных.',
        feedback: `Это слабое evidence: логическая ошибка может не проявиться на текущем наборе. ${first.remediation}`,
        misconceptionId: first.id
      },
      {
        text: `В запрос добавлен DISTINCT, поэтому ${second.label.toLowerCase()} больше не важно.`,
        feedback: misconceptionFeedback(second),
        misconceptionId: second.id
      },
      {
        text: 'Решение похоже на пример из урока, даже если нельзя объяснить гранулярность и граничные случаи.',
        feedback: misconceptionFeedback(third),
        misconceptionId: third.id
      }
    ],
    explanation: `Transfer подтверждается наблюдаемым evidence: ${concept.evidence}`,
    remediation: `Сформулируй проверку своими словами и воспроизведи её на другом наборе данных.`
  });
}

function predictionCheck(lesson: CurriculumLesson, concept: CurriculumConcept, item: CurriculumMisconception): DiagnosticKnowledgeCheck | null {
  const counterexample = item.counterexample;
  if (!counterexample) return null;
  const alternate = concept.misconceptions.find(candidate => candidate.id !== item.id) || item;
  return shuffledCheck({
    id: `${lesson.id}-prediction-${item.id}`,
    kind: 'prediction',
    concept,
    question: counterexample.prediction,
    correct: {
      text: counterexample.explanation,
      feedback: `Верно. Теперь выполни оба SQL и сравни результат, а не только текст.`
    },
    distractors: [
      {
        text: 'Оба запроса эквивалентны, потому что используют те же таблицы.',
        feedback: misconceptionFeedback(item),
        misconceptionId: item.id
      },
      {
        text: 'Разница относится только к производительности, но не к набору строк или значениям.',
        feedback: misconceptionFeedback(alternate),
        misconceptionId: alternate.id
      },
      {
        text: 'Правильный ответ нельзя предсказать до запуска SQL.',
        feedback: `Prediction — обязательная часть проверки mental model. ${item.remediation}`,
        misconceptionId: item.id
      }
    ],
    explanation: counterexample.explanation,
    remediation: item.remediation
  });
}

export function lessonChecks(lesson: CurriculumLesson): DiagnosticKnowledgeCheck[] {
  const concept = conceptsForModule(lesson.module)[0];
  if (!concept) {
    return [{
      ...lesson.check,
      kind: 'explanation',
      conceptId: lesson.module,
      required: true,
      optionFeedback: lesson.check.options.map((_, index) => index === lesson.check.correctIndex
        ? lesson.check.explanation
        : 'Ответ не объясняет проверяемый mental model.'),
      misconceptionIds: lesson.check.options.map(() => null),
      remediation: lesson.check.explanation
    }];
  }
  const prediction = concept.misconceptions.map(item => predictionCheck(lesson, concept, item)).find(Boolean);
  return [
    enhancedOriginalCheck(lesson, concept),
    ...(prediction ? [prediction] : []),
    diagnosisCheck(lesson, concept),
    transferCheck(lesson, concept)
  ];
}

export function requiredLessonCheckIds(lesson: CurriculumLesson) {
  return lessonChecks(lesson).filter(check => check.required).map(check => check.id);
}

export function lessonChecksComplete(lesson: CurriculumLesson, answers: Record<string, AnswerLike>) {
  return requiredLessonCheckIds(lesson).every(id => Boolean(answers[id]?.correct));
}

export function lessonCheckProgress(lesson: CurriculumLesson, answers: Record<string, AnswerLike>) {
  const checks = lessonChecks(lesson).filter(check => check.required);
  const completed = checks.filter(check => answers[check.id]?.correct).length;
  return { completed, total: checks.length, complete: completed === checks.length };
}

export function allKnownLessonChecks(lessons: CurriculumLesson[]) {
  return lessons.flatMap(lesson => lessonChecks(lesson));
}
