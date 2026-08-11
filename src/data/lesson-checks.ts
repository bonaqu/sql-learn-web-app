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
type TaggedOption = {
  text: string;
  feedback: string;
  correct: boolean;
  misconceptionId: string | null;
};

function stableHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function arrangeOptions(items: TaggedOption[], id: string) {
  const correct = items.find(item => item.correct);
  if (!correct) return items;
  const distractors = items.filter(item => !item.correct);
  const distractorOffset = distractors.length ? stableHash(`${id}:distractors`) % distractors.length : 0;
  const orderedDistractors = [...distractors.slice(distractorOffset), ...distractors.slice(0, distractorOffset)];
  const targetPosition = stableHash(`${id}:answer-position`) % items.length;
  const result = [...orderedDistractors];
  result.splice(targetPosition, 0, correct);
  return result;
}

function buildCheck(input: {
  id: string;
  kind: ConceptCheckKind;
  concept: CurriculumConcept;
  question: string;
  options: TaggedOption[];
  explanation: string;
  remediation: string;
}): DiagnosticKnowledgeCheck {
  const items = arrangeOptions(input.options, input.id);
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

function shuffledCheck(input: {
  id: string;
  kind: ConceptCheckKind;
  concept: CurriculumConcept;
  question: string;
  correct: { text: string; feedback: string };
  distractors: Array<{ text: string; feedback: string; misconceptionId?: string }>;
  explanation: string;
  remediation: string;
}) {
  return buildCheck({
    ...input,
    options: [
      { ...input.correct, correct: true, misconceptionId: null },
      ...input.distractors.map(item => ({ ...item, correct: false, misconceptionId: item.misconceptionId || null }))
    ]
  });
}

function misconceptionFeedback(item: CurriculumMisconception) {
  return `Это похоже на заблуждение «${item.label}». ${item.explanation} ${item.remediation}`;
}

function enhancedOriginalCheck(lesson: CurriculumLesson, concept: CurriculumConcept): DiagnosticKnowledgeCheck {
  const misconceptions = concept.misconceptions;
  return buildCheck({
    id: lesson.check.id,
    kind: 'explanation',
    concept,
    question: lesson.check.question,
    options: lesson.check.options.map((text, index) => {
      const correct = index === lesson.check.correctIndex;
      const misconception = misconceptions[index % misconceptions.length];
      return {
        text,
        correct,
        feedback: correct ? lesson.check.explanation : misconceptionFeedback(misconception),
        misconceptionId: correct ? null : misconception.id
      };
    }),
    explanation: lesson.check.explanation,
    remediation: `Вернись к модели «${concept.title}»: ${concept.mentalModel}`
  });
}

function diagnosisCheck(lesson: CurriculumLesson, concept: CurriculumConcept): DiagnosticKnowledgeCheck {
  const [target, alternate, third] = concept.misconceptions;
  return shuffledCheck({
    id: `${lesson.id}-diagnosis-${target.id}`,
    kind: 'diagnosis',
    concept,
    question: `В уроке «${lesson.title}»: какой вывод точнее объясняет заблуждение «${target.label}»?`,
    correct: { text: target.explanation, feedback: `Верно. ${target.remediation}` },
    distractors: [
      { text: alternate.explanation, feedback: misconceptionFeedback(alternate), misconceptionId: alternate.id },
      { text: third.explanation, feedback: misconceptionFeedback(third), misconceptionId: third.id },
      {
        text: 'Проблемы нет: если SQL выполнился без exception, результат автоматически корректен.',
        feedback: `Успешное выполнение доказывает только допустимость SQL, но не правильность модели и контракта результата. ${target.remediation}`,
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
    question: `В уроке «${lesson.title}»: что лучше всего подтверждает понимание модели «${concept.title}» в новой задаче?`,
    correct: { text: concept.evidence, feedback: 'Верно: это проверяет применение модели, а не узнавание формулировки.' },
    distractors: [
      {
        text: 'Запрос выполнился без ошибки один раз на текущих данных.',
        feedback: `Это слабое подтверждение: логическая ошибка может не проявиться на текущем наборе. ${first.remediation}`,
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
    explanation: `Перенос подтверждается наблюдаемым результатом: ${concept.evidence}`,
    remediation: 'Сформулируй проверку своими словами и воспроизведи её на другом наборе данных.'
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
    question: `В уроке «${lesson.title}»: ${counterexample.prediction}`,
    correct: {
      text: counterexample.explanation,
      feedback: 'Верно. Теперь выполни оба SQL и сравни результат, а не только текст.'
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
        feedback: `Прогноз — обязательная часть проверки модели. ${item.remediation}`,
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
        : 'Ответ не объясняет проверяемую модель.'),
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
