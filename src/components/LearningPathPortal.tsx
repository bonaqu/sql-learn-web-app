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
import {
  CHECKPOINT_REPORTS_CHANGED_EVENT,
  loadLocalCheckpointReports
} from '../lib/checkpoints';
import {
  CURRICULUM_PROGRESS_CHANGED_EVENT,
  loadCurriculumProgress
} from '../lib/curriculum-progress';
import { openDeferredFeature } from '../lib/deferred-features';
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

const TARGET_KEY = 'sql-academy-session-target-v1';
const PROFILE_KEY = 'sql-academy-profile-id';

function profileId() {
  const existing = localStorage.getItem(PROFILE_KEY);
  if (existing) return existing;
  const next = crypto.randomUUID();
  localStorage.setItem(PROFILE_KEY, next);
  return next;
}

function levelLabel(module: ModuleMastery) {
  if (module.level === 'mastered') return 'Освоено';
  if (module.level === 'practice') return 'Закрепление';
  if (module.level === 'learning') return 'В работе';
  if (module.level === 'locked') return 'Закрыто';
  return 'Новый модуль';
}

function evidenceActionLabel(action: ModuleSkillEvidence['recommendedAction']) {
  if (action === 'lesson') return 'следующий урок';
  if (action === 'practice') return 'практика';
  if (action === 'checkpoint') return 'checkpoint';
  if (action === 'assessment') return 'assessment';
  if (action === 'project') return 'capstone';
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
• Главный фокус: ${weakest ? `${weakest.title} (${weakest.mastery}% mastery)` : 'закрепление пройденного'}
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
  const [mentorLoading, setMentorLoading] = useState(false);
  const [activeTask, setActiveTask] = useState<string | null>(null);
  const previousOverflow = useRef('');
  const shellRef = useRef<HTMLDivElement>(null);

  const mastery = useMemo(() => moduleMastery(progress), [progress]);
  const legacyPhases = useMemo(() => learningPhases(progress, mastery), [mastery, progress]);
  const evidenceGraph = useMemo(() => buildSkillEvidenceGraph(
    progress,
    curriculumProgress,
    assessmentReports,
    checkpointReports
  ), [assessmentReports, checkpointReports, curriculumProgress, progress]);
  const sessionEvidence = useMemo<LearningSessionEvidence>(() => ({
    curriculum: curriculumProgress,
    passedCheckpointIds: evidenceGraph.phases
      .filter(phase => phase.checkpointPassed)
      .map(phase => phase.checkpointId),
    assessmentComplete: assessmentReports.some(report =>
      report.status === 'completed'
      && (report.mode === 'exam' || report.mode === 'production' || report.mode === 'final')
    ),
    bypassedModuleIds: profile.placement.status === 'completed'
      ? profile.placement.strongModuleIds
      : []
  }), [assessmentReports, curriculumProgress, evidenceGraph.phases, profile.placement]);
  const session = useMemo(
    () => buildDailySession(progress, targetMinutes, sessionEvidence),
    [progress, sessionEvidence, targetMinutes]
  );
  const readiness = evidenceGraph.overallReadiness;
  const masteredModules = evidenceGraph.modules.filter(module => module.readiness >= 82).length;
  const passedCheckpoints = evidenceGraph.phases.filter(phase => phase.checkpointPassed).length;
  const nextPhase = evidenceGraph.phases.find(phase => !phase.completed)
    || evidenceGraph.phases[evidenceGraph.phases.length - 1];

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
    if (openRequest > 0) setOpen(true);
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
    if (!mentorLoading) setMentorAnswer(localPlan(progress, sessionEvidence));
  }, [mentorLoading, progress, sessionEvidence]);

  useDialogFocus(open, shellRef, () => setOpen(false));

  useEffect(() => {
    if (!open) return;
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

  const startTask = (task: SqlTask) => {
    setActiveTask(task.id);
    setOpen(false);
    openAcademyTask(task.id);
    window.setTimeout(() => setActiveTask(null), 1000);
  };

  const openCheckpoint = (checkpointId: string) => {
    setOpen(false);
    window.setTimeout(() => openCheckpointCenter(checkpointId), 40);
  };

  const openEvidenceAction = (evidence: ModuleSkillEvidence, fallbackTask: SqlTask | null) => {
    const target = evidence.recommendedTargetId;
    if (evidence.recommendedAction === 'lesson' && target) {
      setOpen(false);
      window.setTimeout(() => openCurriculumTarget('lesson', target), 40);
      return;
    }
    if (evidence.recommendedAction === 'project' && target) {
      setOpen(false);
      window.setTimeout(() => openCurriculumTarget('project', target), 40);
      return;
    }
    if (evidence.recommendedAction === 'checkpoint' && target) {
      openCheckpoint(target);
      return;
    }
    if (evidence.recommendedAction === 'assessment') {
      setOpen(false);
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
      setOpen(false);
      window.setTimeout(() => openJourneyDestination(item.action as NonNullable<SessionItem['action']>), 40);
    }
  };

  const askMentor = async () => {
    setMentorLoading(true);
    const fallback = localPlan(progress, sessionEvidence);
    setMentorAnswer(fallback);
    try {
      const context = mentorPlanContext(progress, sessionEvidence);
      const evidenceContext = evidenceGraph.modules
        .filter(module => module.blockers.length)
        .sort((left, right) => left.readiness - right.readiness)
        .slice(0, 5)
        .map(module => ({
          module: module.title,
          readiness: module.readiness,
          next: module.recommendedAction,
          blockers: module.blockers
        }));
      const response = await fetch('/api/mentor', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-profile-id': profileId()
        },
        body: JSON.stringify({
          mode: 'review',
          question: `Составь персональный учебный план на ${targetMinutes} минут. Не давай готовые SQL-решения. Учитывай пять видов evidence. Данные: ${JSON.stringify({ context, evidenceContext })}`,
          sql: '',
          task: 'Персональный маршрут SQL Academy по lesson, practice, checkpoint, assessment и project evidence.',
          topic: 'Adaptive Learning Path',
          difficulty: 'Персональный план',
          lastFeedback: `Evidence readiness ${readiness}%.`,
          attempts: context.weakest.reduce((sum, item) => sum + item.errors, 0),
          hintsUsed: context.weakest.reduce((sum, item) => sum + item.hints, 0),
          allowSolution: false
        })
      });
      if (!response.ok) throw new Error('Mentor unavailable');
      const payload = await response.json() as { answer?: string };
      setMentorAnswer(payload.answer?.trim() || fallback);
    } catch {
      setMentorAnswer(fallback);
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
    aria-labelledby="learning-path-title"
    data-testid="learning-path"
  >
    <header className="path-topbar">
      <div className="path-brand"><div><Route /></div><span><strong>Adaptive Learning Path</strong><small>Единый evidence graph SQL Academy</small></span></div>
      <div className="path-top-actions">
        <label><Clock3 />Сессия<select value={targetMinutes} onChange={event => setTargetMinutes(Number(event.target.value))}>
          <option value={15}>15 минут</option>
          <option value={25}>25 минут</option>
          <option value={40}>40 минут</option>
        </select></label>
        <button className="path-close" onClick={() => setOpen(false)} aria-label="Закрыть учебный путь"><X /></button>
      </div>
    </header>

    <main className="learning-path-page">
      <section className="path-hero">
        <div className="path-hero-copy">
          <span className="path-kicker"><Sparkles /> lesson + practice + checkpoint + assessment + project</span>
          <h1 id="learning-path-title">Не просто список задач.<br />Доказуемый путь к рабочему SQL.</h1>
          <p>{readinessLabel(readiness)}. Следующая цель — <strong>{nextPhase?.title || 'закрепление курса'}</strong>.</p>
          <div className="path-hero-actions">
            <button className="path-primary" onClick={() => session.items[0] && startSessionItem(session.items[0])} disabled={!session.items.length || Boolean(activeTask)}><Play />Начать сессию</button>
            <button onClick={() => void askMentor()} disabled={mentorLoading}><Sparkles />AI-план</button>
          </div>
        </div>
        <div className="readiness-ring" style={{ '--readiness': `${readiness * 3.6}deg` } as React.CSSProperties}>
          <div><strong>{readiness}%</strong><span>evidence readiness</span></div>
        </div>
      </section>

      <section className="path-metrics">
        <article><Gauge /><span><small>Готовые модули</small><strong>{masteredModules}<b>/{mastery.length}</b></strong></span></article>
        <article><CheckCircle2 /><span><small>Решено задач</small><strong>{progress.completed.length}<b>/{tasks.length}</b></strong></span></article>
        <article><Flame /><span><small>Текущий streak</small><strong>{progress.streak}<b> дней</b></strong></span></article>
        <article><Flag /><span><small>Checkpoints</small><strong>{passedCheckpoints}<b>/{evidenceGraph.phases.length}</b></strong></span></article>
      </section>

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
          {session.focusModule && <div className="focus-explanation"><Target /><div><strong>Почему этот фокус</strong><p>{session.focusModule.title}: mastery {session.focusModule.mastery}%, ошибок {session.focusModule.incorrect}, подсказок {session.focusModule.hints}.</p></div></div>}
        </div>

        <aside className="path-ai-card path-card">
          <div className="path-section-heading"><div><span className="path-eyebrow">AI Coach</span><h2>План следующего шага</h2><p>Основан на пяти видах evidence, а не случайном совете.</p></div><BrainCircuit /></div>
          <pre className={mentorLoading ? 'path-ai-answer loading' : 'path-ai-answer'} aria-live="polite">{mentorLoading ? 'Анализирую evidence graph…' : mentorAnswer}</pre>
          <button className="path-ai-refresh" onClick={() => void askMentor()} disabled={mentorLoading}><RefreshCw className={mentorLoading ? 'spin' : ''} />Пересчитать AI-план</button>
          <small><ShieldCheck /> Без имени, email и данных работодателя.</small>
        </aside>
      </section>

      <section className="roadmap-section">
        <div className="roadmap-heading"><div><span className="path-eyebrow">Skill graph</span><h2>Карта доказательств</h2><p>Readiness объясняется уроками, практикой, контрольными, assessment и проектами.</p></div><Trophy /></div>
        <div className="phase-list">
          {legacyPhases.map((phase, phaseIndex) => {
            const phaseEvidence = evidenceGraph.phases.find(item => item.phaseId === phase.id);
            const phaseModules = mastery.filter(module => phase.moduleIds.includes(module.id));
            const expanded = expandedPhase === phase.id;
            const passed = Boolean(phaseEvidence?.checkpointPassed);
            const phaseReadiness = phaseEvidence?.readiness ?? phase.mastery;
            return <article className={`phase-card ${phase.unlocked ? '' : 'locked'}`} key={phase.id}>
              <button className="phase-summary" onClick={() => phase.unlocked && setExpandedPhase(expanded ? '' : phase.id)}>
                <span className="phase-number">{phase.unlocked ? String(phaseIndex + 1).padStart(2, '0') : <LockKeyhole />}</span>
                <span className="phase-title"><strong>{phase.title}</strong><small>{phase.subtitle}</small></span>
                <span className="phase-progress"><i><b style={{ width: `${phaseReadiness}%` }} /></i><small>{phaseReadiness}% evidence</small></span>
                <span className={passed ? 'checkpoint passed' : 'checkpoint'}>{passed ? <Check /> : <Flag />}{passed ? 'Пройден' : 'Checkpoint'}</span>
                <ChevronRight className={expanded ? 'rotated' : ''} />
              </button>
              {expanded && <div className="phase-modules">
                {phaseEvidence?.blockers.length ? <div className="focus-explanation"><LockKeyhole /><div><strong>Что блокирует этап</strong><p>{phaseEvidence.blockers.join(' · ')}</p></div></div> : null}
                {phaseModules.map(module => {
                  const evidence = evidenceGraph.modules.find(item => item.moduleId === module.id);
                  const readinessValue = evidence?.readiness ?? module.mastery;
                  return <button
                    className={`module-node ${module.level}`}
                    key={module.id}
                    onClick={() => evidence && openEvidenceAction(evidence, module.recommendedTask)}
                    disabled={module.level === 'locked'}
                  >
                    <span className="module-state">{readinessValue >= 82 ? <Check /> : module.level === 'locked' ? <LockKeyhole /> : <Circle />}</span>
                    <span className="module-copy"><strong>{module.title}</strong><small>{levelLabel(module)} · next: {evidence ? evidenceActionLabel(evidence.recommendedAction) : 'practice'}</small></span>
                    <span className="module-mastery"><strong>{readinessValue}%</strong><i><b style={{ width: `${readinessValue}%` }} /></i></span>
                    {evidence?.recommendedTargetId || module.recommendedTask ? <ChevronRight /> : <GraduationCap />}
                  </button>;
                })}
                {phaseEvidence && <button
                  className={`checkpoint-card ${passed ? 'passed' : ''}`}
                  onClick={() => openCheckpoint(phaseEvidence.checkpointId)}
                >
                  <Flag /><span><strong>Исполняемая контрольная этапа</strong><small>{phaseEvidence.completionCriteria.join(' · ')}</small></span><b>{passed ? 'Открыть отчёт' : 'Проверить себя'}</b><ChevronRight />
                </button>}
              </div>}
            </article>;
          })}
        </div>
      </section>
    </main>
  </div> : null;

  return <>
    {!externalLauncher && desktopSlot && createPortal(desktopTrigger, desktopSlot)}
    {!externalLauncher && mobileSlot && createPortal(mobileTrigger, mobileSlot)}
    {panel && createPortal(panel, document.body)}
  </>;
}