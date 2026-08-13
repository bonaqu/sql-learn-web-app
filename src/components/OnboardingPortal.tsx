import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowLeft,
  ArrowRight,
  BarChart3,
  BriefcaseBusiness,
  CalendarDays,
  Check,
  CheckCircle2,
  Clock3,
  Code2,
  Compass,
  Database,
  Gauge,
  GraduationCap,
  Laptop2,
  ListChecks,
  RefreshCw,
  Route,
  ShieldCheck,
  Sparkles,
  Target,
  X
} from 'lucide-react';
import { modules } from '../data/course-catalog';
import { loadLocalAssessmentReports } from '../lib/assessment';
import { useDialogFocus } from '../lib/dialog-focus';
import { openDeferredFeature } from '../lib/deferred-features';
import {
  buildFirstWeekPlan,
  calculatePlacement,
  completeOnboarding,
  deferredPlacement,
  goalOptions,
  latestCompletedDiagnostic,
  loadOnboardingProfile,
  ONBOARDING_ASSESSMENT_INTENT_KEY,
  onboardingReady,
  placementLevelLabels,
  profileForPlacementRetake,
  recommendedTrackLabels,
  saveOnboardingProfile,
  studyDayLabels,
  weekPlanKindLabels,
  type ExperienceLevel,
  type LearningRoutePreference,
  type LearnerGoal,
  type LearnerOnboardingProfile,
  type PriorSqlExperience,
  type ProgrammingExperience,
  type SqlDialectPreference,
  type StudyDay,
  type StudyPace
} from '../lib/learner-onboarding';
import { syncOnboardingProfile } from '../lib/onboarding-sync';

import '../onboarding.css';
import '../onboarding-phase8.css';

type WizardStep = 'goal' | 'schedule' | 'experience' | 'placement' | 'plan';

const steps: Array<{ id: WizardStep; title: string; short: string }> = [
  { id: 'goal', title: 'Цель', short: 'Зачем' },
  { id: 'schedule', title: 'Ритм', short: 'Когда' },
  { id: 'experience', title: 'Опыт', short: 'Контекст' },
  { id: 'placement', title: 'Диагностика', short: 'Проверка' },
  { id: 'plan', title: 'План', short: 'Неделя' }
];

const experienceOptions: Array<{ id: ExperienceLevel; title: string; description: string }> = [
  { id: 'none', title: 'С нуля', description: 'SQL ещё не использовал или помню только отдельные слова.' },
  { id: 'basics', title: 'Знаю базу', description: 'Писал SELECT, WHERE, ORDER BY и простые агрегаты.' },
  { id: 'regular', title: 'Использую время от времени', description: 'Есть JOIN, GROUP BY, подзапросы или рабочие отчёты.' },
  { id: 'advanced', title: 'Уверенный опыт', description: 'Работал с окнами, транзакциями, планами выполнения или боевыми схемами.' }
];

const programmingOptions: Array<{ id: ProgrammingExperience; title: string; description: string }> = [
  { id: 'none', title: 'Без опыта', description: 'Начну с чтения схемы и результата запроса.' },
  { id: 'some', title: 'Пишу код иногда', description: 'Знакомы переменные, условия или функции.' },
  { id: 'professional', title: 'Работаю разработчиком', description: 'Можно быстрее связывать SQL с кодом и системами.' }
];

const dialectOptions: Array<{ id: SqlDialectPreference; title: string }> = [
  { id: 'unknown', title: 'Пока не знаю' },
  { id: 'postgresql', title: 'PostgreSQL' },
  { id: 'mysql', title: 'MySQL' },
  { id: 'sqlserver', title: 'SQL Server' },
  { id: 'sqlite', title: 'SQLite' }
];

const routeOptions: Array<{ id: LearningRoutePreference; title: string; description: string }> = [
  { id: 'full', title: 'Полный путь', description: 'Подробные объяснения, практика и перенос навыка.' },
  { id: 'fast', title: 'Быстрый маршрут', description: 'Меньше вводных, больше практики; обязательная база сохраняется.' }
];

const priorSqlByExperience: Record<ExperienceLevel, PriorSqlExperience> = {
  none: 'none',
  basics: 'course',
  regular: 'work',
  advanced: 'work'
};

const paceOptions: Array<{ id: StudyPace; title: string; detail: string }> = [
  { id: 'gentle', title: 'Мягкий', detail: '2–3 сессии в неделю, минимум новых тем.' },
  { id: 'steady', title: 'Устойчивый', detail: '3–5 сессий, баланс уроков, практики и повторения.' },
  { id: 'intensive', title: 'Интенсивный', detail: '5–7 сессий, но без удвоения после пропусков.' }
];

const dayOrder: StudyDay[] = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];

function handleRadioArrow<T extends string>(
  event: React.KeyboardEvent<HTMLButtonElement>,
  values: readonly T[],
  current: T | null,
  select: (value: T) => void
) {
  if (!['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  const currentIndex = Math.max(0, values.indexOf(current || values[0]));
  const nextIndex = event.key === 'Home'
    ? 0
    : event.key === 'End'
      ? values.length - 1
      : event.key === 'ArrowRight' || event.key === 'ArrowDown'
        ? (currentIndex + 1) % values.length
        : (currentIndex - 1 + values.length) % values.length;
  select(values[nextIndex]);
  const group = event.currentTarget.closest('[role="radiogroup"]');
  window.setTimeout(() => (group?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[nextIndex])?.focus());
}

const goalIcons: Record<LearnerGoal, React.ReactNode> = {
  support: <BriefcaseBusiness />,
  analyst: <BarChart3 />,
  backend: <Laptop2 />,
  'data-engineering': <Database />,
  interview: <Target />,
  full: <GraduationCap />
};

function moduleTitle(moduleId: string) {
  return modules.find(([id]) => id === moduleId)?.[1] || moduleId;
}

function initialStep(profile: LearnerOnboardingProfile): WizardStep {
  if (profile.completedAt) return 'plan';
  if (profile.placement.status === 'completed') return 'placement';
  if (profile.placement.status === 'pending') return 'placement';
  if (!profile.goal) return 'goal';
  if (!profile.studyDays.length) return 'schedule';
  if (!profile.experience) return 'experience';
  return 'placement';
}

export default function OnboardingPortal({ openRequest = 0 }: { openRequest?: number }) {
  const initial = loadOnboardingProfile();
  const [open, setOpen] = useState(Boolean(openRequest));
  const [profile, setProfile] = useState(initial);
  const [step, setStep] = useState<WizardStep>(() => initialStep(initial));
  const [syncState, setSyncState] = useState<'idle' | 'syncing' | 'synced' | 'offline'>('idle');
  const [message, setMessage] = useState('');
  const shellRef = useRef<HTMLDivElement>(null);
  const previousOverflow = useRef('');

  const stepIndex = steps.findIndex(item => item.id === step);
  const reports = useMemo(() => loadLocalAssessmentReports(), [openRequest, open]);
  const diagnostic = useMemo(() => latestCompletedDiagnostic(reports), [reports]);
  const ready = onboardingReady(profile);

  useDialogFocus(open, shellRef, () => setOpen(false));

  useEffect(() => {
    if (openRequest <= 0) return;
    const fresh = loadOnboardingProfile();
    const report = latestCompletedDiagnostic(loadLocalAssessmentReports());
    let next = fresh;
    if ((fresh.placement.status === 'pending' || fresh.placement.status === 'completed')
      && report
      && report.id !== fresh.placement.reportId) {
      const placement = calculatePlacement(fresh, report);
      next = saveOnboardingProfile({
        ...fresh,
        placement,
        firstWeekPlan: buildFirstWeekPlan({ ...fresh, placement }),
        updatedAt: report.completedAt
      });
    }
    setProfile(next);
    setStep(initialStep(next));
    setOpen(true);
    setMessage('');
  }, [openRequest]);

  useEffect(() => {
    if (!open) return;
    previousOverflow.current = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previousOverflow.current; };
  }, [open]);

  const persist = (next: LearnerOnboardingProfile) => {
    const saved = saveOnboardingProfile(next);
    setProfile(saved);
    setSyncState('idle');
    return saved;
  };

  const update = (patch: Partial<LearnerOnboardingProfile>) => {
    const next = { ...profile, ...patch };
    return persist({
      ...next,
      firstWeekPlan: next.completedAt ? buildFirstWeekPlan(next) : next.firstWeekPlan
    });
  };

  const selectGoal = (goal: LearnerGoal) => {
    const goalTrack = goalOptions.find(item => item.id === goal)?.track || 'fundamentals';
    update({
      goal,
      placement: profile.placement.status === 'not-started'
        ? { ...profile.placement, recommendedTrack: goalTrack }
        : profile.placement
    });
  };

  const toggleDay = (day: StudyDay) => {
    const exists = profile.studyDays.includes(day);
    if (exists && profile.studyDays.length <= 2) {
      setMessage('Оставь минимум два учебных дня. Один большой марафон хуже двух коротких возвращений.');
      return;
    }
    const studyDays = dayOrder.filter(item => exists
      ? profile.studyDays.includes(item) && item !== day
      : profile.studyDays.includes(item) || item === day);
    update({ studyDays });
    setMessage('');
  };

  const nextStep = () => {
    if (step === 'goal' && !profile.goal) {
      setMessage('Выбери конкретную цель — она определит контекст задач, но не заменит подтверждённые результаты диагностики.');
      return;
    }
    if (step === 'schedule' && profile.studyDays.length < 2) {
      setMessage('Нужны хотя бы два учебных дня в неделю.');
      return;
    }
    if (step === 'experience' && (!profile.experience || !profile.priorSqlExperience || !profile.programmingExperience)) {
      setMessage('Укажи отдельно опыт программирования и SQL. Эти ответы меняют объяснения, но не открывают темы без выполненных задач.');
      return;
    }
    setMessage('');
    setStep(steps[Math.min(steps.length - 1, stepIndex + 1)].id);
  };

  const previousStep = () => {
    setMessage('');
    setStep(steps[Math.max(0, stepIndex - 1)].id);
  };

  const startPlacement = async () => {
    const next = persist(profileForPlacementRetake(profile, diagnostic?.id || null));
    sessionStorage.setItem(ONBOARDING_ASSESSMENT_INTENT_KEY, 'diagnostic');
    void syncOnboardingProfile(next).catch(() => undefined);
    setOpen(false);
    window.setTimeout(() => openDeferredFeature('assessment'), 80);
  };

  const defer = () => {
    const placement = deferredPlacement(profile);
    const next = completeOnboarding(profile, placement);
    const saved = persist(next);
    setStep('plan');
    setMessage('Диагностика отложена. План намеренно начинается с базового уровня и не делает предположений о навыках.');
    void syncOnboardingProfile(saved).catch(() => undefined);
  };

  const acceptPlacement = () => {
    if (profile.placement.status !== 'completed') return;
    const next = completeOnboarding(profile, profile.placement);
    persist(next);
    setStep('plan');
    setMessage('Диагностика принята. Пропуск тем и доступ к продвинутым модулям подтверждаются результатами по каждому модулю, а не одним общим баллом.');
  };

  const finish = async () => {
    const next = profile.firstWeekPlan.length
      ? { ...profile, completedAt: profile.completedAt || new Date().toISOString() }
      : completeOnboarding(profile, profile.placement.status === 'completed' ? profile.placement : deferredPlacement(profile));
    const saved = persist(next);
    setSyncState('syncing');
    try {
      const synced = await syncOnboardingProfile(saved);
      setProfile(synced.profile);
      setSyncState('synced');
      setMessage('Стартовый план сохранён локально и в облаке. Его можно пересобрать без сброса учебных результатов.');
    } catch {
      setSyncState('offline');
      setMessage('План сохранён локально. При восстановлении сети он синхронизируется автоматически.');
    }
  };

  const repeatPlacement = () => {
    void startPlacement();
  };

  if (!open) return null;

  const content = step === 'goal' ? <section className="onboarding-step" data-testid="onboarding-goal">
    <div className="onboarding-heading"><small>01 · цель</small><h1>Для какой работы тебе нужен SQL?</h1><p>Контекст меняет примеры и маршрут. Он не снижает требования к подтверждённым результатам.</p></div>
    <div className="onboarding-choice-grid goal-grid">{goalOptions.map(item => <button
      key={item.id}
      className={profile.goal === item.id ? 'selected' : ''}
      onClick={() => selectGoal(item.id)}
    ><span>{goalIcons[item.id]}</span><strong>{item.title}</strong><p>{item.description}</p>{profile.goal === item.id && <CheckCircle2 />}</button>)}</div>
  </section> : step === 'schedule' ? <section className="onboarding-step" data-testid="onboarding-schedule">
    <div className="onboarding-heading"><small>02 · устойчивость</small><h1>Сколько времени реально выдержать?</h1><p>План строится от повторяемого минимума. После пропуска система не удваивает следующую сессию.</p></div>
    <div className="onboarding-minutes" role="radiogroup" aria-label="Минут в учебный день">{([15, 25, 40] as const).map(value => <button role="radio" aria-checked={profile.dailyMinutes === value} className={profile.dailyMinutes === value ? 'selected' : ''} key={value} onClick={() => update({ dailyMinutes: value })}><Clock3 /><strong>{value}</strong><span>минут</span></button>)}</div>
    <div className="onboarding-days"><strong>Учебные дни</strong><div>{dayOrder.map(day => <button key={day} className={profile.studyDays.includes(day) ? 'selected' : ''} aria-pressed={profile.studyDays.includes(day)} onClick={() => toggleDay(day)}>{studyDayLabels[day]}</button>)}</div><small>{profile.studyDays.length} сессии в неделю · минимум 2</small></div>
    <div className="onboarding-pace">{paceOptions.map(item => <button key={item.id} className={profile.pace === item.id ? 'selected' : ''} onClick={() => update({ pace: item.id })}><Gauge /><span><strong>{item.title}</strong><small>{item.detail}</small></span></button>)}</div>
  </section> : step === 'experience' ? <section className="onboarding-step" data-testid="onboarding-experience">
    <div className="onboarding-heading"><small>03 · контекст</small><h1>Что уже знакомо и куда переносить SQL?</h1><p>Ответы регулируют темп и примеры. Они не подтверждают навык, не выдают сертификат и не открывают продвинутые модули.</p></div>
    <fieldset className="onboarding-fieldset"><legend>Опыт программирования</legend><div className="onboarding-choice-grid experience-grid" role="radiogroup" aria-label="Опыт программирования">{programmingOptions.map((item, index) => <button role="radio" aria-checked={profile.programmingExperience === item.id} tabIndex={profile.programmingExperience === item.id || !profile.programmingExperience && index === 0 ? 0 : -1} key={item.id} className={profile.programmingExperience === item.id ? 'selected' : ''} onKeyDown={event => handleRadioArrow(event, programmingOptions.map(option => option.id), profile.programmingExperience, value => update({ programmingExperience: value }))} onClick={() => update({ programmingExperience: item.id })}><span><Code2 /></span><strong>{item.title}</strong><p>{item.description}</p>{profile.programmingExperience === item.id && <CheckCircle2 />}</button>)}</div></fieldset>
    <fieldset className="onboarding-fieldset"><legend>Предыдущий опыт SQL</legend><div className="onboarding-choice-grid experience-grid" role="radiogroup" aria-label="Предыдущий опыт SQL">{experienceOptions.map((item, index) => <button role="radio" aria-checked={profile.experience === item.id} tabIndex={profile.experience === item.id || !profile.experience && index === 0 ? 0 : -1} key={item.id} className={profile.experience === item.id ? 'selected' : ''} onKeyDown={event => handleRadioArrow(event, experienceOptions.map(option => option.id), profile.experience, value => update({ experience: value, priorSqlExperience: priorSqlByExperience[value] }))} onClick={() => update({ experience: item.id, priorSqlExperience: priorSqlByExperience[item.id] })}><span><Database /></span><strong>{item.title}</strong><p>{item.description}</p>{profile.experience === item.id && <CheckCircle2 />}</button>)}</div></fieldset>
    <fieldset className="onboarding-fieldset"><legend>Диалект для примеров</legend><div className="onboarding-inline-options" role="radiogroup" aria-label="Диалект для примеров">{dialectOptions.map(item => <button role="radio" aria-checked={profile.dialect === item.id} tabIndex={profile.dialect === item.id ? 0 : -1} key={item.id} className={profile.dialect === item.id ? 'selected' : ''} onKeyDown={event => handleRadioArrow(event, dialectOptions.map(option => option.id), profile.dialect, value => update({ dialect: value }))} onClick={() => update({ dialect: item.id })}>{item.title}</button>)}</div></fieldset>
    <fieldset className="onboarding-fieldset"><legend>Глубина первого маршрута</legend><div className="onboarding-choice-grid route-grid" role="radiogroup" aria-label="Глубина первого маршрута">{routeOptions.map(item => <button role="radio" aria-checked={profile.routePreference === item.id} tabIndex={profile.routePreference === item.id ? 0 : -1} key={item.id} className={profile.routePreference === item.id ? 'selected' : ''} onKeyDown={event => handleRadioArrow(event, routeOptions.map(option => option.id), profile.routePreference, value => update({ routePreference: value }))} onClick={() => update({ routePreference: item.id })}><strong>{item.title}</strong><p>{item.description}</p>{profile.routePreference === item.id && <CheckCircle2 />}</button>)}</div></fieldset>
    <div className="onboarding-integrity-note"><ShieldCheck /><div><strong>Самооценка ≠ подтверждённый навык</strong><p>Пропустить базовую тему можно только после диагностики по этому модулю, самостоятельной практики или контрольного этапа.</p></div></div>
  </section> : step === 'placement' ? <section className="onboarding-step" data-testid="onboarding-placement">
    <div className="onboarding-heading"><small>04 · исполняемая диагностика</small><h1>{profile.placement.status === 'completed' ? 'Стартовый уровень измерен' : profile.placement.status === 'pending' ? 'Заверши диагностику SQL' : 'Проверим не память терминов, а SQL'}</h1><p>Диагностика использует те же исполняемые задачи и критерии результата, что основное обучение.</p></div>
    {profile.placement.status === 'completed' ? <div className="placement-result">
      <div className="placement-score"><strong>{profile.placement.score}%</strong><span>{profile.placement.level ? placementLevelLabels[profile.placement.level] : 'Уровень не определён'}</span></div>
      <div className="placement-summary"><article><Route /><span><small>Рекомендуемый маршрут</small><strong>{recommendedTrackLabels[profile.placement.recommendedTrack]}</strong></span></article><article><Sparkles /><span><small>Сильные модули</small><strong>{profile.placement.strongModuleIds.length ? profile.placement.strongModuleIds.map(moduleTitle).join(', ') : 'пока не подтверждены'}</strong></span></article><article><Target /><span><small>Первый фокус</small><strong>{profile.placement.focusModuleIds.length ? profile.placement.focusModuleIds.map(moduleTitle).join(', ') : 'закрепление основы'}</strong></span></article></div>
      {profile.placement.decisionReason && <div className="onboarding-integrity-note" data-testid="placement-confidence"><ShieldCheck /><div><strong>{profile.placement.diagnosticTaskCount} задач · диапазон {profile.placement.confidenceLow}–{profile.placement.confidenceHigh}%</strong><p>{profile.placement.decisionReason}</p></div></div>}
      <div className="placement-actions"><button className="primary" onClick={acceptPlacement}><Check />Принять результат и построить неделю</button><button onClick={repeatPlacement}><RefreshCw />Пройти заново</button></div>
    </div> : <div className="placement-offer">
      <div className="placement-proof"><ClipboardPlacement /><span><strong>Короткая диагностика · 3–7 задач</strong><small>После трёх базовых проб сложность растёт только при уверенном результате. SQL выполняется локально; рабочие данные не отправляются.</small></span></div>
      <ul><li><Check />Самооценка не влияет на итоговый балл</li><li><Check />Слабый общий результат не открывает продвинутые темы</li><li><Check />Повторная диагностика не стирает существующий прогресс</li></ul>
      <div className="placement-actions"><button data-testid="start-placement" className="primary" onClick={() => void startPlacement()}><ListChecks />{profile.placement.status === 'pending' ? 'Вернуться к диагностике' : 'Начать диагностику SQL'}</button><button data-testid="defer-placement" onClick={defer}>Начать с базового уровня без диагностики</button></div>
    </div>}
  </section> : <section className="onboarding-step" data-testid="onboarding-plan">
    <div className="onboarding-heading"><small>05 · первая неделя</small><h1>Первая неделя без перегруза</h1><p>Каждая сессия имеет один основной результат. Повторение не добавляется поверх новой темы — оно заменяет её, когда знания пора освежить.</p></div>
    <div className="week-plan">{profile.firstWeekPlan.map((item, index) => <article key={item.id}><span><small>{studyDayLabels[item.day]}</small><strong>{item.minutes}</strong><b>мин</b></span><div><small>0{index + 1} · {weekPlanKindLabels[item.kind]}</small><h2>{item.title}</h2><p>{item.detail}</p>{item.moduleId && <em>{moduleTitle(item.moduleId)}</em>}</div></article>)}</div>
    <div className="recovery-rule"><CalendarDays /><div><strong>Правило восстановления</strong><p>{profile.recoveryRule}</p></div></div>
    <div className="onboarding-final-actions"><button data-testid="complete-onboarding" className="primary" onClick={() => void finish()}><CheckCircle2 />{ready ? 'Синхронизировать план' : 'Принять стартовый план'}</button><button onClick={repeatPlacement}><RefreshCw />Повторить диагностику без сброса результатов</button></div>
  </section>;

  return createPortal(<div ref={shellRef} tabIndex={-1} className="onboarding-shell" role="dialog" aria-modal="true" aria-labelledby="onboarding-title" data-testid="onboarding-portal">
    <header className="onboarding-topbar"><div className="onboarding-brand"><Compass /><span><strong id="onboarding-title">SQL Academy · Стартовый план</strong><small>цель → ритм → диагностика → первая неделя</small></span></div><button data-autofocus onClick={() => setOpen(false)} aria-label="Закрыть стартовый план"><X /></button></header>
    <div className="onboarding-progress" aria-label={`Шаг ${stepIndex + 1} из ${steps.length}`}>{steps.map((item, index) => <button key={item.id} className={item.id === step ? 'active' : index < stepIndex ? 'done' : ''} onClick={() => index <= stepIndex && setStep(item.id)} disabled={index > stepIndex}><span>{index < stepIndex ? <Check /> : index + 1}</span><small>{item.short}</small></button>)}</div>
    <main className="onboarding-page">{content}{message && <div className={`onboarding-message ${syncState}`} role="status" aria-live="polite">{syncState === 'synced' ? <CheckCircle2 /> : syncState === 'syncing' ? <RefreshCw className="spin" /> : <ShieldCheck />}<span>{message}</span></div>}</main>
    {step !== 'placement' && step !== 'plan' && <footer className="onboarding-footer"><button onClick={previousStep} disabled={stepIndex === 0}><ArrowLeft />Назад</button><button className="primary" onClick={nextStep}>Продолжить<ArrowRight /></button></footer>}
  </div>, document.body);
}

function ClipboardPlacement() {
  return <div className="placement-icon"><ListChecks /></div>;
}
