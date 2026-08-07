import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  BrainCircuit,
  Check,
  CheckCircle2,
  ChevronRight,
  Circle,
  Clock3,
  Flag,
  Flame,
  Gauge,
  GraduationCap,
  LockKeyhole,
  Map,
  Play,
  RefreshCw,
  Route,
  ShieldCheck,
  Sparkles,
  Target,
  Trophy,
  X
} from 'lucide-react';
import { tasks, type SqlTask } from '../data/course-catalog';
import { openAcademyTask, openJourneyDestination } from '../lib/academy-navigation';
import {
  ASSESSMENT_REPORTS_CHANGED_EVENT,
  loadLocalAssessmentReports
} from '../lib/assessment';
import { checkpointRemediationsFromReports } from '../lib/checkpoint-remediation';
import {
  CHECKPOINT_REPORTS_CHANGED_EVENT,
  loadLocalCheckpointReports
} from '../lib/checkpoints';
import {
  CURRICULUM_PROGRESS_CHANGED_EVENT,
  loadCurriculumProgress
} from '../lib/curriculum-progress';
import { openDeferredFeature } from '../lib/deferred-features';
import type { GoalSwitchEvidence } from '../lib/goal-switch';
import { journeyStageLabels } from '../lib/journey-display';
import {
  buildDailySession,
  learningPhases,
  mentorPlanContext,
  moduleMastery,
  type LearningSessionEvidence,
  type ModuleMastery,
  readinessLabel,
  type SessionItem
} from '../lib/learning-path';
import {
  goalOptions,
  loadOnboardingProfile,
  ONBOARDING_CHANGED_EVENT
} from '../lib/learner-onboarding';
import { loadProgress, type Progress, PROGRESS_CHANGED_EVENT } from '../lib/progress';
import {
  buildSkillEvidenceGraph,
  type ModuleSkillEvidence
} from '../lib/skill-evidence';
import { useDialogFocus } from '../lib/dialog-focus';
import { openCheckpointCenter } from './CheckpointLauncher';
import GoalSwitchPanel from './GoalSwitchPanel';

import '../checkpoint-remediation.css';

const TARGET_KEY = 'sql-academy-session-target-v1';
const PROFILE_KEY = 'sql-academy-profile-id';

type MentorPlanSource = 'local' | 'ai';

function profileId() {
  const existing = localStorage.getItem(PROFILE_KEY);
  if (existing) return existing;
  const next = crypto.randomUUID();
  localStorage.setItem(PROFILE_KEY, next);
  return next;
}

function levelLabel(module: ModuleMastery) {
  if (module.routeState === 'current') return 'Текущий приоритет цели';
  if (module.routeState === 'eligible') return 'Обязательные темы пройдены · позже по цели';
  if (module.routeState === 'locked') return 'Сначала пройди обязательные темы';
  if (module.level === 'mastered') return 'Освоено';
  if (module.routeState === 'completed' && module.recommendedTask) return 'База освоена · перенос навыка';
  if (module.routeState === 'completed') return 'База освоена';
  if (module.level === 'practice') return 'Закрепление';
  if (module.level === 'learning') return 'В работе';
  return 'Новый модуль';
}

function evidenceActionLabel(action: ModuleSkillEvidence['recommendedAction']) {
  if (action === 'lesson') return 'следующий урок';
  if (action === 'practice') return 'практика';
  if (action === 'checkpoint') return 'контрольный этап';
  if (action === 'assessment') return 'итоговая проверка';
  if (action === 'project') return 'итоговый проект';
  return 'повторение';
}

function reasonIcon(reason: SessionItem['reason']) {
  if (reason === 'review') return <RefreshCw />;
  if (reason === 'weakness') return <Target />;
  if (reason === 'checkpoint') return <Flag />;
  return <Play />;
}

function localPlan(progress: Progress, evidence?: LearningSessionEvidence) {
  const context = mentorPlanContext(progress, evidence);
  const weakest = context.weakest[0];
  const items = context.session
    .slice(0, 4)
    .map((item, index) => `${index + 1}. ${item.title} — ${item.topic}`)
    .join('\n');
  return `План на ближайшую сессию
• Готовность: ${context.readiness}%
• Главный фокус: ${weakest ? `${weakest.title} (${weakest.mastery}% освоения)` : 'закрепление пройденного'}
${items}
• После сессии повтори ошибочный запрос без подсказки.`;
}

function openCurriculumTarget(target: 'lesson' | 'project', id: string) {
  const params = new URLSearchParams();
  params.set(target, id);
  history.replaceState(
    null,
    '',
    `${window.location.pathname}${window.location.search}#${params.toString()}`
  );
  openDeferredFeature('curriculum');
}

export default function LearningPathPortal({
  externalLauncher = false,
  openRequest = 0
}: {
  externalLauncher?: boolean;
  openRequest?: number;
}) {
  const [desktopSlot, setDesktopSlot] = useState<HTMLElement | null>(null);
  const [mobileSlot, setMobileSlot] = useState<HTMLElement | null>(null);
  const [open, setOpen] = useState(Boolean(openRequest));
  const [goalSwitchOpen, setGoalSwitchOpen] = useState(false);
  const [progress, setProgress] = useState<Progress>(() => loadProgress());
  const [curriculumProgress, setCurriculumProgress] = useState(() => loadCurriculumProgress());
  const [assessmentReports, setAssessmentReports] = useState(() => loadLocalAssessmentReports());
  const [checkpointReports, setCheckpointReports] = useState(() => loadLocalCheckpointReports());
  const [profile, setProfile] = useState(() => loadOnboardingProfile());
  const [targetMinutes, setTargetMinutes] = useState(() =>
    Math.max(15, Number(localStorage.getItem(TARGET_KEY)) || 25)
  );
  const [expandedPhase, setExpandedPhase] = useState<string>('foundation');
  const [mentorAnswer, setMentorAnswer] = useState(() => localPlan(loadProgress()));
  const [mentorSource, setMentorSource] = useState<MentorPlanSource>('local');
  const [mentorLoading, setMentorLoading] = useState(false);
  const [activeTask, setActiveTask] = useState<string | null>(null);
  const previousOverflow = useRef('');
  const shellRef = useRef<HTMLDivElement>(null);

  const evidenceGraph = useMemo(() => buildSkillEvidenceGraph(
    progress,
    curriculumProgress,
    assessmentReports,
    checkpointReports
  ), [assessmentReports, checkpointReports, curriculumProgress, progress]);
  const checkpointRemediations = useMemo(() => {
    const ownerId = checkpointReports.find(report => typeof report.userId === 'string' && report.userId)?.userId || null;
    return checkpointRemediationsFromReports(checkpointReports, ownerId);
  }, [checkpointReports]);
  const sessionEvidence = useMemo<LearningSessionEvidence>(() => ({
    curriculum: curriculumProgress,
    passedCheckpointIds: evidenceGraph.phases
      .filter(phase => phase.checkpointPassed)
      .map(phase => phase.checkpointId),
    checkpointRemediations,
    assessmentComplete: assessmentReports.some(report =>
      report.status === 'completed'
      && (report.mode === 'exam' || report.mode === 'production' || report.mode === 'final')
    ),
    bypassedModuleIds: profile.placement.status === 'completed'
      ? profile.placement.strongModuleIds
      : [],
    goal: profile.goal
  }), [assessmentReports, checkpointRemediations, curriculumProgress, evidenceGraph.phases, profile.goal, profile.placement]);
  const goalSwitchEvidence = useMemo<GoalSwitchEvidence>(() => ({
    curriculum: curriculumProgress,
    passedCheckpointIds: sessionEvidence.passedCheckpointIds,
    checkpointRemediations,
    assessmentComplete: sessionEvidence.assessmentComplete,
    includeReview: true
  }), [checkpointRemediations, curriculumProgress, sessionEvidence.assessmentComplete, sessionEvidence.passedCheckpointIds]);
  const mastery = useMemo(
    () => moduleMastery(progress, sessionEvidence),
    [progress, sessionEvidence]
  );
  const legacyPhases = useMemo(
    () => learningPhases(progress, mastery, sessionEvidence),
    [mastery, progress, sessionEvidence]
  );
  const session = useMemo(
    () => buildDailySession(progress, targetMinutes, sessionEvidence),
    [progress, sessionEvidence, targetMinutes]
  );
  const readiness = evidenceGraph.overallReadiness;
  const masteredModules = evidenceGraph.modules.filter(module => module.readiness >= 82).length;
  const passedCheckpoints = evidenceGraph.phases.filter(phase => phase.checkpointPassed).length;
  const nextPhase = evidenceGraph.phases.find(phase => !phase.completed)
    || evidenceGraph.phases[evidenceGraph.phases.length - 1];
  const currentGoalTitle = goalOptions.find(option => option.id === profile.goal)?.title || 'Полная академия';
  const activeRemediation = checkpointRemediations[0] || null;

  useEffect(() => {
    if (externalLauncher) return;
    const mount = () => {
      const sidebarNav = document.querySelector('.sidebar nav');
      const mobileNav = document.querySelector('.mobile-bottom-nav');
      if (!sidebarNav || !mobileNav) return null;

      const desktop = document.createElement('span');
      desktop.className = 'learning-path-nav-slot';
      const mobile = document.createElement('span');
      mobile.className = 'learning-path-mobile-slot';
      sidebarNav.firstElementChild?.insertAdjacentElement('afterend', desktop);
      mobileNav.firstElementChild?.insertAdjacentElement('afterend', mobile);
      setDesktopSlot(desktop);
      setMobileSlot(mobile);
      return () => {
        desktop.remove();
        mobile.remove();
      };
    };

    const cleanup = mount();
    if (cleanup) return cleanup;
    const observer = new MutationObserver(() => {
      const result = mount();
      if (result) observer.disconnect();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [externalLauncher]);

  useEffect(() => {
    if (openRequest > 0) {
      setGoalSwitchOpen(false);
      setOpen(true);
    }
  }, [openRequest]);

  useEffect(() => {
    const updateProgress = () => setProgress(loadProgress());
    const updateCurriculum = () => setCurriculumProgress(loadCurriculumProgress());
    const updateAssessments = () => setAssessmentReports(loadLocalAssessmentReports());
    const updateCheckpoints = () => setCheckpointReports(loadLocalCheckpointReports());
    const updateProfile = () => setProfile(loadOnboardingProfile());
    const updateAll = () => {
      updateProgress();
      updateCurriculum();
      updateAssessments();
      updateCheckpoints();
      updateProfile();
    };

    window.addEventListener(PROGRESS_CHANGED_EVENT, updateProgress);
    window.addEventListener(CURRICULUM_PROGRESS_CHANGED_EVENT, updateCurriculum);
    window.addEventListener(ASSESSMENT_REPORTS_CHANGED_EVENT, updateAssessments);
    window.addEventListener(CHECKPOINT_REPORTS_CHANGED_EVENT, updateCheckpoints);
    window.addEventListener(ONBOARDING_CHANGED_EVENT, updateProfile);
    window.addEventListener('storage', updateAll);
    return () => {
      window.removeEventListener(PROGRESS_CHANGED_EVENT, updateProgress);
      window.removeEventListener(CURRICULUM_PROGRESS_CHANGED_EVENT, updateCurriculum);
      window.removeEventListener(ASSESSMENT_REPORTS_CHANGED_EVENT, updateAssessments);
      window.removeEventListener(CHECKPOINT_REPORTS_CHANGED_EVENT, updateCheckpoints);
      window.removeEventListener(ONBOARDING_CHANGED_EVENT, updateProfile);
      window.removeEventListener('storage', updateAll);
    };
  }, []);

  useEffect(() => {
    localStorage.setItem(TARGET_KEY, String(targetMinutes));
  }, [targetMinutes]);

  useEffect(() => {
    setMentorSource('local');
  }, [progress, sessionEvidence]);

  useEffect(() => {
    if (mentorSource === 'local') {
      setMentorAnswer(localPlan(progress, sessionEvidence));
    }
  }, [mentorSource, progress, sessionEvidence]);

  useDialogFocus(open, shellRef, () => {
    if (goalSwitchOpen) setGoalSwitchOpen(false);
    else setOpen(false);
  });

  useEffect(() => {
    if (!open) return;
    setGoalSwitchOpen(false);
    setProgress(loadProgress());
    setCurriculumProgress(loadCurriculumProgress());
    setAssessmentReports(loadLocalAssessmentReports());
    setCheckpointReports(loadLocalCheckpointReports());
    setProfile(loadOnboardingProfile());
    previousOverflow.current = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow.current;
    };
  }, [open]);

  const closePath = () => {
    setGoalSwitchOpen(false);
    setOpen(false);
  };

  const startTask = (task: SqlTask) => {
    setActiveTask(task.id);
    closePath();
    openAcademyTask(task.id);
    window.setTimeout(() => setActiveTask(null), 1000);
  };

  const openCheckpoint = (checkpointId: string) => {
    closePath();
    window.setTimeout(() => openCheckpointCenter(checkpointId), 40);
  };

  const openEvidenceAction = (evidence: ModuleSkillEvidence, fallbackTask: SqlTask | null) => {
    const target = evidence.recommendedTargetId;
    if (evidence.recommendedAction === 'lesson' && target) {
      closePath();
      window.setTimeout(() => openCurriculumTarget('lesson', target), 40);
      return;
    }
    if (evidence.recommendedAction === 'project' && target) {
      closePath();
      window.setTimeout(() => openCurriculumTarget('project', target), 40);
      return;
    }
    if (evidence.recommendedAction === 'checkpoint' && target) {
      openCheckpoint(target);
      return;
    }
    if (evidence.recommendedAction === 'assessment') {
      closePath();
      window.setTimeout(() => openDeferredFeature('assessment'), 40);
      return;
    }
    if (fallbackTask) startTask(fallbackTask);
  };

  const startSessionItem = (item: SessionItem) => {
    if (item.task) {
      startTask(item.task);
      return;
    }
    if (item.action) {
      closePath();
      window.setTimeout(() => openJourneyDestination(item.action as NonNullable<SessionItem['action']>), 40);
    }
  };

  const askMentor = async () => {
    setMentorLoading(true);
    setMentorSource('local');
    const fallback = localPlan(progress, sessionEvidence);
    setMentorAnswer(fallback);
    try {
      const context = mentorPlanContext(progress, sessionEvidence);
      const evidenceContext = evidenceGraph.modules
        .filter(module => module.blockers.length)
        .sort((left, right) => left.readiness - right.readiness)
        .slice(0, 5)
        .map(module => ({
          тема: module.title,
          готовность: module.readiness,
          следующийШаг: evidenceActionLabel(module.recommendedAction),
          ограничения: module.blockers
        }));
      const response = await fetch('/api/mentor', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-profile-id': profileId()
        },
        body: JSON.stringify({
          mode: 'review',
          question: `Составь персональный учебный план на ${targetMinutes} минут. Не давай готовые SQL-решения. Учитывай пять видов подтверждённых результатов. Данные: ${JSON.stringify({ context, evidenceContext })}`,
          sql: '',
          task: 'Персональный маршрут SQL Academy: урок, практика, контрольный этап, итоговая проверка и проект.',
          topic: 'Адаптивный учебный маршрут',
          difficulty: 'Персональный план',
          lastFeedback: `Готовность по подтверждённым результатам ${readiness}%.`,
          attempts: context.weakest.reduce((sum, item) => sum + item.errors, 0),
          hintsUsed: context.weakest.reduce((sum, item) => sum + item.hints, 0),
          allowSolution: false
        })
      });
      if (!response.ok) throw new Error('Mentor unavailable');
      const payload = await response.json() as { answer?: string };
      const answer = payload.answer?.trim();
      if (answer) {
        setMentorAnswer(answer);
        setMentorSource('ai');
      } else {
        setMentorAnswer(fallback);
        setMentorSource('local');
      }
    } catch {
      setMentorAnswer(fallback);
      setMentorSource('local');
    } finally {
      setMentorLoading(false);
    }
  };

  const desktopTrigger = <button
    className={open ? 'active' : ''}
    onClick={() => setOpen(true)}
    data-testid="learning-path-trigger"
  >
    <Route /><span>Учебный путь</span>
  </button>;

  const mobileTrigger = <button
    className={open ? 'active' : ''}
    onClick={() => setOpen(true)}
    data-testid="learning-path-mobile-trigger"
  >
    <span className="mobile-nav-icon"><Map /></span><small>Путь</small>
  </button>;

  const panel = open ? <div
    ref={shellRef}
    tabIndex={-1}
    className="learning-path-shell"
    role="dialog"
    aria-modal="true"
    aria-labelledby={goalSwitchOpen ? 'goal-switch-title' : 'learning-path-title'}
    data-testid="learning-path"
  >
    <header className="path-topbar">
      <div className="path-brand"><div><Route /></div><span><strong>Адаптивный учебный маршрут</strong><small>Единая карта учебных результатов SQL Academy</small></span></div>
      <div className="path-top-actions">
        {!goalSwitchOpen && <label><Clock3 />Сессия<select value={targetMinutes} onChange={event => setTargetMinutes(Number(event.target.value))}>
          <option value={15}>15 минут</option>
          <option value={25}>25 минут</option>
          <option value={40}>40 минут</option>
        </select></label>}
        <button className="path-close" onClick={closePath} aria-label="Закрыть учебный путь"><X /></button>
      </div>
    </header>

    {goalSwitchOpen ? <GoalSwitchPanel
      profile={profile}
      progress={progress}
      evidence={goalSwitchEvidence}
      onCancel={() => setGoalSwitchOpen(false)}
      onProfileChanged={setProfile}
    /> : <main className="learning-path-page">
      <section className="path-hero">
        <div className="path-hero-copy">
          <span className="path-kicker"><Sparkles /> урок + практика + контроль + итоговая проверка + проект</span>
          <h1 id="learning-path-title">Не просто список задач.<br />Доказуемый путь к рабочему SQL.</h1>
          <p>{readinessLabel(readiness)}. Следующая цель — <strong>{nextPhase?.title || 'закрепление курса'}</strong>.</p>
          <div className="path-hero-actions">
            <button className="path-primary" onClick={() => session.items[0] && startSessionItem(session.items[0])} disabled={!session.items.length || Boolean(activeTask)}><Play />Начать сессию</button>
            <button onClick={() => void askMentor()} disabled={mentorLoading}><Sparkles />AI-план</button>
            <button onClick={() => setGoalSwitchOpen(true)} data-testid="goal-switch-trigger"><Route />Изменить цель</button>
          </div>
        </div>
        <div className="readiness-ring" style={{ '--readiness': `${readiness * 3.6}deg` } as React.CSSProperties}>
          <div><strong>{readiness}%</strong><span>готовность по результатам</span></div>
        </div>
      </section>

      <section className="path-metrics">
        <article><Gauge /><span><small>Готовые модули</small><strong>{masteredModules}<b>/{mastery.length}</b></strong></span></article>
        <article><CheckCircle2 /><span><small>Решено задач</small><strong>{progress.completed.length}<b>/{tasks.length}</b></strong></span></article>
        <article><Flame /><span><small>Серия занятий</small><strong>{progress.streak}<b> дней</b></strong></span></article>
        <article><Flag /><span><small>Контрольные этапы</small><strong>{passedCheckpoints}<b>/{evidenceGraph.phases.length}</b></strong></span></article>
      </section>

      {activeRemediation && <section className="checkpoint-remediation-banner" data-testid="checkpoint-remediation-banner">
        <div className="checkpoint-remediation-icon"><Flag /></div>
        <div className="checkpoint-remediation-copy">
          <small>Не пройден контрольный этап · попытка {activeRemediation.attemptNumber}</small>
          <h2>{activeRemediation.checkpointTitle}: {activeRemediation.score}% из {activeRemediation.passingScore}%</h2>
          <p>Точечное восстановление временно важнее специализации. Слабые модули: {activeRemediation.modules.map(module => `${module.moduleTitle} (${module.score}%)`).join(', ')}.</p>
          <span>{session.frontier.action.routeReasonCode === 'checkpoint-remediation'
            ? session.frontier.action.routeReason
            : `Сначала завершится более приоритетный этап «${journeyStageLabels[session.frontier.action.stage]}»; затем маршрут автоматически вернётся к восстановлению.`}</span>
        </div>
        <button onClick={() => session.items[0] && startSessionItem(session.items[0])} disabled={!session.items.length}>
          {session.frontier.action.routeReasonCode === 'checkpoint-remediation' ? 'Начать восстановление' : 'Начать текущий шаг'} <ChevronRight />
        </button>
      </section>}

      <section className="path-content-grid">
        <div className="today-session path-card">
          <div className="path-section-heading"><div><span className="path-eyebrow">Сегодня</span><h2>Сессия на {session.totalMinutes} минут</h2><p>{session.reviewCount} на закрепление · {session.newCount} новый этап</p></div><Clock3 /></div>
          <div className="session-list">
            {session.items.map((item, index) => <button key={item.id} onClick={() => startSessionItem(item)} data-stage={item.action?.stage || 'review'}>
              <span className={`session-reason ${item.reason}`}>{reasonIcon(item.reason)}</span>
              <span className="session-index">{String(index + 1).padStart(2, '0')}</span>
              <span className="session-copy"><strong>{item.title}</strong><small>{item.label} · {item.topic}</small></span>
              <span className="session-time">{item.minutes} мин</span><ChevronRight />
            </button>)}
          </div>
          {session.focusModule && <div className="focus-explanation"><Target /><div><strong>Почему этот фокус</strong><p>{session.focusModule.title}: освоение {session.focusModule.mastery}%, ошибок {session.focusModule.incorrect}, подсказок {session.focusModule.hints}.</p></div></div>}
        </div>

        <aside className="path-ai-card path-card">
          <div className="path-section-heading"><div><span className="path-eyebrow">AI-наставник</span><h2>План следующего шага</h2><p>Основан на пяти видах подтверждённых результатов, а не случайном совете.</p></div><BrainCircuit /></div>
          <pre className={mentorLoading ? 'path-ai-answer loading' : 'path-ai-answer'} aria-live="polite">{mentorLoading ? 'Анализирую карту учебных результатов…' : mentorAnswer}</pre>
          <button className="path-ai-refresh" onClick={() => void askMentor()} disabled={mentorLoading}><RefreshCw className={mentorLoading ? 'spin' : ''} />Пересчитать AI-план</button>
          <small><ShieldCheck /> Без имени, адреса электронной почты и данных работодателя.</small>
        </aside>
      </section>

      <section className="roadmap-section">
        <div className="roadmap-heading"><div><span className="path-eyebrow">Карта навыков · {currentGoalTitle}</span><h2>Карта навыков и результатов</h2><p>Готовность и порядок объясняются одним маршрутом: общая база, текущий приоритет, доступные позже темы и обязательная профессиональная широта.</p></div><Trophy /></div>
        <div className="route-state-legend" data-testid="goal-route-legend">
          <span className="current"><i />текущий приоритет</span>
          <span className="eligible"><i />обязательные темы пройдены · позже</span>
          <span className="completed"><i />результат подтверждён</span>
          <span className="locked"><i />сначала обязательные темы</span>
        </div>
        <div className="phase-list">
          {legacyPhases.map((phase, phaseIndex) => {
            const phaseEvidence = evidenceGraph.phases.find(item => item.phaseId === phase.id);
            const phaseModules = mastery
              .filter(module => phase.moduleIds.includes(module.id))
              .sort((left, right) => left.index - right.index);
            const expanded = expandedPhase === phase.id;
            const passed = Boolean(phaseEvidence?.checkpointPassed);
            const phaseReadiness = phaseEvidence?.readiness ?? phase.mastery;
            return <article className={`phase-card ${phase.unlocked ? '' : 'locked'}`} key={phase.id}>
              <button className="phase-summary" onClick={() => phase.unlocked && setExpandedPhase(expanded ? '' : phase.id)}>
                <span className="phase-number">{phase.unlocked ? String(phaseIndex + 1).padStart(2, '0') : <LockKeyhole />}</span>
                <span className="phase-title"><strong>{phase.title}</strong><small>{phase.subtitle}</small></span>
                <span className="phase-progress"><i><b style={{ width: `${phaseReadiness}%` }} /></i><small>{phaseReadiness}% подтверждено</small></span>
                <span className={passed ? 'checkpoint passed' : 'checkpoint'}>{passed ? <Check /> : <Flag />}{passed ? 'Пройден' : 'Контроль'}</span>
                <ChevronRight className={expanded ? 'rotated' : ''} />
              </button>
              {expanded && <div className="phase-modules">
                {phaseEvidence?.blockers.length ? <div className="focus-explanation"><LockKeyhole /><div><strong>Что блокирует этап</strong><p>{phaseEvidence.blockers.join(' · ')}</p></div></div> : null}
                {phaseModules.map(module => {
                  const evidence = evidenceGraph.modules.find(item => item.moduleId === module.id);
                  const readinessValue = evidence?.readiness ?? module.mastery;
                  return <button
                    className={`module-node ${module.level} route-${module.routeState}`}
                    data-route-state={module.routeState}
                    key={module.id}
                    onClick={() => evidence && openEvidenceAction(evidence, module.recommendedTask)}
                    disabled={module.routeState === 'locked'}
                  >
                    <span className="module-state">{readinessValue >= 82 ? <Check /> : module.routeState === 'locked' ? <LockKeyhole /> : <Circle />}</span>
                    <span className="module-copy"><strong>{module.title}</strong><small>{levelLabel(module)} · дальше: {evidence ? evidenceActionLabel(evidence.recommendedAction) : 'практика'}</small></span>
                    <span className="module-mastery"><strong>{readinessValue}%</strong><i><b style={{ width: `${readinessValue}%` }} /></i></span>
                    {evidence?.recommendedTargetId || module.recommendedTask ? <ChevronRight /> : <GraduationCap />}
                  </button>;
                })}
                {phaseEvidence && <button
                  className={`checkpoint-card ${passed ? 'passed' : ''}`}
                  onClick={() => openCheckpoint(phaseEvidence.checkpointId)}
                >
                  <Flag /><span><strong>Контрольный этап с практическими задачами</strong><small>{phaseEvidence.completionCriteria.join(' · ')}</small></span><b>{passed ? 'Открыть отчёт' : 'Проверить себя'}</b><ChevronRight />
                </button>}
              </div>}
            </article>;
          })}
        </div>
      </section>
    </main>}
  </div> : null;

  return <>
    {!externalLauncher && desktopSlot && createPortal(desktopTrigger, desktopSlot)}
    {!externalLauncher && mobileSlot && createPortal(mobileTrigger, mobileSlot)}
    {panel && createPortal(panel, document.body)}
  </>;
}