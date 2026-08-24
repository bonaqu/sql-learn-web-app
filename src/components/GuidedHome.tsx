import { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  CalendarDays,
  Clock3,
  Compass,
  Flag,
  ListChecks,
  RefreshCw,
  Route,
  Settings2,
  Sparkles,
  Target
} from 'lucide-react';
import { type SqlTask, TOTAL_TASK_COUNT } from '../data/course-catalog';
import { openJourneyDestination } from '../lib/academy-navigation';
import { journeyStageLabels } from '../lib/journey-display';
import {
  goalOptions,
  loadOnboardingProfile,
  ONBOARDING_CHANGED_EVENT,
  onboardingReady,
  studyDayLabels,
  weekPlanKindLabels,
  type WeekPlanItem
} from '../lib/learner-onboarding';
import type { JourneyFrontier } from '../lib/learning-journey';
import type { DailyRoute } from '../lib/daily-route';
import type { Progress } from '../lib/progress';

import '../checkpoint-remediation.css';
import '../guided-phase8.css';

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
  frontier: JourneyFrontier;
  completedLessons: number;
  dailySession: DailyRoute;
};

type JourneyModules = [
  typeof import('../lib/journey-evidence'),
  typeof import('../lib/learning-journey'),
  typeof import('../lib/daily-route')
];

let journeyModulesPromise: Promise<JourneyModules> | null = null;

function loadJourneyModules() {
  journeyModulesPromise ||= Promise.all([
    import('../lib/journey-evidence'),
    import('../lib/learning-journey'),
    import('../lib/daily-route')
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
    loadJourneyModules().then(([evidenceModule, journeyModule, pathModule]) => {
      if (disposed) return;
      const evidence = evidenceModule.loadJourneyEvidenceSnapshot();
      const frontier = journeyModule.buildJourneyFrontier(progress, evidence.curriculum, {
        includeReview: false,
        goal: profile.goal,
        passedCheckpointIds: evidence.passedCheckpointIds,
        checkpointRemediations: evidence.checkpointRemediations,
        assessmentComplete: evidence.assessmentComplete,
        bypassedModuleIds: profile.placement.status === 'completed'
          ? profile.placement.strongModuleIds
          : []
      });
      const dailySession = pathModule.buildDailyRoute(progress, profile.dailyMinutes, {
        curriculum: evidence.curriculum,
        passedCheckpointIds: evidence.passedCheckpointIds,
        checkpointRemediations: evidence.checkpointRemediations,
        assessmentComplete: evidence.assessmentComplete,
        bypassedModuleIds: profile.placement.status === 'completed' ? profile.placement.strongModuleIds : [],
        goal: profile.goal
      });
      setJourney({
        frontier,
        completedLessons: evidence.curriculum.completedLessons.length,
        dailySession
      });
    }).catch(() => {
      if (!disposed) setJourney(null);
    });
    return () => { disposed = true; };
  }, [evidenceRevision, profile.goal, profile.placement, progress]);

  const ready = onboardingReady(profile);
  const goal = goalOptions.find(item => item.id === profile.goal);
  const planned = useMemo(() => nextPlanItem(profile.firstWeekPlan), [profile.firstWeekPlan]);
  const nextStep = journey?.frontier.action || null;
  const remediation = journey?.frontier.checkpointRemediation || null;
  const completion = Math.round(progress.completed.length / TOTAL_TASK_COUNT * 100);

  const startNextStep = () => {
    if (!nextStep) return;
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
        <p>Академия построит один понятный маршрут: общая база, выбранная цель, подтверждённый стартовый уровень и следующий доступный шаг.</p>
        <div className="guided-actions">
          <button className="primary" onClick={onConfigure}><Sparkles /> Настроить мой маршрут</button>
          <button onClick={onExplore}>Посмотреть программу</button>
        </div>
      </div>
      <ol className="guided-steps" aria-label="Как начинается обучение">
        <li><span>1</span><div><strong>Выбери результат</strong><p>Поддержка, аналитика, бэкенд, интервью или полный путь.</p></div></li>
        <li><span>2</span><div><strong>Определи старт</strong><p>Диагностика позволяет пропустить только непрерывную цепочку подтверждённых базовых тем.</p></div></li>
        <li><span>3</span><div><strong>Следуй следующему шагу</strong><p>На главной и во всех режимах используется одно рекомендуемое действие.</p></div></li>
      </ol>
    </section>;
  }

  const primaryIsReview = reviewCount > 0;
  const loadingJourney = !nextStep;
  return <section className="guided-home" data-testid="guided-today">
    <header className="guided-header">
      <div>
        <span className="guided-kicker">Сегодня · {goal?.title || 'SQL Academy'}</span>
        <h1>{primaryIsReview ? 'Сначала закрепим изученное.' : 'Продолжим единый маршрут.'}</h1>
        <p>{primaryIsReview
          ? `В очереди ${reviewCount} ${reviewCount === 1 ? 'задача' : 'задач'} на повторение.${nextStep ? ` После них вернёмся к этапу «${nextStep.title}».` : ''}`
          : nextStep?.routeReason || nextStep?.description || 'Сверяю обязательные темы, уроки, самостоятельные результаты, контрольные этапы и выбранную цель.'}</p>
      </div>
      <button className="guided-configure" onClick={onConfigure}><Settings2 /> Изменить цель и ритм</button>
    </header>

    {remediation && <aside
      className="guided-remediation-banner"
      data-testid="guided-checkpoint-remediation"
      aria-label={`Восстановление после контрольного этапа ${remediation.checkpointTitle}`}
    >
      <Flag />
      <div>
        <strong>{remediation.checkpointTitle} · попытка {remediation.attemptNumber}</strong>
        <p>
          Результат {remediation.score}% при пороге {remediation.passingScore}%. Слабые модули: {remediation.modules.map(module => module.moduleTitle).join(', ')}.{' '}
          {primaryIsReview
            ? 'Сначала закрой уже назревшее повторение по памяти, затем маршрут вернётся к восстановлению.'
            : nextStep?.stage === 'checkpoint'
              ? 'Новые самостоятельные попытки подтверждены — повтори контрольный этап; перенос навыка в новые режимы пока закрыт.'
              : nextStep?.stage === 'practice'
                ? 'Сначала реши новую диагностическую задачу, которой не было в контрольном этапе.'
                : nextStep?.stage === 'interview' || nextStep?.stage === 'puzzle'
                  ? 'Новая практика подтверждена — теперь перенеси навык в отдельную незнакомую задачу.'
                  : 'Исправь отмеченные навыки новой самостоятельной попыткой после даты провала.'}
        </p>
      </div>
    </aside>}

    <div
      className="guided-primary-card"
      data-testid="guided-journey-action"
      data-stage={primaryIsReview ? 'review' : nextStep?.stage || 'loading'}
      data-route-reason={primaryIsReview ? 'retrieval-review' : nextStep?.routeReasonCode || 'loading'}
      aria-busy={loadingJourney && !primaryIsReview}
    >
      <div className="guided-primary-copy">
        <span>{primaryIsReview ? <RefreshCw /> : <Target />}</span>
        <div>
          <small>{primaryIsReview
            ? 'Приоритет на сегодня · повторение по памяти'
            : nextStep
              ? `${nextStep.phaseTitle || 'Итоговый этап'}${nextStep.moduleTitle ? ` · ${nextStep.moduleTitle}` : ''} · ${journeyStageLabels[nextStep.stage]}`
              : 'Синхронизация учебных результатов'}</small>
          <h2>{primaryIsReview ? 'Адаптивное повторение' : nextStep?.title || 'Строю следующий шаг…'}</h2>
          <p>{primaryIsReview
            ? 'Восстанови решение по памяти, не перечитывая урок заранее.'
            : nextStep
              ? `${nextStep.description}${nextStep.routeReason ? ` Почему сейчас: ${nextStep.routeReason}` : ''}`
              : 'Загружаю компактную сводку прогресса и следующий шаг выбранного маршрута.'}</p>
        </div>
      </div>
      <button className="primary" disabled={!primaryIsReview && !nextStep} onClick={() => primaryIsReview ? onReview() : startNextStep()}>
        {primaryIsReview ? 'Начать повторение' : nextStep?.cta || 'Анализирую маршрут'} <ArrowRight />
      </button>
    </div>

    <div className="guided-grid">
      <article className="guided-session-budget" data-testid="guided-session-budget">
        <div className="guided-card-heading"><div><Clock3 /><span><strong>Бюджет сегодняшней сессии</strong><small>{journey?.dailySession.budgetExplanation || `До ${profile.dailyMinutes} минут без накопления долга`}</small></span></div></div>
        <div className="guided-session-chips" aria-label="Состав сегодняшней сессии">
          <span>Новое · {journey?.dailySession.newCount || 0}</span>
          <span>Повторение · {journey?.dailySession.reviewCount || 0}</span>
          <span>Восстановление · {journey?.dailySession.remediationCount || 0}</span>
          <span>Перенос · {journey?.dailySession.transferCount || 0}</span>
        </div>
        <ol>{journey?.dailySession.items.map(item => <li key={item.id}>
          <span>{item.minutes} мин</span>
          <div><strong>{item.title}</strong><p><b>Почему сейчас:</b> {item.whyNow}</p><small><b>Связь с целью:</b> {item.goalConnection}</small></div>
        </li>)}</ol>
      </article>
      <article className="guided-week">
        <div className="guided-card-heading"><div><CalendarDays /><span><strong>Первая неделя</strong><small>Общая база и специализация без пропуска обязательных тем</small></span></div><button onClick={onOpenPlan}>Весь план <Route /></button></div>
        <div className="guided-week-list">{profile.firstWeekPlan.slice(0, 5).map(item => {
          const active = planned?.id === item.id;
          return <div key={item.id} className={active ? 'active' : ''}>
            <span>{studyDayLabels[item.day]}</span>
            <p><strong>{item.title}</strong><small>{item.minutes} мин · {weekPlanKindLabels[item.kind]}</small></p>
            {active ? <ArrowRight /> : <Clock3 />}
          </div>;
        })}</div>
      </article>

      <article className="guided-progress-card">
        <div className="guided-card-heading"><div><ListChecks /><span><strong>Прогресс маршрута</strong><small>Урок → практика → контроль → перенос навыка</small></span></div></div>
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
