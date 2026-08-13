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
import '../concept-checks.css';

export default function LessonMasteryPanel({
  lesson,
  progress,
  curriculum,
  reviewState,
  onProgress,
  onOpenTask,
  onOpenReview
}: {
  lesson: CurriculumLesson;
  progress: Progress;
  curriculum: CurriculumProgressV1;
  reviewState: ReviewState;
  onProgress: (progress: CurriculumProgressV1) => void;
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
  const updateCurriculum = (next: CurriculumProgressV1) => {
    setCurrentCurriculum(next);
    onProgress(next);
  };
  const nextPracticeTaskId = mastery.nextTaskId;
  const steps = [
    { id: 'study', title: 'Понять модель', detail: `${mastery.sectionsCompleted}/${mastery.sectionsTotal} раздела`, done: mastery.theoryComplete, icon: <BookOpen /> },
    { id: 'check', title: 'Предсказать и объяснить', detail: mastery.checkCorrect ? `${mastery.checksCompleted}/${mastery.checksTotal} вопроса` : `готово ${mastery.checksCompleted}/${mastery.checksTotal}`, done: mastery.checkCorrect, icon: <ShieldCheck /> },
    { id: 'practice', title: 'Применить самостоятельно', detail: mastery.applied ? `${mastery.independentTaskIds.length} самостоятельных решения` : 'без подсказки и эталона', done: mastery.applied, icon: <Code2 /> },
    { id: 'review', title: 'Сохранить навык', detail: mastery.retained ? `${mastery.reviewRepetitions} повторения по памяти` : mastery.reviewIntroduced ? 'карточка добавлена в расписание' : 'появится после самостоятельного решения', done: mastery.retained, icon: <Repeat2 /> }
  ];

  return <>
    <ConceptCheckPanel lesson={lesson} curriculum={currentCurriculum} onProgress={updateCurriculum} />
    <section className="lesson-mastery-loop" data-testid="lesson-mastery-loop">
      <header><div><small>Путь к уверенному навыку</small><h2>Узнавания ответа недостаточно</h2><p>Ответь на вопросы, реши SQL самостоятельно и позже воспроизведи модель по памяти. Один тест не завершает урок.</p></div><span className={mastery.durableMastery ? 'durable' : mastery.mastered ? 'applied' : ''}>{mastery.durableMastery ? 'Навык сохранён' : mastery.mastered ? 'Получилось самостоятельно' : 'В процессе'}</span></header>
      <div className="lesson-mastery-steps">{steps.map((step, index) => <article className={step.done ? 'done' : mastery.nextAction === step.id ? 'current' : ''} key={step.id}><span>{step.done ? <CheckCircle2 /> : step.icon || <Circle />}</span><div><small>0{index + 1}</small><strong>{step.title}</strong><p>{step.detail}</p></div></article>)}</div>
      {!mastery.mastered && <div className="lesson-mastery-next"><Circle /><div><strong>Следующий обязательный шаг</strong><p>{mastery.blocker}</p></div>{mastery.nextAction === 'practice' && nextPracticeTaskId && <button onClick={() => onOpenTask(nextPracticeTaskId)}><Code2 />Открыть самостоятельную задачу</button>}</div>}
      {mastery.mastered && !mastery.retained && <div className="lesson-mastery-next review"><Repeat2 /><div><strong>Самостоятельное решение получено</strong><p>Прочное освоение пока не подтверждено. Когда подойдёт срок, реши связанную, но другую SQL-задачу без подсказки; карточка помогает запомнить модель, но не заменяет исполняемую проверку.</p></div><button onClick={onOpenReview}><Repeat2 />Открыть повторение</button></div>}
      {remediation && <div className="lesson-remediation" data-testid="lesson-remediation"><AlertTriangle /><div><small>Точечное повторение · {remediation.count} сигналов{remediation.conceptTitle ? ` · ${remediation.conceptTitle}` : ''}</small><strong>{remediation.title}</strong><p>{remediation.explanation}</p><b>{remediation.nextStep}</b></div>{remediation.taskId && <button onClick={() => onOpenTask(remediation.taskId!)}>Повторить задачу</button>}</div>}
    </section>
  </>;
}
