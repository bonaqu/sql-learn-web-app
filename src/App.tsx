import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SqlJsStatic } from 'sql.js';
import {
  ArrowLeft,
  Award,
  BookOpen,
  BrainCircuit,
  BriefcaseBusiness,
  Bug,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  Cloud,
  Code2,
  Compass,
  Download,
  Flame,
  GraduationCap,
  Home,
  Lightbulb,
  ListChecks,
  LockKeyhole,
  Maximize2,
  Menu,
  MessageSquareText,
  Minimize2,
  Moon,
  Puzzle,
  Repeat2,
  RotateCcw,
  Route,
  Search,
  ShieldCheck,
  Sparkles,
  Sun,
  Target,
  Trophy,
  Upload,
  Wifi,
  WifiOff,
  X
} from 'lucide-react';
import { achievements, modules, SqlTask, tasks } from './data/course-catalog';
import { openJourneyDestination } from './lib/academy-navigation';
import { classifySqlAttempt, type AttemptDiagnostic } from './lib/attempt-diagnostics';
import { localMentor, MentorMode } from './lib/mentor';
import { syncUserProgress } from './lib/auth';
import { productIdentity } from './generated/product-identity';
import {
  loadProgress,
  Progress,
  recordAttempt,
  recordHint,
  recordSolutionView,
  reviewQueue,
  saveProgress,
  weakTopics as calculateWeakTopics
} from './lib/progress';
import { openDeferredFeature, preloadDeferredFeature } from './lib/deferred-features';
import {
  workspaceStageLabel,
  workspaceTaskReadiness,
  type WorkspaceJourneyState,
  type WorkspaceMode
} from './lib/workspace-readiness';
import GuidedHome from './components/GuidedHome';

const Editor = lazy(() => import('./components/SqlEditor'));
type SqlEngine = SqlJsStatic;
type View = 'home' | 'catalog' | 'practice' | 'review' | 'interview' | 'puzzle' | 'achievements' | 'mentor';
type SqlTable = { columns: string[]; values: unknown[][] };
type RunStatus = 'idle' | 'success' | 'error';
type WeakTopic = ReturnType<typeof calculateWeakTopics>[number];

const PROFILE_KEY = 'sql-academy-profile-id';

function profileId() {
  const saved = localStorage.getItem(PROFILE_KEY);
  if (saved) return saved;
  const id = crypto.randomUUID();
  localStorage.setItem(PROFILE_KEY, id);
  return id;
}

function normalize(value: unknown) {
  if (value === null) return 'NULL';
  if (typeof value === 'number') return Number.isInteger(value)
    ? String(value)
    : value.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
  return String(value);
}

function workspaceModeForTask(task: SqlTask, view: View): WorkspaceMode {
  if (view === 'review') return 'review';
  if (task.mode === 'interview') return 'interview';
  if (task.mode === 'puzzle') return 'puzzle';
  return 'practice';
}

const mentorQuestions: Record<MentorMode, string> = {
  'next-step': 'Дай только один следующий шаг. Не показывай готовый запрос.',
  debug: 'Найди наиболее вероятную причину ошибки или несовпадения результата.',
  concept: 'Объясни концепт задачи простыми словами и свяжи его с текущим SQL.',
  review: 'Подготовь короткий план повторной попытки по моим ошибкам.'
};

function App() {
  const initialProgress = useMemo(() => loadProgress(), []);
  const [progress, setProgress] = useState<Progress>(initialProgress);
  const [view, setView] = useState<View>('home');
  const [theme, setTheme] = useState<'dark' | 'light'>(() => (localStorage.getItem('sql-theme') as 'dark' | 'light') || 'dark');
  const [query, setQuery] = useState('');
  const [moduleFilter, setModuleFilter] = useState('all');
  const [selected, setSelected] = useState<SqlTask>(() => tasks.find(task => task.id === initialProgress.lastTask) || tasks[0]);
  const [sql, setSql] = useState(selected.starter);
  const [result, setResult] = useState<SqlTable[]>([]);
  const [message, setMessage] = useState('SQLite загружается…');
  const [status, setStatus] = useState<RunStatus>('idle');
  const [engine, setEngine] = useState<SqlEngine | null>(null);
  const [syncState, setSyncState] = useState<'local' | 'syncing' | 'synced'>('local');
  const [mobileNav, setMobileNav] = useState(false);
  const [mobileTaskOpen, setMobileTaskOpen] = useState(false);
  const [editorFullscreen, setEditorFullscreen] = useState(false);
  const [visibleHints, setVisibleHints] = useState(0);
  const [showSolution, setShowSolution] = useState(false);
  const [solutionViewedThisSession, setSolutionViewedThisSession] = useState(false);
  const [attemptDiagnostic, setAttemptDiagnostic] = useState<AttemptDiagnostic | null>(null);
  const [mentorMode, setMentorMode] = useState<MentorMode>('next-step');
  const [mentorAnswer, setMentorAnswer] = useState('Mentor готов дать следующий шаг, разобрать ошибку или объяснить концепт.');
  const [mentorLoading, setMentorLoading] = useState(false);
  const [workspaceJourney, setWorkspaceJourney] = useState<WorkspaceJourneyState | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const workspaceActive = view === 'catalog' || view === 'practice' || view === 'review' || view === 'interview' || view === 'puzzle';

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('sql-theme', theme);
  }, [theme]);

  useEffect(() => saveProgress(progress), [progress]);

  useEffect(() => {
    const notify = (dirty: boolean) => window.dispatchEvent(new CustomEvent('sql-academy-dirty-state', { detail: { dirty } }));
    notify(workspaceActive && sql !== selected.starter);
    return () => { notify(false); };
  }, [selected.id, selected.starter, sql, workspaceActive]);

  useEffect(() => {
    if (!workspaceActive || engine) return;
    let cancelled = false;
    setMessage('SQLite загружается…');
    import('./lib/sql-browser')
      .then(module => module.default())
      .then(sqlEngine => {
        if (cancelled) return;
        setEngine(sqlEngine);
        setMessage('SQLite готов. Выполни запрос.');
      })
      .catch(() => { if (!cancelled) setMessage('Не удалось запустить локальный SQLite. Перезагрузи приложение.'); });
    return () => { cancelled = true; };
  }, [engine, workspaceActive]);

  useEffect(() => {
    if (!workspaceActive) {
      setWorkspaceJourney(null);
      return;
    }
    let disposed = false;
    const cleanups: Array<() => void> = [];

    Promise.all([
      import('./lib/journey-evidence'),
      import('./lib/learning-journey'),
      import('./data/complete-curriculum'),
      import('./data/learning-structure'),
      import('./lib/learner-onboarding')
    ]).then(([evidenceModule, journeyModule, curriculumData, structure, onboardingModule]) => {
      if (disposed) return;
      const refresh = () => {
        const evidence = evidenceModule.loadJourneyEvidenceSnapshot();
        const profile = onboardingModule.loadOnboardingProfile();
        const action = journeyModule.nextJourneyAction(progress, evidence.curriculum, {
          includeReview: false,
          passedCheckpointIds: evidence.passedCheckpointIds,
          assessmentComplete: evidence.assessmentComplete,
          bypassedModuleIds: profile.placement.status === 'completed'
            ? profile.placement.strongModuleIds
            : []
        });
        const passedCheckpoints = new Set(evidence.passedCheckpointIds);
        const passedPhaseIds = structure.phaseDefinitions
          .filter(phase => curriculumData.curriculumCheckpoints.some(checkpoint =>
            passedCheckpoints.has(checkpoint.id)
            && checkpoint.moduleIds.some(moduleId => phase.moduleIds.some(id => id === moduleId))
          ))
          .map(phase => phase.id);
        if (!disposed) setWorkspaceJourney({ action, passedPhaseIds });
      };
      refresh();
      for (const eventName of evidenceModule.JOURNEY_EVIDENCE_EVENTS) {
        window.addEventListener(eventName, refresh);
        cleanups.push(() => window.removeEventListener(eventName, refresh));
      }
    }).catch(() => {
      if (!disposed) setWorkspaceJourney(null);
    });

    return () => {
      disposed = true;
      for (const cleanup of cleanups) cleanup();
    };
  }, [progress, workspaceActive]);

  useEffect(() => {
    document.body.style.overflow = editorFullscreen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [editorFullscreen]);

  const queue = useMemo(() => reviewQueue(progress), [progress]);
  const selectedReviewTaskIsDue = view !== 'review' || queue.some(task => task.id === selected.id);
  const focusTopics = useMemo(() => calculateWeakTopics(progress), [progress]);
  const completed = useMemo(() => new Set(progress.completed), [progress.completed]);
  const currentStats = progress.taskStats[selected.id] || { attempts: 0, incorrect: 0, hintsUsed: 0 };
  const solutionUnlocked = currentStats.attempts >= 3 || visibleHints >= selected.hints.length;
  const guidedSession = visibleHints > 0 || solutionViewedThisSession;

  const filteredTasks = useMemo(() => {
    const source = view === 'review' ? queue : tasks;
    return source.filter(task => {
      const text = `${task.title} ${task.description} ${task.topic} ${task.difficulty}`.toLowerCase();
      const modeMatches = view === 'practice'
        ? task.mode === 'practice' || task.mode === 'lesson'
        : view === 'interview'
          ? task.mode === 'interview'
          : view === 'puzzle'
            ? task.mode === 'puzzle'
            : true;
      return modeMatches
        && (moduleFilter === 'all' || task.module === moduleFilter)
        && text.includes(query.trim().toLowerCase());
    });
  }, [moduleFilter, query, queue, view]);

  const selectedReadiness = useMemo(() => workspaceTaskReadiness(
    selected,
    progress,
    workspaceJourney,
    workspaceModeForTask(selected, view)
  ), [progress, selected, view, workspaceJourney]);

  const readinessByTask = useMemo(() => new Map(filteredTasks.map(task => [
    task.id,
    workspaceTaskReadiness(task, progress, workspaceJourney, workspaceModeForTask(task, view))
  ])), [filteredTasks, progress, view, workspaceJourney]);

  const selectTask = (task: SqlTask) => {
    const targetMode = workspaceModeForTask(task, view);
    const readiness = workspaceTaskReadiness(task, progress, workspaceJourney, targetMode);
    setSelected(task);
    setSql(task.starter);
    setResult([]);
    setStatus('idle');
    setMessage(readiness.canRun
      ? 'Задача открыта. Сначала опиши ожидаемый результат, затем пиши SQL.'
      : `Предпросмотр без зачёта: ${readiness.reason}`);
    setVisibleHints(0);
    setShowSolution(false);
    setSolutionViewedThisSession(false);
    setAttemptDiagnostic(null);
    setMentorAnswer('Mentor видит условие и текущий SQL, но не раскрывает решение без необходимости.');
    setProgress(current => ({ ...current, lastTask: task.id }));
    setMobileTaskOpen(true);
    if (view === 'catalog') {
      setView(task.mode === 'interview' ? 'interview' : task.mode === 'puzzle' ? 'puzzle' : 'practice');
    }
  };

  const runSql = useCallback(async () => {
    if (!selectedReviewTaskIsDue) {
      setStatus('idle');
      setMessage('Эта задача уже не входит в очередь повторения. Открой актуальный следующий шаг.');
      return;
    }
    if (!selectedReadiness.canRun) {
      setStatus('idle');
      setMessage(`Предпросмотр без зачёта: ${selectedReadiness.reason}`);
      return;
    }
    if (!engine) return;
    try {
      const { evaluateTaskSql } = await import('./lib/task-evaluation-contract');
      const evaluation = evaluateTaskSql(engine, selected, sql, 'practice');
      const output = evaluation.output;
      const correct = evaluation.correct;
      const independent = correct && visibleHints === 0 && !solutionViewedThisSession;
      const diagnostic = correct
        ? null
        : evaluation.diagnostic || classifySqlAttempt({ task: selected, sql, actual: output });
      setResult(output as SqlTable[]);
      setStatus(correct ? 'success' : 'error');
      setAttemptDiagnostic(diagnostic);
      setMessage(correct
        ? independent
          ? 'Верно. Самостоятельное решение подтверждено: результат получен без подсказки и эталона.'
          : 'Верно. Результат совпал, но в этой попытке использовалась помощь. Повтори позже без подсказки и эталона, чтобы закрепить самостоятельное решение.'
        : `${diagnostic?.title || 'Результат отличается'}. ${diagnostic?.nextStep || 'Сравни контракт результата.'}`);
      setProgress(current => recordAttempt(current, selected, correct, {
        diagnostic: diagnostic || undefined,
        independent,
        contractEvidence: evaluation.evidence || undefined
      }));
      if (!correct) {
        setMentorMode('debug');
        setMentorAnswer(localMentor({
          mode: 'debug',
          sql,
          task: selected,
          message: diagnostic?.nextStep || 'Результат отличается от контрольного.',
          attempts: currentStats.attempts + 1,
          hintsUsed: visibleHints
        }));
      }
    } catch (error) {
      const errorMessage = `Ошибка SQLite: ${error instanceof Error ? error.message : String(error)}`;
      const diagnostic = classifySqlAttempt({ task: selected, sql, errorMessage });
      setResult([]);
      setStatus('error');
      setAttemptDiagnostic(diagnostic);
      setMessage(`${errorMessage} ${diagnostic.nextStep}`);
      setProgress(current => recordAttempt(current, selected, false, { diagnostic }));
      setMentorMode('debug');
      setMentorAnswer(localMentor({
        mode: 'debug',
        sql,
        task: selected,
        message: `${errorMessage}. ${diagnostic.nextStep}`,
        attempts: currentStats.attempts + 1,
        hintsUsed: visibleHints
      }));
    }
  }, [currentStats.attempts, engine, selected, selectedReadiness, selectedReviewTaskIsDue, solutionViewedThisSession, sql, visibleHints]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        event.preventDefault();
        runSql();
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        searchRef.current?.focus();
      }
      if (event.key === 'Escape' && editorFullscreen) setEditorFullscreen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [editorFullscreen, runSql]);

  const revealHint = () => {
    if (!selectedReviewTaskIsDue) {
      setMessage('Подсказки закрыты: задача больше не входит в очередь повторения.');
      return;
    }
    if (!selectedReadiness.canRun) {
      setMessage(`Подсказки недоступны в режиме предпросмотра: ${selectedReadiness.reason}`);
      return;
    }
    if (visibleHints >= selected.hints.length) return;
    setVisibleHints(value => value + 1);
    setProgress(current => recordHint(current, selected.id));
  };

  const toggleSolution = () => {
    if (!selectedReviewTaskIsDue) {
      setMessage('Эталон закрыт: задача больше не входит в очередь повторения.');
      setStatus('idle');
      return;
    }
    if (!selectedReadiness.canRun) {
      setMessage(`Эталон недоступен в режиме предпросмотра: ${selectedReadiness.reason}`);
      setStatus('idle');
      return;
    }
    if (!solutionUnlocked) {
      setMessage('Эталон откроется после трёх попыток или просмотра всех подсказок. Сначала попробуй ещё один шаг.');
      setStatus('idle');
      return;
    }
    const opening = !showSolution;
    if (opening && !solutionViewedThisSession) {
      setSolutionViewedThisSession(true);
      setProgress(current => recordSolutionView(current, selected.id));
    }
    setShowSolution(opening);
  };

  const askMentor = async (mode: MentorMode) => {
    setMentorMode(mode);
    setMentorLoading(true);
    const context = {
      mode,
      sql,
      task: selected,
      message,
      attempts: currentStats.attempts,
      hintsUsed: visibleHints
    };
    setMentorAnswer(localMentor(context));

    try {
      const response = await fetch('/api/mentor', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-profile-id': profileId() },
        body: JSON.stringify({
          mode,
          question: mentorQuestions[mode],
          sql,
          task: selected.description,
          topic: selected.topic,
          difficulty: selected.difficulty,
          lastFeedback: message,
          attempts: currentStats.attempts,
          hintsUsed: visibleHints,
          allowSolution: solutionUnlocked && selectedReadiness.canRun
        })
      });
      if (!response.ok) throw new Error('mentor');
      const data = await response.json() as { answer: string };
      setMentorAnswer(data.answer);
    } catch {
      setMentorAnswer(localMentor(context));
    } finally {
      setMentorLoading(false);
    }
  };

  const exportProgress = () => {
    const blob = new Blob([JSON.stringify({ version: 4, exportedAt: new Date().toISOString(), progress }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'sql-academy-progress.json';
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const importProgress = (file?: File) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        const imported = parsed.progress || parsed;
        localStorage.setItem('sql-academy-progress-v4', JSON.stringify(imported));
        setProgress(loadProgress());
        setMessage('Прогресс импортирован.');
      } catch {
        setMessage('Файл прогресса повреждён или имеет неподдерживаемый формат.');
      }
    };
    reader.readAsText(file);
  };

  const syncProgress = async () => {
    setSyncState('syncing');
    try {
      const synced = await syncUserProgress();
      setProgress(synced.progress);
      setSyncState('synced');
    } catch {
      setSyncState('local');
      setMessage('Облачная синхронизация недоступна. Локальный прогресс сохранён.');
    }
  };

  const navigate = (next: View) => {
    setView(next);
    setMobileNav(false);
    setMobileTaskOpen(false);
    if (next !== 'catalog') setModuleFilter('all');
    window.requestAnimationFrame(() => document.getElementById('main-content')?.focus({ preventScroll: true }));
  };

  const openCanonicalAction = () => {
    const action = workspaceJourney?.action;
    if (!action) return;
    if (action.task) {
      const nextView: View = action.task.mode === 'interview'
        ? 'interview'
        : action.task.mode === 'puzzle'
          ? 'puzzle'
          : 'practice';
      navigate(nextView);
      selectTask(action.task);
      return;
    }
    openJourneyDestination(action);
  };

  const workspaceTitle = view === 'catalog'
    ? 'Каталог академии'
    : view === 'practice'
      ? 'Практика'
      : view === 'review'
        ? 'Повторение'
        : view === 'interview'
          ? 'Интервью'
          : 'SQL-головоломки';

  return <><a className="skip-link" href="#main-content">Перейти к содержимому</a><div className="app">
    <aside className={`sidebar ${mobileNav ? 'open' : ''}`} aria-label="Основная навигация">
      <button className="logo" onClick={() => navigate('home')} aria-label={`${productIdentity.productName} — главная`}>
        <img src={`${import.meta.env.BASE_URL}logo.svg`} alt="" />
        <strong>{productIdentity.shortName}</strong>
      </button>
      <button className="close-mobile" onClick={() => setMobileNav(false)} aria-label="Закрыть меню"><X /></button>
      <nav aria-label="Разделы академии">
        <span className="primary-nav-label">Обучение</span>
        <Nav icon={<Home />} label="Сегодня" active={view === 'home'} onClick={() => navigate('home')} />
        <button type="button" data-testid="learning-path-trigger" onMouseEnter={() => preloadDeferredFeature('learning-path')} onFocus={() => preloadDeferredFeature('learning-path')} onClick={() => openDeferredFeature('learning-path')}><Route /><span>Маршрут</span></button>
        <Nav icon={<BrainCircuit />} label="Практика" active={view === 'practice'} onClick={() => navigate('practice')} />
        <Nav icon={<Repeat2 />} label={`Повторение${queue.length ? ` · ${queue.length}` : ''}`} active={view === 'review'} onClick={() => navigate('review')} />
        <button type="button" data-testid="assessment-trigger" onMouseEnter={() => preloadDeferredFeature('assessment')} onFocus={() => preloadDeferredFeature('assessment')} onClick={() => openDeferredFeature('assessment')}><ClipboardCheck /><span>Проверка</span></button>
        <details className="nav-more">
          <summary><ListChecks /><span>Все разделы</span><ChevronDown /></summary>
          <div className="nav-secondary-tools">
            <button type="button" data-testid="curriculum-trigger" onMouseEnter={() => preloadDeferredFeature('curriculum')} onFocus={() => preloadDeferredFeature('curriculum')} onClick={() => openDeferredFeature('curriculum')}><GraduationCap /><span>Уроки</span></button>
            <Nav icon={<BookOpen />} label="Каталог задач" active={view === 'catalog'} onClick={() => navigate('catalog')} />
            <Nav icon={<BriefcaseBusiness />} label="Интервью" active={view === 'interview'} onClick={() => navigate('interview')} />
            <button type="button" data-testid="syllabus-trigger" onMouseEnter={() => preloadDeferredFeature('syllabus')} onFocus={() => preloadDeferredFeature('syllabus')} onClick={() => openDeferredFeature('syllabus')}><ListChecks /><span>Диалекты и карта курса</span></button>
            <Nav icon={<Puzzle />} label="SQL-головоломки" active={view === 'puzzle'} onClick={() => navigate('puzzle')} />
            <Nav icon={<Trophy />} label="Достижения" active={view === 'achievements'} onClick={() => navigate('achievements')} />
            <Nav icon={<Sparkles />} label="SQL-наставник" active={view === 'mentor'} onClick={() => navigate('mentor')} />
          </div>
        </details>
      </nav>
      <div className="sidebar-bottom">
        <a href={productIdentity.repositoryUrl} target="_blank" rel="noreferrer"><Code2 size={17} /> Репозиторий</a>
        <a href={productIdentity.supportUrl} target="_blank" rel="noreferrer"><MessageSquareText size={17} /> Поддержка</a>
        <span className="privacy">{productIdentity.licenseLabel} · {productIdentity.privacyLabel}</span>
      </div>
    </aside>

    <main id="main-content" tabIndex={-1}>
      <header className="topbar">
        <button className="mobile-menu" onClick={() => setMobileNav(true)} aria-label="Открыть меню"><Menu /></button>
        {view === 'home' ? <div className="topbar-context"><Compass /><span>Один следующий шаг вместо каталога функций</span></div> : <div className="search">
          <Search size={18} />
          <input ref={searchRef} value={query} onChange={event => setQuery(event.target.value)} placeholder="Поиск по задачам и темам…" aria-label="Поиск по задачам и темам" />
          <kbd>Ctrl K</kbd>
        </div>}
        <div className="header-actions">
          <span className="xp"><Flame size={17} />{progress.xp} XP</span>
          <button className="icon" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} aria-label="Переключить тему">{theme === 'dark' ? <Sun /> : <Moon />}</button>
          <button className="icon" onClick={syncProgress} aria-label="Синхронизировать прогресс">{syncState === 'synced' ? <Wifi /> : syncState === 'syncing' ? <Cloud className="spin" /> : <WifiOff />}</button>
        </div>
      </header>

      {view === 'home' && <GuidedHome
        progress={progress}
        reviewCount={queue.length}
        onStartTask={task => { navigate('practice'); selectTask(task); }}
        onReview={() => navigate('review')}
        onOpenPlan={() => openDeferredFeature('learning-path')}
        onOpenLessons={() => openDeferredFeature('curriculum')}
        onConfigure={() => openDeferredFeature('onboarding')}
        onExplore={() => navigate('catalog')}
      />}

      {(view === 'catalog' || view === 'practice' || view === 'review' || view === 'interview' || view === 'puzzle') && (
        view === 'review' && queue.length === 0
          ? <section className="review-queue-empty" data-testid="review-empty-state" aria-labelledby="review-empty-title">
              <ShieldCheck />
              <div>
                <small>Очередь актуальна</small>
                <h1 id="review-empty-title">На сегодня повторений нет</h1>
                <p>Новые задачи появятся после ошибок, попыток с помощью или когда подойдёт срок следующего самостоятельного воспроизведения.</p>
              </div>
              <button className="primary" onClick={() => workspaceJourney?.action ? openCanonicalAction() : navigate('practice')}>
                <BrainCircuit /> Продолжить обучение
              </button>
            </section>
          : <section className={`workspace ${mobileTaskOpen ? 'task-open' : ''}`} data-review-task-id={view === 'review' ? selected.id : undefined}>
          <div className="catalog-panel">
            <div className="section-heading">
              <div>
                <h1>{workspaceTitle}</h1>
                <p>{view === 'review' ? `${queue.length} задач в адаптивной очереди` : `${filteredTasks.length} задач · доступные можно запускать, остальные показывают будущий этап`}</p>
              </div>
              <select value={moduleFilter} onChange={event => setModuleFilter(event.target.value)} aria-label="Фильтр по модулю">
                <option value="all">Все модули</option>
                {modules.map(([id, title]) => <option key={id} value={id}>{title}</option>)}
              </select>
            </div>
            <div className="task-list">
              {!filteredTasks.length && <div className="empty-state"><ShieldCheck /><h3>Очередь пуста</h3><p>Решай новые задачи — сложные темы появятся здесь автоматически.</p></div>}
              {filteredTasks.map(task => {
                const stats = progress.taskStats[task.id];
                const readiness = readinessByTask.get(task.id);
                const preview = readiness && !readiness.canRun;
                return <button
                  className={`task-row ${selected.id === task.id ? 'active' : ''} ${preview ? 'preview' : ''}`}
                  onClick={() => selectTask(task)}
                  key={task.id}
                  data-readiness={readiness?.status || 'loading'}
                >
                  <span className="task-number">{task.id.replace('task-', '')}</span>
                  <span>
                    <strong>{task.title}</strong>
                    <small>{task.difficulty} · {workspaceStageLabel(task)} · {readiness?.label || 'Сверяю маршрут'} · {task.xp} XP{stats?.incorrect ? ` · ошибок ${stats.incorrect}` : ''}{stats?.independentPasses ? ' · самостоятельно ✓' : ''}</small>
                  </span>
                  {preview ? <LockKeyhole className="preview-lock" /> : completed.has(task.id) ? <CheckCircle2 className="done" /> : <ChevronRight />}
                </button>;
              })}
            </div>
          </div>

          <div className={`editor-panel ${editorFullscreen ? 'fullscreen' : ''}`}>
            <div className="mobile-task-bar">
              <button onClick={() => setMobileTaskOpen(false)}><ArrowLeft /> К списку</button>
              <span>{selected.id.replace('task-', '#')}</span>
            </div>

            <div className="task-copy">
              <div className="task-meta">
                <span>{selected.topic}</span><span>{selected.difficulty}</span><span>{selected.xp} XP</span>
                <span>{workspaceStageLabel(selected)}</span>
                <span className={selectedReadiness.canRun ? 'stage-ready' : 'stage-preview'}>{selectedReadiness.label}</span>
                <span className={guidedSession ? 'guided-attempt' : 'independent-attempt'}>{guidedSession ? 'Попытка с помощью' : 'Самостоятельная попытка'}</span>
              </div>
              {!selectedReadiness.canRun && <section className="workspace-readiness-gate" data-testid="workspace-preview-gate" aria-live="polite">
                <LockKeyhole />
                <div><small>{selectedReadiness.status === 'loading' ? 'Проверяю готовность' : 'Предпросмотр без зачёта'}</small><h3>{selectedReadiness.label}</h3><p>{selectedReadiness.reason}</p></div>
                <button onClick={openCanonicalAction} disabled={!workspaceJourney}>Открыть правильный следующий этап <ChevronRight /></button>
              </section>}
              <div className="task-title-row">
                <div><h2>{selected.title}</h2><p>{selected.description}</p></div>
                <button className="icon expand-editor" onClick={() => setEditorFullscreen(value => !value)} aria-label={editorFullscreen ? 'Свернуть редактор' : 'Развернуть редактор'}>
                  {editorFullscreen ? <Minimize2 /> : <Maximize2 />}
                </button>
              </div>

              <details className="lesson-card">
                <summary><GraduationCap /> Разбор темы</summary>
                <div className="lesson-content">
                  <p><strong>Суть:</strong> {selected.guide.summary}</p>
                  <p><strong>Как рассуждать:</strong> {selected.guide.mentalModel}</p>
                  <pre><code>{selected.guide.example}</code></pre>
                  <div className="lesson-columns">
                    <div><h4>Чек-лист</h4><ul>{selected.guide.checklist.map(item => <li key={item}>{item}</li>)}</ul></div>
                    <div><h4>Типовые ошибки</h4><ul>{selected.guide.commonMistakes.map(item => <li key={item}>{item}</li>)}</ul></div>
                  </div>
                </div>
              </details>

              <div className="hint-card">
                <div><Lightbulb /><span><strong>Прогрессивные подсказки</strong><small>{visibleHints}/{selected.hints.length} открыто</small></span></div>
                <button onClick={revealHint} disabled={!selectedReadiness.canRun || visibleHints >= selected.hints.length}>Следующая подсказка</button>
                {visibleHints > 0 && <ol>{selected.hints.slice(0, visibleHints).map(hint => <li key={hint}>{hint}</li>)}</ol>}
              </div>
            </div>

            <div className="editor-wrap">
              <Suspense fallback={<div className="loading">Загрузка Monaco Editor…</div>}>
                <Editor
                  height={editorFullscreen ? 'calc(100vh - 220px)' : '340px'}
                  language="sql"
                  theme={theme === 'dark' ? 'vs-dark' : 'light'}
                  value={sql}
                  onChange={value => setSql(value || '')}
                  options={{
                    minimap: { enabled: false },
                    fontSize: 15,
                    lineHeight: 23,
                    padding: { top: 18 },
                    automaticLayout: true,
                    wordWrap: 'on',
                    scrollBeyondLastLine: false,
                    suggestOnTriggerCharacters: true,
                    quickSuggestions: true,
                    tabSize: 2
                  }}
                />
              </Suspense>
            </div>

            <div className="runner-actions">
              <button className="primary" onClick={runSql} disabled={!engine || !selectedReadiness.canRun}><Code2 /> {selectedReadiness.canRun ? 'Проверить SQL' : 'Запуск пока закрыт'} <kbd>Ctrl ↵</kbd></button>
              <button onClick={() => { setSql(selected.starter); setResult([]); setStatus('idle'); setAttemptDiagnostic(null); setMessage('Редактор сброшен.'); }}><RotateCcw /> Сбросить</button>
              <button onClick={toggleSolution} disabled={!selectedReadiness.canRun}><Target /> {showSolution ? 'Скрыть решение' : solutionUnlocked ? 'Показать решение' : 'Решение заблокировано'}</button>
            </div>

            {showSolution && <div className="solution-card"><strong>Эталонный вариант</strong><pre>{selected.solution}</pre></div>}
            <div className={`feedback ${status}`} role="status" aria-live="polite"><p>{message}</p><span>Попыток: {currentStats.attempts} · Ошибок: {currentStats.incorrect} · Подсказок: {currentStats.hintsUsed} · Самостоятельно: {currentStats.independentPasses || 0}</span></div>
            {status === 'success' && workspaceJourney?.action && <section className="workspace-next-step" data-testid="workspace-next-step">
              <CheckCircle2 />
              <div><small>Следующий канонический этап</small><h3>{workspaceJourney.action.title}</h3><p>{workspaceJourney.action.description}</p></div>
              <button onClick={openCanonicalAction}>{workspaceJourney.action.cta} <ChevronRight /></button>
            </section>}
            {attemptDiagnostic && <section className="attempt-diagnostic" data-testid="attempt-diagnostic" aria-label="Диагностика попытки">
              <Bug />
              <div><small>Диагностика попытки · {attemptDiagnostic.kind}</small><h3>{attemptDiagnostic.title}</h3><p>{attemptDiagnostic.explanation}</p><strong>Следующий шаг: {attemptDiagnostic.nextStep}</strong></div>
            </section>}

            <div className="output-mentor-grid">
              <section className="result-area">
                <div className="panel-heading"><ListChecks /><div><h3>Результат SQLite</h3><p>Сравни форму данных с условием задачи.</p></div></div>
                <ResultTables tables={result} />
                {!result.length && <div className="empty-output">После запуска здесь появятся столбцы и строки результата.</div>}
              </section>

              <MentorPanel
                answer={mentorAnswer}
                loading={mentorLoading}
                activeMode={mentorMode}
                onAsk={askMentor}
              />
            </div>
          </div>
          </section>)}

      {view === 'achievements' && <section className="page">
        <h1>Достижения</h1>
        <p className="lead">Вехи обучения и инженерная готовность.</p>
        <div className="achievement-grid">{achievements.map((item, index) => {
          const unlocked = progress.completed.length >= item.threshold;
          return <article className={unlocked ? 'achievement unlocked' : 'achievement'} key={item.id}>
            <Award /><span>0{index + 1}</span><h3>{item.title}</h3><p>{item.description}</p><strong>{unlocked ? 'Получено' : `${Math.min(progress.completed.length, item.threshold)} / ${item.threshold}`}</strong>
          </article>;
        })}</div>
      </section>}

      {view === 'mentor' && <MentorDashboard
        progress={progress}
        focusTopics={focusTopics}
        queue={queue}
        selected={selected}
        answer={mentorAnswer}
        loading={mentorLoading}
        onAsk={askMentor}
        onOpenTask={task => { setView('review'); selectTask(task); }}
      />}

      <footer>
        <div><button onClick={exportProgress}><Download /> Экспорт</button><label className="button"><Upload /> Импорт<input hidden type="file" accept="application/json" onChange={event => importProgress(event.target.files?.[0])} /></label></div>
        <span>{productIdentity.productName} · T-Bonk training dataset · {productIdentity.privacyLabel}</span>
      </footer>
    </main>

    <nav className="mobile-bottom-nav" aria-label="Мобильная навигация">
      <MobileNav icon={<Home />} label="Сегодня" active={view === 'home'} onClick={() => navigate('home')} />
      <button type="button" data-testid="learning-path-mobile-trigger" onTouchStart={() => preloadDeferredFeature('learning-path')} onFocus={() => preloadDeferredFeature('learning-path')} onClick={() => openDeferredFeature('learning-path')}><span className="mobile-nav-icon"><Route /></span><small>Маршрут</small></button>
      <MobileNav icon={<BrainCircuit />} label="Практика" active={view === 'practice'} onClick={() => navigate('practice')} />
      <button type="button" data-testid="mobile-more-trigger" onClick={() => setMobileNav(true)}><span className="mobile-nav-icon"><Menu /></span><small>Ещё</small></button>
    </nav>
  </div></>;
}

function Nav({ icon, label, active, onClick }: { icon: React.ReactNode; label: string; active: boolean; onClick: () => void }) {
  return <button className={active ? 'active' : ''} onClick={onClick} aria-current={active ? 'page' : undefined}>{icon}<span>{label}</span></button>;
}

function MobileNav({ icon, label, active, badge, onClick }: { icon: React.ReactNode; label: string; active: boolean; badge?: number; onClick: () => void }) {
  return <button className={active ? 'active' : ''} onClick={onClick} aria-current={active ? 'page' : undefined}><span className="mobile-nav-icon">{icon}{badge ? <b>{badge > 9 ? '9+' : badge}</b> : null}</span><small>{label}</small></button>;
}

function ResultTables({ tables }: { tables: SqlTable[] }) {
  if (!tables.length) return null;
  return <div className="result-stack">{tables.map((table, index) => <div className="result-table-wrap" key={index}>
    <table><caption className="sr-only">Результат SQL-запроса, таблица {index + 1}</caption><thead><tr>{table.columns.map(column => <th scope="col" key={column}>{column}</th>)}</tr></thead><tbody>{table.values.map((row, rowIndex) => <tr key={rowIndex}>{row.map((value, cellIndex) => <td key={cellIndex}>{normalize(value)}</td>)}</tr>)}</tbody></table>
    <div className="row-count">{table.values.length} строк</div>
  </div>)}</div>;
}

function MentorPanel({ answer, loading, activeMode, onAsk }: { answer: string; loading: boolean; activeMode: MentorMode; onAsk: (mode: MentorMode) => void }) {
  const actions: Array<{ mode: MentorMode; label: string; icon: React.ReactNode }> = [
    { mode: 'next-step', label: 'Следующий шаг', icon: <MessageSquareText /> },
    { mode: 'debug', label: 'Диагностика', icon: <Bug /> },
    { mode: 'concept', label: 'Объяснить тему', icon: <GraduationCap /> },
    { mode: 'review', label: 'План повтора', icon: <Repeat2 /> }
  ];
  return <aside className="mentor-panel">
    <div className="panel-heading"><Sparkles /><div><h3>AI SQL Mentor</h3><p>Контекстный помощник внутри задачи.</p></div></div>
    <div className="mentor-actions">{actions.map(action => <button className={activeMode === action.mode ? 'active' : ''} onClick={() => onAsk(action.mode)} key={action.mode}>{action.icon}<span>{action.label}</span></button>)}</div>
    <article className={`mentor-answer ${loading ? 'loading-answer' : ''}`}>{loading ? 'Анализирую текущий SQL…' : answer}</article>
    <small>Mentor не получает имя, email или данные работодателя.</small>
  </aside>;
}

function MentorDashboard({ progress, focusTopics, queue, selected, answer, loading, onAsk, onOpenTask }: {
  progress: Progress;
  focusTopics: WeakTopic[];
  queue: SqlTask[];
  selected: SqlTask;
  answer: string;
  loading: boolean;
  onAsk: (mode: MentorMode) => void;
  onOpenTask: (task: SqlTask) => void;
}) {
  return <section className="page mentor-dashboard">
    <div className="mentor-hero"><div><h1>AI SQL Mentor</h1><p className="lead">Не отдельный чат, а наставник, который знает текущую тему, попытки и слабые места.</p></div><Sparkles /></div>
    <div className="mentor-dashboard-grid">
      <article className="mentor-profile"><h2>Учебный профиль</h2><div className="profile-stats"><span><strong>{progress.completed.length}</strong> решено</span><span><strong>{progress.streak}</strong> streak</span><span><strong>{queue.length}</strong> на повтор</span></div><h3>Фокус</h3>{focusTopics.map(topic => <div className="focus-row" key={topic.id}><span>{topic.title}</span><b>{topic.independent}/{topic.total} independent</b></div>)}</article>
      <article className="mentor-workbench"><h2>Текущая задача</h2><strong>{selected.title}</strong><p>{selected.description}</p><div className="mentor-big-actions"><button onClick={() => onAsk('concept')}><GraduationCap /> Объяснить концепт</button><button onClick={() => onAsk('review')}><Repeat2 /> Составить повторение</button></div><div className="mentor-answer">{loading ? 'Анализирую…' : answer}</div></article>
      <article className="review-preview"><h2>Следующие задачи</h2>{queue.slice(0, 5).map(task => <button key={task.id} onClick={() => onOpenTask(task)}><span>{task.id.replace('task-', '#')}</span><p><strong>{task.title}</strong><small>{task.topic}</small></p><ChevronRight /></button>)}</article>
    </div>
  </section>;
}

export default App;
