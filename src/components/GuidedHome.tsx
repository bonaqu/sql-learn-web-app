import { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  CalendarDays,
  Clock3,
  Compass,
  ListChecks,
  RefreshCw,
  Route,
  Settings2,
  Sparkles,
  Target
} from 'lucide-react';
import { type SqlTask, TOTAL_TASK_COUNT } from '../data/course-catalog';
import { openJourneyDestination } from '../lib/academy-navigation';
import { learningRouteForProfile } from '../lib/goal-aware-learning-route';
import {
  loadOnboardingProfile,
  ONBOARDING_CHANGED_EVENT,
  onboardingReady,
  studyDayLabels,
  type WeekPlanItem
} from '../lib/learner-onboarding';
import type { JourneyAction } from '../lib/learning-journey';
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

type JourneySnapshot = {
  action: JourneyAction;
  completedLessons: number;
};

type JourneyModules = [
  typeof import('../lib/journey-evidence'),
  typeof import('../lib/learning-journey')
];

let journeyModulesPromise: Promise<JourneyModules> | null = null;

function loadJourneyModules() {
  journeyModulesPromise ||= Promise.all([
    import('../lib/journey-evidence'),
    import('../lib/learning-journey')
  ]);
  return journeyModulesPromise;
}

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
  const [evidenceRevision, setEvidenceRevision] = useState(0);
  const [journey, setJourney] = useState<JourneySnapshot | null>(null);
  const route = useMemo(
    () => learningRouteForProfile(profile),
    [profile.dailyMinutes, profile.goal, profile.pace]
  );

  useEffect(() => {
    let disposed = false;
    const cleanups: Array<() => void> = [];
    const refreshEvidence = () => setEvidenceRevision(value => value + 1);
    const refreshProfile = () => setProfile(loadOnboardingProfile());
    const refreshAll = () => {
      refreshProfile();
      refreshEvidence();
    };

    window.addEventListener(ONBOARDING_CHANGED_EVENT, refreshProfile);
    window.addEventListener('storage', refreshAll);
    cleanups.push(() => window.removeEventListener(ONBOARDING_CHANGED_EVENT, refreshProfile));
    cleanups.push(() => window.removeEventListener('storage', refreshAll));

    loadJourneyModules().then(([evidenceModule]) => {
      if (disposed) return;
      for (const eventName of evidenceModule.JOURNEY_EVIDENCE_EVENTS) {
        window.addEventListener(eventName, refreshEvidence);
        cleanups.push(() => window.removeEventListener(eventName, refreshEvidence));
      }
    }).catch(() => undefined);

    return () => {
      disposed = true;
      for (const cleanup of cleanups) cleanup();
    };
  }, []);

  useEffect(() => {
    let disposed = false;
    setJourney(null);
    loadJourneyModules().then(([evidenceModule, journeyModule]) => {
      if (disposed) return;
      const evidence = evidenceModule.loadJourneyEvidenceSnapshot();
      const action = journeyModule.nextJourneyAction(progress, evidence.curriculum, {
        passedCheckpointIds: evidence.passedCheckpointIds,
        assessmentComplete: evidence.assessmentComplete,
        bypassedModuleIds: profile.placement.status === 'completed'
          ? profile.placement.strongModuleIds
          : [],
        route
      });
      setJourney({
        action,
        completedLessons: evidence.curriculum.completedLessons.length
      });
    }).catch(() => {
      if (!disposed) setJourney(null);
    });
    return () => { disposed = true; };
  }, [evidenceRevision, profile.placement, progress, route]);

  const ready = onboardingReady(profile);
  const planned = useMemo(() => nextPlanItem(profile.firstWeekPlan), [profile.firstWeekPlan]);
  const nextStep = journey?.action || null;
  const completion = Math.round(progress.completed.length / TOTAL_TASK_COUNT * 100);

  const startNextStep = () => {
    if (!nextStep) return;
    if (nextStep.kind === 'task' && nextStep.task) {
      onStartTask(nextStep.task);
      return;
    }
    if (nextStep.stage === 'review') {
      onReview();
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

  const primaryIsReview = nextStep?.stage === 'review';
  const loadingJourney = !nextStep;
  return <section className="guided-home" data-testid="guided-today" data-route-goal={route.goal}>
    <header className="guided-header">
      <div>
        <span className="guided-kicker">Сегодня · {route.title}</span>
        <h1>{primaryIsReview ? 'Сначала закрепим нужный для цели навык.' : 'Продолжим единый маршрут без пробелов.'}</h1>
        <p>{loadingJourney
          ? 'Сверяю уроки, independent evidence, checkpoints и assessment, чтобы выбрать правильный следующий этап.'
          : `${route.promise} ${primaryIsReview && reviewCount > 1 ? `В общей очереди ${reviewCount} задач; маршрут выбрал самую своевременную для цели.` : ''}`}</p>
      </div>
      <button className="guided-configure" onClick={onConfigure}><Settings2 /> Изменить цель и ритм</button>
    </header>

    <div className="guided-primary-card" data-testid="guided-journey-action" data-stage={nextStep?.stage || 'loading'} aria-busy={loadingJourney}>
      <div className="guided-primary-copy">
        <span>{primaryIsReview ? <RefreshCw /> : <Target />}</span>
        <div>
          <small>{nextStep
            ? `${nextStep.phaseTitle || route.title}${nextStep.moduleTitle ? ` · ${nextStep.moduleTitle}` : ''} · ${nextStep.stage}`
            : 'Синхронизация evidence-графа'}</small>
          <h2>{nextStep?.title || 'Строю следующий шаг…'}</h2>
          <p>{nextStep?.description || 'Загружаю только компактную сводку прогресса, не поднимая assessment и SQLite runtime.'}</p>
        </div>
      </div>
      <button className="primary" disabled={!nextStep} onClick={startNextStep}>
        {nextStep?.cta || 'Анализирую маршрут'} <ArrowRight />
      </button>
    </div>

    <div className="guided-grid">
      <article className="guided-week">
        <div className="guided-card-heading"><div><CalendarDays /><span><strong>Первая неделя</strong><small>{route.title} · {route.dailyMinutes} минут в учебный день</small></span></div><button onClick={onOpenPlan}>Весь план <Route /></button></div>
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
        <div className="guided-progress-value"><strong>{completion}%</strong><span>{progress.completed.length} из {TOTAL_TASK_COUNT} задач · {journey?.completedLessons || 0} уроков</span></div>
        <div className="guided-progress-bar"><i style={{ width: `${completion}%` }} /></div>
        <div className="guided-mini-actions">
          <button disabled={!nextStep} onClick={startNextStep}>Открыть следующий этап</button>
          <button onClick={onOpenLessons}>Все уроки</button>
        </div>
      </article>
    </div>

    <aside className="guided-recovery"><Clock3 /><div><strong>Правило устойчивого обучения</strong><p>{profile.recoveryRule}</p></div></aside>
  </section>;
}
