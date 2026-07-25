import {
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  Circle,
  Code2,
  Repeat2,
  ShieldCheck
} from 'lucide-react';
import type { CurriculumLesson } from '../data/complete-curriculum';
import type { CurriculumProgressV1 } from '../lib/curriculum-progress';
import {
  lessonMasteryState,
  lessonRemediation
} from '../lib/mastery-loop';
import type { Progress } from '../lib/progress';
import type { ReviewState } from '../lib/spaced-repetition';

export default function LessonMasteryPanel({
  lesson,
  progress,
  curriculum,
  reviewState,
  onOpenTask,
  onOpenReview
}: {
  lesson: CurriculumLesson;
  progress: Progress;
  curriculum: CurriculumProgressV1;
  reviewState: ReviewState;
  onOpenTask: (taskId: string) => void;
  onOpenReview: () => void;
}) {
  const mastery = lessonMasteryState(lesson, progress, curriculum, reviewState);
  const remediation = lessonRemediation(progress, lesson);
  const steps = [
    {
      id: 'study',
      title: 'Понять модель',
      detail: `${mastery.sectionsCompleted}/${mastery.sectionsTotal} раздела`,
      done: mastery.theoryComplete,
      icon: <BookOpen />
    },
    {
      id: 'check',
      title: 'Воспроизвести смысл',
      detail: mastery.checkCorrect ? 'knowledge check пройден' : 'нужен правильный ответ',
      done: mastery.checkCorrect,
      icon: <ShieldCheck />
    },
    {
      id: 'practice',
      title: 'Применить самостоятельно',
      detail: mastery.applied
        ? `${mastery.independentTaskIds.length} independent SQL evidence`
        : 'без подсказки и эталона',
      done: mastery.applied,
      icon: <Code2 />
    },
    {
      id: 'review',
      title: 'Сохранить навык',
      detail: mastery.retained
        ? `${mastery.reviewRepetitions} retrieval repetition`
        : mastery.reviewIntroduced ? 'карточка введена в расписание' : 'появится после evidence',
      done: mastery.retained,
      icon: <Repeat2 />
    }
  ];

  return <section className="lesson-mastery-loop" data-testid="lesson-mastery-loop">
    <header>
      <div><small>Mastery Loop 1.0</small><h2>Прочитать недостаточно</h2><p>Урок становится applied mastery только после правильного check и самостоятельного SQL. Retention подтверждается отдельным повторением.</p></div>
      <span className={mastery.durableMastery ? 'durable' : mastery.mastered ? 'applied' : ''}>
        {mastery.durableMastery ? 'Durable' : mastery.mastered ? 'Applied' : 'In progress'}
      </span>
    </header>

    <div className="lesson-mastery-steps">
      {steps.map((step, index) => <article className={step.done ? 'done' : mastery.nextAction === step.id ? 'current' : ''} key={step.id}>
        <span>{step.done ? <CheckCircle2 /> : step.icon || <Circle />}</span>
        <div><small>0{index + 1}</small><strong>{step.title}</strong><p>{step.detail}</p></div>
      </article>)}
    </div>

    {!mastery.mastered && <div className="lesson-mastery-next">
      <Circle /><div><strong>Следующий обязательный шаг</strong><p>{mastery.blocker}</p></div>
      {mastery.nextAction === 'practice' && mastery.nextTaskId && <button onClick={() => onOpenTask(mastery.nextTaskId)}><Code2 />Открыть independent practice</button>}
    </div>}

    {mastery.mastered && !mastery.retained && <div className="lesson-mastery-next review">
      <Repeat2 /><div><strong>Applied mastery получен</strong><p>Теперь не перечитывай урок. Дождись due-карточки и воспроизведи модель по памяти.</p></div>
      <button onClick={onOpenReview}><Repeat2 />Открыть Review Deck</button>
    </div>}

    {remediation && <div className="lesson-remediation" data-testid="lesson-remediation">
      <AlertTriangle /><div><small>Remediation priority · {remediation.count} сигналов</small><strong>{remediation.title}</strong><p>{remediation.explanation}</p><b>{remediation.nextStep}</b></div>
      {remediation.taskId && <button onClick={() => onOpenTask(remediation.taskId!)}>Повторить задачу</button>}
    </div>}
  </section>;
}
