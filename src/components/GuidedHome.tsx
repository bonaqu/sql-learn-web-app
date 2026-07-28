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
import { tasks, type SqlTask, TOTAL_TASK_COUNT } from '../data/course-catalog';
import {
  goalOptions,
  loadOnboardingProfile,
  ONBOARDING_CHANGED_EVENT,
  onboardingReady,
  studyDayLabels,
  type LearnerOnboardingProfile,
  type WeekPlanItem
} from '../lib/learner-onboarding';
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

function nextIncompleteTask(profile: LearnerOnboardingProfile, progress: Progress) {
  const completed = new Set(progress.completed);
  const focusModules = profile.placement.focusModuleIds;
  const focused = focusModules.length
    ? tasks.find(task => focusModules.includes(task.module) && !completed.has(task.id))
    : null;
  if (focused) return focused;
  const last = progress.lastTask ? tasks.find(task => task.id === progress.lastTask) : null;
  if (last && !completed.has(last.id)) return last;
  return tasks.find(task => !completed.has(task.id)) || tasks[0];
}

function nextPlanItem(profile: LearnerOnboardingProfile): WeekPlanItem | null {
  if (!profile.firstWeekPlan.length) return null;
  const day = new Intl.DateTimeFormat('en-US', { weekday: 'short' }).format(new Date()).slice(0, 2).toUpperCase();
  return profile.firstWeekPlan.find(item => item.day === day) || profile.firstWeekPlan[0];
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

  useEffect(() => {
    const update = () => setProfile(loadOnboardingProfile());
    window.addEventListener(ONBOARDING_CHANGED_EVENT, update);
    window.addEventListener('storage', update);
    return () => {
      window.removeEventListener(ONBOARDING_CHANGED_EVENT, update);
      window.removeEventListener('storage', update);
    };
  }, []);

  const ready = onboardingReady(profile);
  const goal = goalOptions.find(item => item.id === profile.goal);
  const nextTask = useMemo(() => nextIncompleteTask(profile, progress), [profile, progress]);
  const planned = useMemo(() => nextPlanItem(profile), [profile]);
  const completion = Math.round(progress.completed.length / TOTAL_TASK_COUNT * 100);

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
        <h1>{primaryIsReview ? 'Сначала закрепим изученное.' : 'Продолжим твой маршрут.'}</h1>
        <p>{primaryIsReview
          ? `В очереди ${reviewCount} ${reviewCount === 1 ? 'задача' : 'задач'} на повторение. После них вернёмся к новой теме.`
          : planned?.detail || `Следующая задача подобрана по твоему плану: ${nextTask.title}.`}</p>
      </div>
      <button className="guided-configure" onClick={onConfigure}><Settings2 /> Изменить цель и ритм</button>
    </header>

    <div className="guided-primary-card">
      <div className="guided-primary-copy">
        <span>{primaryIsReview ? <RefreshCw /> : <Target />}</span>
        <div>
          <small>{primaryIsReview ? 'Приоритет на сегодня' : planned ? `${studyDayLabels[planned.day]} · ${planned.minutes} минут` : `${profile.dailyMinutes} минут`}</small>
          <h2>{primaryIsReview ? 'Адаптивное повторение' : nextTask.title}</h2>
          <p>{primaryIsReview ? 'Восстанови решение по памяти, не перечитывая урок заранее.' : nextTask.description}</p>
        </div>
      </div>
      <button className="primary" onClick={() => primaryIsReview ? onReview() : onStartTask(nextTask)}>
        {primaryIsReview ? 'Начать повторение' : 'Начать сессию'} <ArrowRight />
      </button>
    </div>

    <div className="guided-grid">
      <article className="guided-week">
        <div className="guided-card-heading"><div><CalendarDays /><span><strong>Первая неделя</strong><small>Твой устойчивый контракт</small></span></div><button onClick={onOpenPlan}>Весь план <Route /></button></div>
        <div className="guided-week-list">{profile.firstWeekPlan.slice(0, 5).map((item, index) => <div key={item.id} className={index === 0 ? 'active' : ''}>
          <span>{studyDayLabels[item.day]}</span>
          <p><strong>{item.title}</strong><small>{item.minutes} мин · {item.kind}</small></p>
          {index === 0 ? <ArrowRight /> : <CheckCircle2 />}
        </div>)}</div>
      </article>

      <article className="guided-progress-card">
        <div className="guided-card-heading"><div><ListChecks /><span><strong>Прогресс маршрута</strong><small>Без гонки за случайными XP</small></span></div></div>
        <div className="guided-progress-value"><strong>{completion}%</strong><span>{progress.completed.length} из {TOTAL_TASK_COUNT} задач</span></div>
        <div className="guided-progress-bar"><i style={{ width: `${completion}%` }} /></div>
        <div className="guided-mini-actions">
          <button onClick={onOpenLessons}>Открыть следующий урок</button>
          <button onClick={onExplore}>Все инструменты</button>
        </div>
      </article>
    </div>

    <aside className="guided-recovery"><Clock3 /><div><strong>Правило устойчивого обучения</strong><p>{profile.recoveryRule}</p></div></aside>
  </section>;
}
