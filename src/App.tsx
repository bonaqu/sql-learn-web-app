import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { QueryExecResult, SqlJsStatic } from 'sql.js';
import {
  ArrowLeft,
  Award,
  BookOpen,
  BrainCircuit,
  BriefcaseBusiness,
  Bug,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  Cloud,
  Code2,
  Download,
  Flame,
  Github,
  GraduationCap,
  Home,
  Lightbulb,
  ListChecks,
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
import { achievements, modules, SqlTask, tasks, TOTAL_TASK_COUNT } from './data/course-catalog';
import { trainingSeedSql } from './data/training-dataset';
import { localMentor, MentorMode } from './lib/mentor';
import {
  loadProgress,
  Progress,
  recordAttempt,
  recordHint,
  reviewQueue,
  saveProgress,
  weakTopics as calculateWeakTopics
} from './lib/progress';
import { openDeferredFeature, preloadDeferredFeature } from './lib/deferred-features';

const Editor = lazy(() => import('./components/SqlEditor'));
const ActivityChart = lazy(() => import('./components/ActivityChart'));
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

function comparable(results: QueryExecResult[]) {
  return JSON.stringify(results.map(block => ({
    columns: block.columns.map(column => column.toLowerCase()),
    values: block.values.map(row => row.map(normalize))
  })));
}

function execute(engine: SqlEngine, source: string) {
  const database = new engine.Database();
  try {
    database.run(trainingSeedSql);
    return database.exec(source);
  } finally {
    database.close();
  }
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
  const [mentorMode, setMentorMode] = useState<MentorMode>('next-step');
  const [mentorAnswer, setMentorAnswer] = useState('Mentor готов дать следующий шаг, разобрать ошибку или объяснить концепт.');
  const [mentorLoading, setMentorLoading] = useState(false);
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
    import('sql.js')
      .then(module => module.default({ locateFile: file => `https://sql.js.org/dist/${file}` }))
      .then(sqlEngine => {
        if (cancelled) return;
        setEngine(sqlEngine);
        setMessage('SQLite готов. Выполни запрос.');
      })
      .catch(() => { if (!cancelled) setMessage('Не удалось загрузить SQLite WASM. Проверь сеть.'); });
    return () => { cancelled = true; };
  }, [engine, workspaceActive]);

  useEffect(() => {
    document.body.style.overflow = editorFullscreen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [editorFullscreen]);

  const queue = useMemo(() => reviewQueue(progress), [progress]);
  const focusTopics = useMemo(() => calculateWeakTopics(progress), [progress]);
  const completed = useMemo(() => new Set(progress.completed), [progress.completed]);
  const completion = Math.round(progress.completed.length / tasks.length * 100);
  const currentStats = progress.taskStats[selected.id] || { attempts: 0, incorrect: 0, hintsUsed: 0 };
  const solutionUnlocked = currentStats.attempts >= 3 || visibleHints >= selected.hints.length;

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

  const selectTask = (task: SqlTask) => {
    setSelected(task);
    setSql(task.starter);
    setResult([]);
    setStatus('idle');
    setMessage('Задача открыта. Сначала опиши ожидаемый результат, затем пиши SQL.');
    setVisibleHints(0);
    setShowSolution(false);
    setMentorAnswer('Mentor видит условие и текущий SQL, но не раскрывает решение без необходимости.');
    setProgress(current => ({ ...current, lastTask: task.id }));
    setMobileTaskOpen(true);
    if (view === 'catalog') {
      setView(task.mode === 'interview' ? 'interview' : task.mode === 'puzzle' ? 'puzzle' : 'practice');
    }
  };

  const runSql = useCallback(() => {
    if (!engine) return;
    try {
      const output = execute(engine, sql);
      const expected = execute(engine, selected.solution);
      const correct = comparable(output) === comparable(expected);
      setResult(output as SqlTable[]);
      setStatus(correct ? 'success' : 'error');
      setMessage(correct
        ? 'Верно. Столбцы, строки и порядок совпадают с контрольным результатом.'
        : 'SQL выполнился, но результат отличается. Проверь форму результата, фильтр и сортировку.');
      setProgress(current => recordAttempt(current, selected, correct));
      if (!correct) {
        setMentorMode('debug');
        setMentorAnswer(localMentor({
          mode: 'debug',
          sql,
          task: selected,
          message: 'Результат отличается от контрольного.',
          attempts: currentStats.attempts + 1,
          hintsUsed: visibleHints
        }));
      }
    } catch (error) {
      const errorMessage = `Ошибка SQLite: ${error instanceof Error ? error.message : String(error)}`;
      setResult([]);
      setStatus('error');
      setMessage(errorMessage);
      setProgress(current => recordAttempt(current, selected, false));
      setMentorMode('debug');
      setMentorAnswer(localMentor({
        mode: 'debug',
        sql,
        task: selected,
        message: errorMessage,
        attempts: currentStats.attempts + 1,
        hintsUsed: visibleHints
      }));
    }
  }, [currentStats.attempts, engine, selected, sql, visibleHints]);

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
    if (visibleHints >= selected.hints.length) return;
    setVisibleHints(value => value + 1);
    setProgress(current => recordHint(current, selected.id));
  };

  const toggleSolution = () => {
    if (!solutionUnlocked) {
      setMessage('Эталон откроется после трёх попыток или просмотра всех подсказок. Сначала попробуй ещё один шаг.');
      setStatus('idle');
      return;
    }
    setShowSolution(value => !value);
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
          allowSolution: solutionUnlocked
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
      const response = await fetch('/api/progress', {
        method: 'PUT',
        headers: { 'content-type': 'application/json', 'x-profile-id': profileId() },
        body: JSON.stringify(progress)
      });
      if (!response.ok) throw new Error('sync');
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

  const workspaceTitle = view === 'catalog'
    ? 'Каталог академии'
    : view === 'practice'
      ? 'Practice Mode'
      : view === 'review'
        ? 'Повторение'
        : view === 'interview'
          ? 'Interview Mode'
          : 'SQL Puzzle';

  return <><a className="skip-link" href="#main-content">Перейти к содержимому</a><div className="app">
    <aside className={`sidebar ${mobileNav ? 'open' : ''}`} aria-label="Основная навигация">
      <button className="logo" onClick={() => navigate('home')} aria-label="SQL Academy — главная">
        <img src={`${import.meta.env.BASE_URL}logo.svg`} alt="" />
        <strong>SQL Academy</strong>
      </button>
      <button className="close-mobile" onClick={() => setMobileNav(false)} aria-label="Закрыть меню"><X /></button>
      <nav aria-label="Разделы академии">
        <Nav icon={<Home />} label="Главная" active={view === 'home'} onClick={() => navigate('home')} />
        <button type="button" data-testid="learning-path-trigger" onMouseEnter={() => preloadDeferredFeature('learning-path')} onFocus={() => preloadDeferredFeature('learning-path')} onClick={() => openDeferredFeature('learning-path')}><Route /><span>Учебный путь</span></button>
        <button type="button" data-testid="curriculum-trigger" onMouseEnter={() => preloadDeferredFeature('curriculum')} onFocus={() => preloadDeferredFeature('curriculum')} onClick={() => openDeferredFeature('curriculum')}><GraduationCap /><span>Уроки и проекты</span></button>
        <button type="button" data-testid="syllabus-trigger" onMouseEnter={() => preloadDeferredFeature('syllabus')} onFocus={() => preloadDeferredFeature('syllabus')} onClick={() => openDeferredFeature('syllabus')}><ListChecks /><span>Карта курса и диалекты</span></button>
        <Nav icon={<BookOpen />} label="Каталог" active={view === 'catalog'} onClick={() => navigate('catalog')} />
        <Nav icon={<BrainCircuit />} label="Practice" active={view === 'practice'} onClick={() => navigate('practice')} />
        <Nav icon={<Repeat2 />} label={`Повторение${queue.length ? ` · ${queue.length}` : ''}`} active={view === 'review'} onClick={() => navigate('review')} />
        <Nav icon={<BriefcaseBusiness />} label="Interview" active={view === 'interview'} onClick={() => navigate('interview')} />
        <button type="button" data-testid="assessment-trigger" onMouseEnter={() => preloadDeferredFeature('assessment')} onFocus={() => preloadDeferredFeature('assessment')} onClick={() => openDeferredFeature('assessment')}><ClipboardCheck /><span>Assessment Center</span></button>
        <Nav icon={<Puzzle />} label="SQL Puzzle" active={view === 'puzzle'} onClick={() => navigate('puzzle')} />
        <Nav icon={<Trophy />} label="Достижения" active={view === 'achievements'} onClick={() => navigate('achievements')} />
        <Nav icon={<Sparkles />} label="AI Mentor" active={view === 'mentor'} onClick={() => navigate('mentor')} />
      </nav>
      <div className="sidebar-bottom">
        <a href="https://github.com/bonaqu/sql-learn-web-app" target="_blank" rel="noreferrer"><Github size={17} /> GitHub</a>
        <span className="privacy">Open-source · privacy-first</span>
      </div>
    </aside>

    <main id="main-content" tabIndex={-1}>
      <header className="topbar">
        <button className="mobile-menu" onClick={() => setMobileNav(true)} aria-label="Открыть меню"><Menu /></button>
        <div className="search">
          <Search size={18} />
          <input ref={searchRef} value={query} onChange={event => setQuery(event.target.value)} placeholder="Поиск по задачам и темам…" aria-label="Поиск по задачам и темам" />
          <kbd>Ctrl K</kbd>
        </div>
        <div className="header-actions">
          <span className="xp"><Flame size={17} />{progress.xp} XP</span>
          <button className="icon" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} aria-label="Переключить тему">{theme === 'dark' ? <Sun /> : <Moon />}</button>
          <button className="icon" onClick={syncProgress} aria-label="Синхронизировать прогресс">{syncState === 'synced' ? <Wifi /> : syncState === 'syncing' ? <Cloud className="spin" /> : <WifiOff />}</button>
        </div>
      </header>

      {view === 'home' && <HomeView
        progress={progress}
        completion={completion}
        focusTopics={focusTopics}
        reviewCount={queue.length}
        onStart={() => navigate('practice')}
        onReview={() => navigate('review')}
        onOpenTopic={id => { setModuleFilter(id); navigate('catalog'); }}
      />}

      {(view === 'catalog' || view === 'practice' || view === 'review' || view === 'interview' || view === 'puzzle') &&
        <section className={`workspace ${mobileTaskOpen ? 'task-open' : ''}`}>
          <div className="catalog-panel">
            <div className="section-heading">
              <div>
                <h1>{workspaceTitle}</h1>
                <p>{view === 'review' ? `${queue.length} задач в адаптивной очереди` : `${filteredTasks.length} задач · проверка по результату`}</p>
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
                return <button className={`task-row ${selected.id === task.id ? 'active' : ''}`} onClick={() => selectTask(task)} key={task.id}>
                  <span className="task-number">{task.id.replace('task-', '')}</span>
                  <span>
                    <strong>{task.title}</strong>
                    <small>{task.difficulty} · {task.xp} XP{stats?.incorrect ? ` · ошибок ${stats.incorrect}` : ''}</small>
                  </span>
                  {completed.has(task.id) ? <CheckCircle2 className="done" /> : <ChevronRight />}
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
              </div>
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
                  <p><strong>Mental model:</strong> {selected.guide.mentalModel}</p>
                  <pre><code>{selected.guide.example}</code></pre>
                  <div className="lesson-columns">
                    <div><h4>Чек-лист</h4><ul>{selected.guide.checklist.map(item => <li key={item}>{item}</li>)}</ul></div>
                    <div><h4>Типовые ошибки</h4><ul>{selected.guide.commonMistakes.map(item => <li key={item}>{item}</li>)}</ul></div>
                  </div>
                </div>
              </details>

              <div className="hint-card">
                <div><Lightbulb /><span><strong>Прогрессивные подсказки</strong><small>{visibleHints}/{selected.hints.length} открыто</small></span></div>
                <button onClick={revealHint} disabled={visibleHints >= selected.hints.length}>Следующая подсказка</button>
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
              <button className="primary" onClick={runSql} disabled={!engine}><Code2 /> Проверить SQL <kbd>Ctrl ↵</kbd></button>
              <button onClick={() => { setSql(selected.starter); setResult([]); setStatus('idle'); setMessage('Редактор сброшен.'); }}><RotateCcw /> Сбросить</button>
              <button onClick={toggleSolution}><Target /> {showSolution ? 'Скрыть решение' : solutionUnlocked ? 'Показать решение' : 'Решение заблокировано'}</button>
            </div>

            {showSolution && <div className="solution-card"><strong>Эталонный вариант</strong><pre>{selected.solution}</pre></div>}
            <div className={`feedback ${status}`} role="status" aria-live="polite"><p>{message}</p><span>Попыток: {currentStats.attempts} · Ошибок: {currentStats.incorrect} · Подсказок: {currentStats.hintsUsed}</span></div>

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
        </section>}

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
        <span>SQL Academy · T-Bonk training dataset · privacy-first</span>
      </footer>
    </main>

    <nav className="mobile-bottom-nav" aria-label="Мобильная навигация">
      <MobileNav icon={<Home />} label="Главная" active={view === 'home'} onClick={() => navigate('home')} />
      <button type="button" data-testid="learning-path-mobile-trigger" onTouchStart={() => preloadDeferredFeature('learning-path')} onFocus={() => preloadDeferredFeature('learning-path')} onClick={() => openDeferredFeature('learning-path')}><span className="mobile-nav-icon"><Route /></span><small>Путь</small></button>
      <button type="button" data-testid="curriculum-mobile-trigger" onTouchStart={() => preloadDeferredFeature('curriculum')} onFocus={() => preloadDeferredFeature('curriculum')} onClick={() => openDeferredFeature('curriculum')}><span className="mobile-nav-icon"><GraduationCap /></span><small>Уроки</small></button>
      <MobileNav icon={<BrainCircuit />} label="Практика" active={view === 'practice'} onClick={() => navigate('practice')} />
      <MobileNav icon={<Repeat2 />} label="Повтор" active={view === 'review'} badge={queue.length} onClick={() => navigate('review')} />
      <button type="button" data-testid="assessment-mobile-trigger" onTouchStart={() => preloadDeferredFeature('assessment')} onFocus={() => preloadDeferredFeature('assessment')} onClick={() => openDeferredFeature('assessment')}><span className="mobile-nav-icon"><ClipboardCheck /></span><small>Экзамен</small></button>
      <MobileNav icon={<Sparkles />} label="Mentor" active={view === 'mentor'} onClick={() => navigate('mentor')} />
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
      <article className="mentor-profile"><h2>Учебный профиль</h2><div className="profile-stats"><span><strong>{progress.completed.length}</strong> решено</span><span><strong>{progress.streak}</strong> streak</span><span><strong>{queue.length}</strong> на повтор</span></div><h3>Фокус</h3>{focusTopics.map(topic => <div className="focus-row" key={topic.id}><span>{topic.title}</span><b>{topic.solved}/{topic.total}</b></div>)}</article>
      <article className="mentor-workbench"><h2>Текущая задача</h2><strong>{selected.title}</strong><p>{selected.description}</p><div className="mentor-big-actions"><button onClick={() => onAsk('concept')}><GraduationCap /> Объяснить концепт</button><button onClick={() => onAsk('review')}><Repeat2 /> Составить повторение</button></div><div className="mentor-answer">{loading ? 'Анализирую…' : answer}</div></article>
      <article className="review-preview"><h2>Следующие задачи</h2>{queue.slice(0, 5).map(task => <button key={task.id} onClick={() => onOpenTask(task)}><span>{task.id.replace('task-', '#')}</span><p><strong>{task.title}</strong><small>{task.topic}</small></p><ChevronRight /></button>)}</article>
    </div>
  </section>;
}

function HomeView({ progress, completion, focusTopics, reviewCount, onStart, onReview, onOpenTopic }: {
  progress: Progress;
  completion: number;
  focusTopics: WeakTopic[];
  reviewCount: number;
  onStart: () => void;
  onReview: () => void;
  onOpenTopic: (id: string) => void;
}) {
  return <>
    <section className="hero"><div><h1>SQL, который работает<br />в реальной поддержке.</h1><p>Практическая академия для 2nd Support Engineer: точная проверка результата, адаптивное повторение и Mentor в каждой задаче.</p><div className="hero-actions"><button className="primary" onClick={onStart}>Продолжить обучение <ChevronRight /></button>{reviewCount > 0 && <button onClick={onReview}><Repeat2 /> Повторить {reviewCount}</button>}</div><div className="hero-proof"><span><ShieldCheck /> без персональных данных</span><span><BrainCircuit /> {TOTAL_TASK_COUNT} задач</span><span><Sparkles /> AI + local fallback</span></div></div><div className="terminal"><div className="terminal-bar"><i /><i /><i /><span>support_analytics.sql</span></div><pre><b>WITH</b> service_stats <b>AS</b> ({'\n'}  <b>SELECT</b> service, COUNT(*) tickets,{'\n'}         AVG(resolution_minutes) avg_time{'\n'}  <b>FROM</b> tickets <b>GROUP BY</b> service{'\n'}){'\n'}<b>SELECT</b> *, RANK() <b>OVER</b> ({'\n'}  <b>ORDER BY</b> tickets <b>DESC</b>{'\n'}) load_rank <b>FROM</b> service_stats;</pre><div className="terminal-success">✓ Query completed · 5 rows</div></div></section>
    <section className="stats"><article><small>Общий прогресс</small><strong>{completion}%</strong><div className="progress"><i style={{ width: `${completion}%` }} /></div></article><article><small>Решено задач</small><strong>{progress.completed.length}<span>/{TOTAL_TASK_COUNT}</span></strong></article><article><small>Текущий streak</small><strong>{progress.streak}<span> дней</span></strong></article><article><small>На повторение</small><strong>{reviewCount}</strong></article></section>
    <section className="dashboard-grid"><article className="chart-card"><div><h2>Активность</h2><p>Правильно решённые задачи за неделю</p></div><Suspense fallback={<div className="loading" role="status">Загрузка графика активности…</div>}><ActivityChart data={progress.history} /></Suspense></article><article className="modules-card"><h2>Фокус повторения</h2><div>{focusTopics.map((topic, index) => <button className="weak-topic" key={topic.id} onClick={() => onOpenTopic(topic.id)}><span>{String(index + 1).padStart(2, '0')}</span><p><strong>{topic.title}</strong><small>{topic.solved}/{topic.total} решено</small></p><ChevronRight /></button>)}</div></article></section>
  </>;
}

export default App;
