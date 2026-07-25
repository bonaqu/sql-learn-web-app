import { useEffect, useState } from 'react';
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
import {
  CURRICULUM_PROGRESS_CHANGED_EVENT,
  loadCurriculumProgress,
  type CurriculumProgressV1
} from '../lib/curriculum-progress';
import {
  lessonMasteryState,
  lessonRemediation
} from '../lib/mastery-loop';
import type { Progress } from '../lib/progress';
import type { ReviewState } from '../lib/spaced-repetition';
import ConceptCheckPanel from './ConceptCheckPanel';

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
  const [currentCurriculum, setCurrentCurriculum] = useState(curriculum);

  useEffect(() => setCurrentCurriculum(curriculum), [curriculum]);
  useEffect(() => {
    const update = () => setCurrentCurriculum(loadCurriculumProgress());
    window.addEventListener(CURRICULUM_PROGRESS_CHANGED_EVENT, update);
    return () => window.removeEventListener(CURRICULUM_PROGRESS_CHANGED_EVENT, update);
  }, []);

  const mastery = lessonMasteryState(lesson, progress, currentCurriculum, reviewState);
  const remediation = lessonRemediation(progress, lesson);
  const nextPracticeTaskId = mastery.nextTaskId;
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
      title: 'Предсказать и объяснить',
      detail: mastery.checkCorrect
        ? `${mastery.checksCompleted}/${mastery.checksTotal} concept checks`
        : `нужно ${mastery.checksCompleted}/${mastery.checksTotal}`,
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

  return <>
    <ConceptCheckPanel lesson={lesson} curriculum={currentCurriculum} onProgress={setCurrentCurriculum} />

    <section className="lesson-mastery-loop" data-testid="lesson-mastery-loop">
      <header>
        <div><small>Mastery Loop 1.1</small><h2>Узнавание ответа недостаточно</h2><p>Applied mastery требует всех concept checks, самостоятельного SQL и последующего retrieval review. Один старый MCQ больше не завершает урок.</p></div>
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
        {mastery.nextAction === 'practice' && nextPracticeTaskId && <button onClick={() => onOpenTask(nextPracticeTaskId)}><Code2 />Открыть independent practice</button>}
      </div>}

      {mastery.mastered && !mastery.retained && <div className="lesson-mastery-next review">
        <Repeat2 /><div><strong>Applied mastery получен</strong><p>Теперь не перечитывай урок. Дождись due-карточки и воспроизведи модель по памяти.</p></div>
        <button onClick={onOpenReview}><Repeat2 />Открыть Review Deck</button>
      </div>}

      {remediation && <div className="lesson-remediation" data-testid="lesson-remediation">
        <AlertTriangle /><div><small>Targeted remediation · {remediation.count} сигналов{remediation.conceptTitle ? ` · ${remediation.conceptTitle}` : ''}</small><strong>{remediation.title}</strong><p>{remediation.explanation}</p><b>{remediation.nextStep}</b></div>
        {remediation.taskId && <button onClick={() => onOpenTask(remediation.taskId!)}>Повторить задачу</button>}
      </div>}
    </section>
  </>;
}
