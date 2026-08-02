import { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Compass,
  ListChecks,
  RefreshCw,
  Route,
  Settings2,
  Sparkles,
  Target
} from 'lucide-react';
import { curriculumCheckpoints } from '../data/complete-curriculum';
import { type SqlTask, TOTAL_TASK_COUNT } from '../data/course-catalog';
import { openJourneyDestination } from '../lib/academy-navigation';
import {
  ASSESSMENT_REPORTS_CHANGED_EVENT,
  loadLocalAssessmentReports
} from '../lib/assessment';
import {
  bestCheckpointReport,
  CHECKPOINT_REPORTS_CHANGED_EVENT,
  legacyCheckpointPassed,
  loadLocalCheckpointReports
} from '../lib/checkpoints';
import {
  CURRICULUM_PROGRESS_CHANGED_EVENT,
  loadCurriculumProgress
} from '../lib/curriculum-progress';
import {
  goalOptions,
  loadOnboardingProfile,
  ONBOARDING_CHANGED_EVENT,
  onboardingReady,
  studyDayLabels,
  type WeekPlanItem
} from '../lib/learner-onboarding';
import { nextJourneyAction } from '../lib/learning-journey';
import type { Progress } from '../lib/progress';

type GuidedHomeProps = {
  progress: Progress;
  reviewCount: number;
  onStartTask: (task: SqlTask) => void;
  onReview: () => void;
  onOpenPlan: () => void;
  onOpenLessons: () => void;
  onConfigure: () => void;
  onExplore: () => void;
};

function nextPlanItem(items: WeekPlanItem[]): WeekPlanItem | null {
  if (!items.length) return null;
  const day = new Intl.DateTimeFormat('en-US', { weekday: 'short' }).format(new Date()).slice(0, 2).toUpperCase();
  return items.find(item => item.day === day) || items[0];
}

export default function GuidedHome({
  progress,
  reviewCount,
  onStartTask,
  onReview,
  onOpenPlan,
  onOpenLessons,
  onConfigure,
  onExplore
}: GuidedHomeProps) {
  const [profile, setProfile] = useState(() => loadOnboardingProfile());
  const [curriculum, setCurriculum] = useState(() => loadCurriculumProgress());
  const [checkpointReports, setCheckpointReports] = useState(() => loadLocalCheckpointReports());
  const [assessmentReports, setAssessmentReports] = useState(() => loadLocalAssessmentReports());

  useEffect(() => {
    const updateProfile = () => setProfile(loadOnboardingProfile());
    const updateCurriculum = () => setCurriculum(loadCurriculumProgress());
    const updateCheckpoints = () => setCheckpointReports(loadLocalCheckpointReports());
    const updateAssessments = () => setAssessmentReports(loadLocalAssessmentReports());
    const updateAll = () => {
      updateProfile();
      updateCurriculum();
      updateCheckpoints();
      updateAssessments();
    };
    window.addEventListener(ONBOARDING_CHANGED_EVENT, updateProfile);
    window.addEventListener(CURRICULUM_PROGRESS_CHANGED_EVENT, updateCurriculum);
    window.addEventListener(CHECKPOINT_REPORTS_CHANGED_EVENT, updateCheckpoints);
    window.addEventListener(ASSESSMENT_REPORTS_CHANGED_EVENT, updateAssessments);
    window.addEventListener('storage', updateAll);
    return () => {
      window.removeEventListener(ONBOARDING_CHANGED_EVENT, updateProfile);
      window.removeEventListener(CURRICULUM_PROGRESS_CHANGED_EVENT, updateCurriculum);
      window.removeEventListener(CHECKPOINT_REPORTS_CHANGED_EVENT, updateCheckpoints);
      window.removeEventListener(ASSESSMENT_REPORTS_CHANGED_EVENT, updateAssessments);
      window.removeEventListener('storage', updateAll);
    };
  }, []);

  const ready = onboardingReady(profile);
  const goal = goalOptions.find(item => item.id === profile.goal);
  const planned = useMemo(() => nextPlanItem(profile.firstWeekPlan), [profile.firstWeekPlan]);
  const passedCheckpointIds = useMemo(() => curriculumCheckpoints
    .filter(checkpoint =>
      Boolean(bestCheckpointReport(checkpoint.id, checkpointReports)?.passed)
      || legacyCheckpointPassed(checkpoint.id, progress)
    )
    .map(checkpoint => checkpoint.id), [checkpointReports, progress]);
  const assessmentComplete = useMemo(() => assessmentReports.some(report =>
    report.status === 'completed'
    && (report.mode === 'exam' || report.mode === 'production' || report.mode === 'final')
  ), [assessmentReports]);
  const nextStep = useMemo(() => nextJourneyAction(progress, curriculum, {
    includeReview: false,
    passedCheckpointIds,
    assessmentComplete,
    bypassedModuleIds: profile.placement.status === 'completed'
      ? profile.placement.strongModuleIds
      : []
  }), [assessmentComplete, curriculum, passedCheckpointIds, profile.placement, progress]);
  const completion = Math.round(progress.completed.length / TOTAL_TASK_COUNT * 100);

  const startNextStep = () => {
    if (nextStep.kind === 'task' && nextStep.task) {
      onStartTask(nextStep.task);
      return;
    }
    openJourneyDestination(nextStep);
  };

  if (!ready) {
    return <section className="guided-home guided-welcome" data-testid="guided-first-run">
      <div className="guided-welcome-copy">
        <span className="guided-icon"><Compass /></span>
        <h1>Сначала выберем, зачем тебе SQL.</h1>
        <p>Академия построит один понятный маршрут: цель, стартовый уровень, расписание и первый шаг. Тебе не придётся разбираться во всех разделах сразу.</p>
        <div className="guided-actions">
          <button className="primary" onClick={onConfigure}><Sparkles /> Настроить мой маршрут</button>
          <button onClick={onExplore}>Посмотреть программу</button>
        </div>
      </div>
      <ol className="guided-steps" aria-label="Как начинается обучение">
        <li><span>1</span><div><strong>Выбери результат</strong><p>Работа, аналитика, backend, интервью или полный путь.</p></div></li>
        <li><span>2</span><div><strong>Определи старт</strong><p>Короткая диагностика или осторожный старт с основ.</p></div></li>
        <li><span>3</span><div><strong>Следуй плану</strong><p>На главной всегда будет только одно рекомендуемое действие.</p></div></li>
      </ol>
    </section>;
  }

  const primaryIsReview = reviewCount > 0;
  return <section className="guided-home" data-testid="guided-today">
    <header className="guided-header">
      <div>
        <span className="guided-kicker">Сегодня · {goal?.title || 'SQL Academy'}</span>
        <h1>{primaryIsReview ? 'Сначала закрепим изученное.' : 'Продолжим единый маршрут.'}</h1>
        <p>{primaryIsReview
          ? `В очереди ${reviewCount} ${reviewCount === 1 ? 'задача' : 'задач'} на повторение. После них вернёмся к этапу «${nextStep.title}».`
          : nextStep.description}</p>
      </div>
      <button className="guided-configure" onClick={onConfigure}><Settings2 /> Изменить цель и ритм</button>
    </header>

    <div className="guided-primary-card" data-testid="guided-journey-action" data-stage={primaryIsReview ? 'review' : nextStep.stage}>
      <div className="guided-primary-copy">
        <span>{primaryIsReview ? <RefreshCw /> : <Target />}</span>
        <div>
          <small>{primaryIsReview
            ? 'Приоритет на сегодня · retrieval review'
            : `${nextStep.phaseTitle || 'Итоговый этап'}${nextStep.moduleTitle ? ` · ${nextStep.moduleTitle}` : ''} · ${nextStep.stage}`}</small>
          <h2>{primaryIsReview ? 'Адаптивное повторение' : nextStep.title}</h2>
          <p>{primaryIsReview
            ? 'Восстанови решение по памяти, не перечитывая урок заранее.'
            : nextStep.description}</p>
        </div>
      </div>
      <button className="primary" onClick={() => primaryIsReview ? onReview() : startNextStep()}>
        {primaryIsReview ? 'Начать повторение' : nextStep.cta} <ArrowRight />
      </button>
    </div>

    <div className="guided-grid">
      <article className="guided-week">
        <div className="guided-card-heading"><div><CalendarDays /><span><strong>Первая неделя</strong><small>Твой устойчивый контракт</small></span></div><button onClick={onOpenPlan}>Весь план <Route /></button></div>
        <div className="guided-week-list">{profile.firstWeekPlan.slice(0, 5).map(item => {
          const active = planned?.id === item.id;
          return <div key={item.id} className={active ? 'active' : ''}>
            <span>{studyDayLabels[item.day]}</span>
            <p><strong>{item.title}</strong><small>{item.minutes} мин · {item.kind}</small></p>
            {active ? <ArrowRight /> : <Clock3 />}
          </div>;
        })}</div>
      </article>

      <article className="guided-progress-card">
        <div className="guided-card-heading"><div><ListChecks /><span><strong>Прогресс маршрута</strong><small>Lesson → practice → checkpoint → transfer</small></span></div></div>
        <div className="guided-progress-value"><strong>{completion}%</strong><span>{progress.completed.length} из {TOTAL_TASK_COUNT} задач · {curriculum.completedLessons.length} уроков</span></div>
        <div className="guided-progress-bar"><i style={{ width: `${completion}%` }} /></div>
        <div className="guided-mini-actions">
          <button onClick={startNextStep}>Открыть следующий этап</button>
          <button onClick={onOpenLessons}>Все уроки</button>
        </div>
      </article>
    </div>

    <aside className="guided-recovery"><Clock3 /><div><strong>Правило устойчивого обучения</strong><p>{profile.recoveryRule}</p></div></aside>
  </section>;
}
