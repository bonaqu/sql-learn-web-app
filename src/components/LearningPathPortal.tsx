import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowLeft,
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
import { SqlTask } from '../data/course';
import {
  buildDailySession,
  learningPhases,
  mentorPlanContext,
  moduleMastery,
  ModuleMastery,
  overallReadiness,
  readinessLabel,
  SessionItem
} from '../lib/learning-path';
import { loadProgress, Progress, PROGRESS_CHANGED_EVENT } from '../lib/progress';
import { useDialogFocus } from '../lib/dialog-focus';

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

function reasonIcon(reason: SessionItem['reason']) {
  if (reason === 'review') return <RefreshCw />;
  if (reason === 'weakness') return <Target />;
  if (reason === 'checkpoint') return <Flag />;
  return <Play />;
}

function localPlan(progress: Progress) {
  const context = mentorPlanContext(progress);
  const weakest = context.weakest[0];
  const items = context.session.slice(0, 4).map((item, index) => `${index + 1}. ${item.title} — ${item.topic}`).join('\n');
  return `План на ближайшую сессию\n• Готовность: ${context.readiness}%\n• Главный фокус: ${weakest ? `${weakest.title} (${weakest.mastery}% mastery)` : 'закрепление пройденного'}\n${items}\n• После сессии повтори ошибочный запрос без подсказки.`;
}

function openTaskInAcademy(task: SqlTask) {
  const navLabel = task.mode === 'interview' ? 'Interview' : task.mode === 'puzzle' ? 'SQL Puzzle' : 'Practice';
  const desktopNav = Array.from(document.querySelectorAll<HTMLButtonElement>('.sidebar nav button'))
    .find(button => button.textContent?.trim().startsWith(navLabel));
  desktopNav?.click();

  let attempts = 0;
  const select = () => {
    const row = Array.from(document.querySelectorAll<HTMLButtonElement>('.task-row'))
      .find(button => button.querySelector('strong')?.textContent === task.title);
    if (row) {
      row.click();
      row.scrollIntoView({ block: 'nearest' });
      return;
    }
    attempts += 1;
    if (attempts < 20) window.setTimeout(select, 60);
  };
  window.setTimeout(select, 40);
}

export default function LearningPathPortal({ externalLauncher = false, openRequest = 0 }: { externalLauncher?: boolean; openRequest?: number }) {
  const [desktopSlot, setDesktopSlot] = useState<HTMLElement | null>(null);
  const [mobileSlot, setMobileSlot] = useState<HTMLElement | null>(null);
  const [open, setOpen] = useState(Boolean(openRequest));
  const [progress, setProgress] = useState<Progress>(() => loadProgress());
  const [targetMinutes, setTargetMinutes] = useState(() => Math.max(15, Number(localStorage.getItem(TARGET_KEY)) || 25));
  const [expandedPhase, setExpandedPhase] = useState<string>('foundation');
  const [mentorAnswer, setMentorAnswer] = useState(() => localPlan(loadProgress()));
  const [mentorLoading, setMentorLoading] = useState(false);
  const [activeTask, setActiveTask] = useState<string | null>(null);
  const previousOverflow = useRef('');
  const shellRef = useRef<HTMLDivElement>(null);

  const mastery = useMemo(() => moduleMastery(progress), [progress]);
  const phases = useMemo(() => learningPhases(progress, mastery), [mastery, progress]);
  const session = useMemo(() => buildDailySession(progress, targetMinutes), [progress, targetMinutes]);
  const readiness = useMemo(() => overallReadiness(progress), [progress]);
  const masteredModules = mastery.filter(module => module.level === 'mastered').length;
  const nextPhase = phases.find(phase => phase.unlocked && !phase.checkpointPassed) || phases[phases.length - 1];

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

  useEffect(() => { if (openRequest > 0) setOpen(true); }, [openRequest]);

  useEffect(() => {
    const update = () => setProgress(loadProgress());
    window.addEventListener(PROGRESS_CHANGED_EVENT, update);
    window.addEventListener('storage', update);
    return () => {
      window.removeEventListener(PROGRESS_CHANGED_EVENT, update);
      window.removeEventListener('storage', update);
    };
  }, []);

  useEffect(() => {
    localStorage.setItem(TARGET_KEY, String(targetMinutes));
  }, [targetMinutes]);

  useDialogFocus(open, shellRef, () => setOpen(false));

  useEffect(() => {
    if (!open) return;
    setProgress(loadProgress());
    previousOverflow.current = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previousOverflow.current; };
  }, [open]);

  const startTask = (task: SqlTask) => {
    setActiveTask(task.id);
    setOpen(false);
    openTaskInAcademy(task);
    window.setTimeout(() => setActiveTask(null), 1000);
  };

  const askMentor = async () => {
    setMentorLoading(true);
    const fallback = localPlan(progress);
    setMentorAnswer(fallback);
    try {
      const context = mentorPlanContext(progress);
      const response = await fetch('/api/mentor', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-profile-id': profileId() },
        body: JSON.stringify({
          mode: 'review',
          question: `Составь персональный учебный план на ${targetMinutes} минут. Не давай готовые SQL-решения. Данные профиля: ${JSON.stringify(context)}`,
          sql: '',
          task: 'Персональный маршрут SQL Academy на основе mastery, ошибок, подсказок и контрольных точек.',
          topic: 'Adaptive Learning Path',
          difficulty: 'Персональный план',
          lastFeedback: `Текущая готовность ${readiness}%.`,
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

  const desktopTrigger = <button className={open ? 'active' : ''} onClick={() => setOpen(true)} data-testid="learning-path-trigger">
    <Route /><span>Учебный путь</span>
  </button>;

  const mobileTrigger = <button className={open ? 'active' : ''} onClick={() => setOpen(true)} data-testid="learning-path-mobile-trigger">
    <span className="mobile-nav-icon"><Map /></span><small>Путь</small>
  </button>;

  const panel = open ? <div ref={shellRef} tabIndex={-1} className="learning-path-shell" role="dialog" aria-modal="true" aria-labelledby="learning-path-title" data-testid="learning-path">
    <header className="path-topbar">
      <div className="path-brand"><div><Route /></div><span><strong>Adaptive Learning Path</strong><small>Персональный маршрут SQL Academy</small></span></div>
      <div className="path-top-actions">
        <label><Clock3 />Сессия<select value={targetMinutes} onChange={event => setTargetMinutes(Number(event.target.value))}>
          <option value={15}>15 минут</option><option value={25}>25 минут</option><option value={40}>40 минут</option>
        </select></label>
        <button className="path-close" onClick={() => setOpen(false)} aria-label="Закрыть учебный путь"><X /></button>
      </div>
    </header>

    <main className="learning-path-page">
      <section className="path-hero">
        <div className="path-hero-copy">
          <span className="path-kicker"><Sparkles /> маршрут пересчитывается по реальным попыткам</span>
          <h1 id="learning-path-title">Не просто список задач.<br />Понятный путь к рабочему SQL.</h1>
          <p>{readinessLabel(readiness)}. Следующая цель — <strong>{nextPhase.title}</strong>.</p>
          <div className="path-hero-actions">
            <button className="path-primary" onClick={() => session.items[0] && startTask(session.items[0].task)} disabled={!session.items.length || Boolean(activeTask)}><Play />Начать сессию</button>
            <button onClick={() => void askMentor()} disabled={mentorLoading}><Sparkles />AI-план</button>
          </div>
        </div>
        <div className="readiness-ring" style={{ '--readiness': `${readiness * 3.6}deg` } as React.CSSProperties}>
          <div><strong>{readiness}%</strong><span>готовность</span></div>
        </div>
      </section>

      <section className="path-metrics">
        <article><Gauge /><span><small>Mastery модулей</small><strong>{masteredModules}<b>/20</b></strong></span></article>
        <article><CheckCircle2 /><span><small>Решено задач</small><strong>{progress.completed.length}<b>/120</b></strong></span></article>
        <article><Flame /><span><small>Текущий streak</small><strong>{progress.streak}<b> дней</b></strong></span></article>
        <article><Flag /><span><small>Контрольные точки</small><strong>{phases.filter(phase => phase.checkpointPassed).length}<b>/4</b></strong></span></article>
      </section>

      <section className="path-content-grid">
        <div className="today-session path-card">
          <div className="path-section-heading"><div><span className="path-eyebrow">Сегодня</span><h2>Сессия на {session.totalMinutes} минут</h2><p>{session.reviewCount} на закрепление · {session.newCount} новая</p></div><Clock3 /></div>
          <div className="session-list">
            {session.items.map((item, index) => <button key={item.task.id} onClick={() => startTask(item.task)}>
              <span className={`session-reason ${item.reason}`}>{reasonIcon(item.reason)}</span>
              <span className="session-index">{String(index + 1).padStart(2, '0')}</span>
              <span className="session-copy"><strong>{item.task.title}</strong><small>{item.label} · {item.task.topic}</small></span>
              <span className="session-time">{item.minutes} мин</span><ChevronRight />
            </button>)}
          </div>
          {session.focusModule && <div className="focus-explanation"><Target /><div><strong>Почему этот фокус</strong><p>{session.focusModule.title}: mastery {session.focusModule.mastery}%, ошибок {session.focusModule.incorrect}, подсказок {session.focusModule.hints}.</p></div></div>}
        </div>

        <aside className="path-ai-card path-card">
          <div className="path-section-heading"><div><span className="path-eyebrow">AI Coach</span><h2>План следующего шага</h2><p>Основан на mastery, а не на случайном совете.</p></div><BrainCircuit /></div>
          <pre className={mentorLoading ? 'path-ai-answer loading' : 'path-ai-answer'} aria-live="polite">{mentorLoading ? 'Анализирую учебный профиль…' : mentorAnswer}</pre>
          <button className="path-ai-refresh" onClick={() => void askMentor()} disabled={mentorLoading}><RefreshCw className={mentorLoading ? 'spin' : ''} />Пересчитать AI-план</button>
          <small><ShieldCheck /> Без имени, email и данных работодателя.</small>
        </aside>
      </section>

      <section className="roadmap-section">
        <div className="roadmap-heading"><div><span className="path-eyebrow">Roadmap</span><h2>Карта компетенций</h2><p>Mastery учитывает покрытие, точность и самостоятельность.</p></div><Trophy /></div>
        <div className="phase-list">
          {phases.map((phase, phaseIndex) => {
            const phaseModules = mastery.filter(module => phase.moduleIds.includes(module.id));
            const expanded = expandedPhase === phase.id;
            return <article className={`phase-card ${phase.unlocked ? '' : 'locked'}`} key={phase.id}>
              <button className="phase-summary" onClick={() => phase.unlocked && setExpandedPhase(expanded ? '' : phase.id)}>
                <span className="phase-number">{phase.unlocked ? String(phaseIndex + 1).padStart(2, '0') : <LockKeyhole />}</span>
                <span className="phase-title"><strong>{phase.title}</strong><small>{phase.subtitle}</small></span>
                <span className="phase-progress"><i><b style={{ width: `${phase.mastery}%` }} /></i><small>{phase.mastery}% mastery</small></span>
                <span className={phase.checkpointPassed ? 'checkpoint passed' : 'checkpoint'}>{phase.checkpointPassed ? <Check /> : <Flag />}{phase.checkpointPassed ? 'Пройден' : 'Checkpoint'}</span>
                <ChevronRight className={expanded ? 'rotated' : ''} />
              </button>
              {expanded && <div className="phase-modules">
                {phaseModules.map(module => <button className={`module-node ${module.level}`} key={module.id} onClick={() => module.recommendedTask && startTask(module.recommendedTask)} disabled={module.level === 'locked'}>
                  <span className="module-state">{module.level === 'mastered' ? <Check /> : module.level === 'locked' ? <LockKeyhole /> : <Circle />}</span>
                  <span className="module-copy"><strong>{module.title}</strong><small>{levelLabel(module)} · {module.solved}/{module.total} задач</small></span>
                  <span className="module-mastery"><strong>{module.mastery}%</strong><i><b style={{ width: `${module.mastery}%` }} /></i></span>
                  {module.recommendedTask ? <ChevronRight /> : <GraduationCap />}
                </button>)}
                <button className={`checkpoint-card ${phase.checkpointPassed ? 'passed' : ''}`} onClick={() => startTask(phase.checkpointTask)}>
                  <Flag /><span><strong>Контрольная точка этапа</strong><small>{phase.checkpointTask.title}</small></span><b>{phase.checkpointPassed ? 'Пройдено' : 'Проверить себя'}</b><ChevronRight />
                </button>
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
