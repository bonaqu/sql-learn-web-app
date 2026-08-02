import {
  ArrowRight,
  BookOpen,
  CheckCircle2,
  ClipboardCheck,
  Link2,
  Play,
  Route
} from 'lucide-react';
import { curriculumCheckpoints } from '../data/complete-curriculum';
import {
  transitionIntoLesson,
  transitionOutOfLesson,
  type LessonTransition
} from '../data/lesson-bridges';
import { tasks } from '../data/course-catalog';
import { openAcademyCheckpoint, openAcademyTask } from '../lib/academy-navigation';
import '../lesson-continuity.css';

type LessonContinuityPanelProps = {
  lessonId: string;
  direction: 'incoming' | 'outgoing';
  onOpenLesson: (lessonId: string) => void;
};

function transitionKindLabel(transition: LessonTransition) {
  if (transition.kind === 'phase') return 'Граница фазы';
  if (transition.kind === 'within-module') return 'Углубление модуля';
  return 'Связь модулей';
}

function IncomingPanel({ transition }: { transition: LessonTransition }) {
  return <section className="lesson-continuity incoming" data-testid="lesson-continuity-incoming">
    <header>
      <span><Link2 /></span>
      <div><small>{transitionKindLabel(transition)} · связь с прошлым</small><h2>{transition.fromTitle} → {transition.toTitle}</h2></div>
    </header>
    <div className="lesson-continuity-grid">
      <article><CheckCircle2 /><div><strong>Что сохраняем</strong><p>{transition.carryForward}</p></div></article>
      <article><Route /><div><strong>Почему идём дальше</strong><p>{transition.limitation}</p></div></article>
      <article><BookOpen /><div><strong>Новая модель</strong><p>{transition.newMentalModel}</p></div></article>
    </div>
  </section>;
}

function EntryPanel() {
  return <section className="lesson-continuity incoming entry" data-testid="lesson-continuity-entry">
    <header><span><Route /></span><div><small>Точка входа · SQL с нуля</small><h2>Сначала научись описывать результат, потом писать синтаксис</h2></div></header>
    <div className="lesson-continuity-grid">
      <article><CheckCircle2 /><div><strong>Начальная опора</strong><p>Не требуется помнить команды SQL: начни с вопроса, какие строки и столбцы должен увидеть пользователь.</p></div></article>
      <article><Route /><div><strong>Почему это важно</strong><p>Синтаксически корректный запрос может быть логически неверным, если заранее не определён контракт результата.</p></div></article>
      <article><BookOpen /><div><strong>Первая модель</strong><p>Запрос — это преобразование исходных таблиц в проверяемый набор строк с известной гранулярностью.</p></div></article>
    </div>
  </section>;
}

function OutgoingPanel({ transition, onOpenLesson }: {
  transition: LessonTransition;
  onOpenLesson: (lessonId: string) => void;
}) {
  const task = transition.practiceTaskId
    ? tasks.find(item => item.id === transition.practiceTaskId) || null
    : null;
  const checkpoint = transition.checkpointId
    ? curriculumCheckpoints.find(item => item.id === transition.checkpointId) || null
    : null;

  return <section className={`lesson-continuity outgoing ${transition.kind}`} data-testid="lesson-continuity-outgoing">
    <header>
      <span>{checkpoint ? <ClipboardCheck /> : <ArrowRight />}</span>
      <div><small>{checkpoint ? 'Сначала checkpoint фазы' : 'Следующая ступень'}</small><h2>{transition.toTitle}</h2></div>
    </header>
    <p className="lesson-continuity-evidence"><strong>Как закрепить переход:</strong> {transition.evidencePrompt}</p>
    <div className="lesson-continuity-actions">
      {checkpoint && <button type="button" className="primary" onClick={() => openAcademyCheckpoint(checkpoint.id)}>
        <ClipboardCheck />Открыть checkpoint «{checkpoint.title}»
      </button>}
      {task && <button type="button" onClick={() => openAcademyTask(task.id)}><Play />Практика: {task.title}</button>}
      <button type="button" onClick={() => onOpenLesson(transition.toLessonId)}><BookOpen />Перейти к уроку<ArrowRight /></button>
    </div>
  </section>;
}

export default function LessonContinuityPanel({ lessonId, direction, onOpenLesson }: LessonContinuityPanelProps) {
  if (direction === 'incoming') {
    const transition = transitionIntoLesson(lessonId);
    return transition ? <IncomingPanel transition={transition} /> : <EntryPanel />;
  }
  const transition = transitionOutOfLesson(lessonId);
  return transition ? <OutgoingPanel transition={transition} onOpenLesson={onOpenLesson} /> : null;
}
