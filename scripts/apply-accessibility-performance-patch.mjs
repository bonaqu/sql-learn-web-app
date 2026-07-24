import { readFileSync, writeFileSync } from 'node:fs';

function read(path) { return readFileSync(path, 'utf8'); }
function write(path, value) { writeFileSync(path, value); }
function replaceOnce(source, before, after, label) {
  const count = source.split(before).length - 1;
  if (count !== 1) throw new Error(`${label}: expected one match, found ${count}`);
  return source.replace(before, after);
}
function replaceRegexOnce(source, pattern, after, label) {
  const matches = source.match(pattern);
  if (!matches || matches.length !== 1) throw new Error(`${label}: expected one regex match, found ${matches?.length || 0}`);
  return source.replace(pattern, after);
}
function replaceAll(source, before, after, minimum, label) {
  const count = source.split(before).length - 1;
  if (count < minimum) throw new Error(`${label}: expected at least ${minimum} matches, found ${count}`);
  return source.split(before).join(after);
}

{
  const path = 'src/App.tsx';
  let source = read(path);
  source = replaceOnce(source,
    "import initSqlJs, { QueryExecResult } from 'sql.js';",
    "import type { QueryExecResult, SqlJsStatic } from 'sql.js';",
    'App sql.js type-only import');
  source = replaceOnce(source,
    "import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';\n",
    '',
    'App static Recharts import');
  source = replaceOnce(source,
    "const Editor = lazy(() => import('@monaco-editor/react'));\ntype SqlEngine = Awaited<ReturnType<typeof initSqlJs>>;",
    "const Editor = lazy(() => import('@monaco-editor/react'));\nconst ActivityChart = lazy(() => import('./components/ActivityChart'));\ntype SqlEngine = SqlJsStatic;",
    'App lazy chart boundary');
  source = replaceOnce(source,
    "  const searchRef = useRef<HTMLInputElement>(null);",
    [
      "  const searchRef = useRef<HTMLInputElement>(null);",
      "  const workspaceActive = view === 'catalog' || view === 'practice' || view === 'review' || view === 'interview' || view === 'puzzle';"
    ].join('\n'),
    'App workspace active flag');
  source = replaceRegexOnce(source,
    /  useEffect\(\(\) => \{\n    initSqlJs\(\{ locateFile: file => `https:\/\/sql\.js\.org\/dist\/\$\{file\}` \}\)\n      \.then\(sqlEngine => \{\n        setEngine\(sqlEngine\);\n        setMessage\('SQLite готов\. Выполни запрос\.'\);\n      \}\)\n      \.catch\(\(\) => setMessage\('Не удалось загрузить SQLite WASM\. Проверь сеть\.'\)\);\n  \}, \[\]\);/,
    [
      "  useEffect(() => {",
      "    if (!workspaceActive || engine) return;",
      "    let cancelled = false;",
      "    setMessage('SQLite загружается…');",
      "    import('sql.js')",
      "      .then(module => module.default({ locateFile: file => `https://sql.js.org/dist/${file}` }))",
      "      .then(sqlEngine => {",
      "        if (cancelled) return;",
      "        setEngine(sqlEngine);",
      "        setMessage('SQLite готов. Выполни запрос.');",
      "      })",
      "      .catch(() => { if (!cancelled) setMessage('Не удалось загрузить SQLite WASM. Проверь сеть.'); });",
      "    return () => { cancelled = true; };",
      "  }, [engine, workspaceActive]);"
    ].join('\n'),
    'App deferred SQLite effect');
  source = replaceOnce(source,
    "  useEffect(() => saveProgress(progress), [progress]);",
    [
      "  useEffect(() => saveProgress(progress), [progress]);",
      "",
      "  useEffect(() => {",
      "    const notify = (dirty: boolean) => window.dispatchEvent(new CustomEvent('sql-academy-dirty-state', { detail: { dirty } }));",
      "    notify(workspaceActive && sql !== selected.starter);",
      "    return () => notify(false);",
      "  }, [selected.id, selected.starter, sql, workspaceActive]);"
    ].join('\n'),
    'App dirty state event');
  source = replaceOnce(source,
    "  const navigate = (next: View) => {\n    setView(next);\n    setMobileNav(false);\n    setMobileTaskOpen(false);\n    if (next !== 'catalog') setModuleFilter('all');\n  };",
    "  const navigate = (next: View) => {\n    setView(next);\n    setMobileNav(false);\n    setMobileTaskOpen(false);\n    if (next !== 'catalog') setModuleFilter('all');\n    window.requestAnimationFrame(() => document.getElementById('main-content')?.focus({ preventScroll: true }));\n  };",
    'App navigation focus');
  source = replaceOnce(source,
    "  return <div className=\"app\">",
    "  return <><a className=\"skip-link\" href=\"#main-content\">Перейти к содержимому</a><div className=\"app\">",
    'App skip link');
  source = replaceOnce(source,
    "    <aside className={`sidebar ${mobileNav ? 'open' : ''}`}>",
    "    <aside className={`sidebar ${mobileNav ? 'open' : ''}`} aria-label=\"Основная навигация\">",
    'App sidebar label');
  source = replaceOnce(source,
    "      <nav>\n        <Nav",
    "      <nav aria-label=\"Разделы академии\">\n        <Nav",
    'App nav label');
  source = replaceOnce(source,
    "    <main>\n      <header className=\"topbar\">",
    "    <main id=\"main-content\" tabIndex={-1}>\n      <header className=\"topbar\">",
    'App main landmark');
  source = replaceOnce(source,
    "          <input ref={searchRef} value={query} onChange={event => setQuery(event.target.value)} placeholder=\"Поиск по задачам и темам…\" />",
    "          <input ref={searchRef} value={query} onChange={event => setQuery(event.target.value)} placeholder=\"Поиск по задачам и темам…\" aria-label=\"Поиск по задачам и темам\" />",
    'App search accessible name');
  source = replaceRegexOnce(source,
    /<ResponsiveContainer width="100%" height=\{250\}>[\s\S]*?<\/ResponsiveContainer>/,
    "<Suspense fallback={<div className=\"loading\" role=\"status\">Загрузка графика активности…</div>}><ActivityChart data={progress.history} /></Suspense>",
    'App lazy activity chart');
  source = replaceOnce(source,
    "  return <button className={active ? 'active' : ''} onClick={onClick}>{icon}<span>{label}</span></button>;",
    "  return <button className={active ? 'active' : ''} onClick={onClick} aria-current={active ? 'page' : undefined}>{icon}<span>{label}</span></button>;",
    'App desktop aria-current');
  source = replaceOnce(source,
    "  return <button className={active ? 'active' : ''} onClick={onClick}><span className=\"mobile-nav-icon\">{icon}{badge ? <b>{badge > 9 ? '9+' : badge}</b> : null}</span><small>{label}</small></button>;",
    "  return <button className={active ? 'active' : ''} onClick={onClick} aria-current={active ? 'page' : undefined}><span className=\"mobile-nav-icon\">{icon}{badge ? <b>{badge > 9 ? '9+' : badge}</b> : null}</span><small>{label}</small></button>;",
    'App mobile aria-current');
  source = replaceOnce(source,
    "    <table><thead><tr>{table.columns.map(column => <th key={column}>{column}</th>)}</tr></thead>",
    "    <table><caption className=\"sr-only\">Результат SQL-запроса, таблица {index + 1}</caption><thead><tr>{table.columns.map(column => <th scope=\"col\" key={column}>{column}</th>)}</tr></thead>",
    'App result table semantics');
  source = replaceOnce(source,
    "    </nav>\n  </div>;\n}",
    "    </nav>\n  </div></>;\n}",
    'App fragment close');
  write(path, source);
}

{
  const path = 'src/components/AuthGate.tsx';
  let source = read(path);
  source = replaceOnce(source,
    "} from '../lib/auth';",
    "} from '../lib/auth';\nimport { useDialogFocus } from '../lib/dialog-focus';",
    'AuthGate focus import');
  source = replaceAll(source, 'className="auth-notice error"', 'className="auth-notice error" role="alert"', 1, 'AuthGate error live regions');
  source = replaceAll(source, 'className="auth-notice success"', 'className="auth-notice success" role="status"', 1, 'AuthGate success live regions');
  source = replaceOnce(source,
    "      <div className=\"auth-tabs\" role=\"tablist\">\n        <button type=\"button\" className={mode === 'login' ? 'active' : ''} onClick={() => switchMode('login')}>Вход</button>\n        <button type=\"button\" className={mode === 'register' ? 'active' : ''} onClick={() => switchMode('register')}>Регистрация</button>\n      </div>",
    "      <div className=\"auth-tabs\" role=\"tablist\" aria-label=\"Режим авторизации\">\n        <button type=\"button\" role=\"tab\" aria-selected={mode === 'login'} className={mode === 'login' ? 'active' : ''} onClick={() => switchMode('login')}>Вход</button>\n        <button type=\"button\" role=\"tab\" aria-selected={mode === 'register'} className={mode === 'register' ? 'active' : ''} onClick={() => switchMode('register')}>Регистрация</button>\n      </div>",
    'AuthGate auth tabs');
  source = replaceOnce(source,
    "  const [message, setMessage] = useState('');\n\n  useEffect(() => {\n    const mount = () => {",
    "  const [message, setMessage] = useState('');\n  const modalRef = useRef<HTMLElement>(null);\n\n  useEffect(() => {\n    const mount = () => {",
    'AuthGate profile modal ref');
  source = replaceOnce(source,
    "  useEffect(() => {\n    if (open) void refresh();\n  }, [open, refresh]);\n\n  useEffect(() => {",
    "  useEffect(() => {\n    if (open) void refresh();\n  }, [open, refresh]);\n\n  useDialogFocus(open, modalRef, () => setOpen(false));\n\n  useEffect(() => {",
    'AuthGate profile focus hook');
  source = replaceOnce(source,
    "    <section className=\"profile-modal\" role=\"dialog\" aria-modal=\"true\" aria-labelledby=\"profile-title\" data-testid=\"profile-modal\">",
    "    <section ref={modalRef} tabIndex={-1} className=\"profile-modal\" role=\"dialog\" aria-modal=\"true\" aria-labelledby=\"profile-title\" data-testid=\"profile-modal\">",
    'AuthGate profile dialog ref');
  source = replaceOnce(source,
    "        <button type=\"button\" className=\"icon\" onClick={() => setOpen(false)} aria-label=\"Закрыть профиль\"><X /></button>",
    "        <button type=\"button\" className=\"icon\" data-autofocus onClick={() => setOpen(false)} aria-label=\"Закрыть профиль\"><X /></button>",
    'AuthGate profile autofocus');
  source = replaceOnce(source,
    "      <nav className=\"profile-tabs\">\n        <button className={tab === 'profile' ? 'active' : ''} onClick={() => setTab('profile')}><User />Профиль</button>\n        <button className={tab === 'security' ? 'active' : ''} onClick={() => setTab('security')}><ShieldCheck />Безопасность</button>\n        <button className={tab === 'sessions' ? 'active' : ''} onClick={() => setTab('sessions')}><MonitorSmartphone />Сессии</button>\n      </nav>",
    "      <nav className=\"profile-tabs\" role=\"tablist\" aria-label=\"Разделы профиля\">\n        <button role=\"tab\" aria-selected={tab === 'profile'} className={tab === 'profile' ? 'active' : ''} onClick={() => setTab('profile')}><User />Профиль</button>\n        <button role=\"tab\" aria-selected={tab === 'security'} className={tab === 'security' ? 'active' : ''} onClick={() => setTab('security')}><ShieldCheck />Безопасность</button>\n        <button role=\"tab\" aria-selected={tab === 'sessions'} className={tab === 'sessions' ? 'active' : ''} onClick={() => setTab('sessions')}><MonitorSmartphone />Сессии</button>\n      </nav>",
    'AuthGate profile tabs');
  source = replaceOnce(source,
    "<button className=\"icon\" onClick={() => void refresh()}><RefreshCw /></button>",
    "<button className=\"icon\" onClick={() => void refresh()} aria-label=\"Обновить список сессий\"><RefreshCw /></button>",
    'AuthGate sessions refresh name');
  write(path, source);
}

{
  const path = 'src/components/LearningPathPortal.tsx';
  let source = read(path);
  source = replaceOnce(source,
    "import { loadProgress, Progress, PROGRESS_CHANGED_EVENT } from '../lib/progress';",
    "import { loadProgress, Progress, PROGRESS_CHANGED_EVENT } from '../lib/progress';\nimport { useDialogFocus } from '../lib/dialog-focus';",
    'LearningPath focus import');
  source = replaceOnce(source,
    "export default function LearningPathPortal() {",
    "export default function LearningPathPortal({ externalLauncher = false, openRequest = 0 }: { externalLauncher?: boolean; openRequest?: number }) {",
    'LearningPath props');
  source = replaceOnce(source,
    "  const [open, setOpen] = useState(false);",
    "  const [open, setOpen] = useState(Boolean(openRequest));",
    'LearningPath initial open');
  source = replaceOnce(source,
    "  const previousOverflow = useRef('');",
    "  const previousOverflow = useRef('');\n  const shellRef = useRef<HTMLDivElement>(null);",
    'LearningPath shell ref');
  source = replaceOnce(source,
    "  useEffect(() => {\n    const mount = () => {",
    "  useEffect(() => {\n    if (externalLauncher) return;\n    const mount = () => {",
    'LearningPath external launcher guard');
  source = replaceOnce(source,
    "    return () => observer.disconnect();\n  }, []);",
    "    return () => observer.disconnect();\n  }, [externalLauncher]);",
    'LearningPath launcher dependency');
  source = replaceOnce(source,
    "  useEffect(() => {\n    const update = () => setProgress(loadProgress());",
    "  useEffect(() => { if (openRequest > 0) setOpen(true); }, [openRequest]);\n\n  useEffect(() => {\n    const update = () => setProgress(loadProgress());",
    'LearningPath open request');
  source = replaceOnce(source,
    "  useEffect(() => {\n    if (!open) return;\n    setProgress(loadProgress());\n    previousOverflow.current = document.body.style.overflow;\n    document.body.style.overflow = 'hidden';\n    const close = (event: KeyboardEvent) => {\n      if (event.key === 'Escape') setOpen(false);\n    };\n    window.addEventListener('keydown', close);\n    return () => {\n      document.body.style.overflow = previousOverflow.current;\n      window.removeEventListener('keydown', close);\n    };\n  }, [open]);",
    "  useDialogFocus(open, shellRef, () => setOpen(false));\n\n  useEffect(() => {\n    if (!open) return;\n    setProgress(loadProgress());\n    previousOverflow.current = document.body.style.overflow;\n    document.body.style.overflow = 'hidden';\n    return () => { document.body.style.overflow = previousOverflow.current; };\n  }, [open]);",
    'LearningPath focus and overflow');
  source = replaceOnce(source,
    "  const panel = open ? <div className=\"learning-path-shell\" data-testid=\"learning-path\">",
    "  const panel = open ? <div ref={shellRef} tabIndex={-1} className=\"learning-path-shell\" role=\"dialog\" aria-modal=\"true\" aria-labelledby=\"learning-path-title\" data-testid=\"learning-path\">",
    'LearningPath dialog semantics');
  source = replaceOnce(source,
    "<h1>Не просто список задач.<br />Понятный путь к рабочему SQL.</h1>",
    "<h1 id=\"learning-path-title\">Не просто список задач.<br />Понятный путь к рабочему SQL.</h1>",
    'LearningPath title id');
  source = replaceOnce(source,
    "<pre className={mentorLoading ? 'path-ai-answer loading' : 'path-ai-answer'}>",
    "<pre className={mentorLoading ? 'path-ai-answer loading' : 'path-ai-answer'} aria-live=\"polite\">",
    'LearningPath AI live region');
  source = replaceOnce(source,
    "    {desktopSlot && createPortal(desktopTrigger, desktopSlot)}\n    {mobileSlot && createPortal(mobileTrigger, mobileSlot)}",
    "    {!externalLauncher && desktopSlot && createPortal(desktopTrigger, desktopSlot)}\n    {!externalLauncher && mobileSlot && createPortal(mobileTrigger, mobileSlot)}",
    'LearningPath conditional triggers');
  write(path, source);
}

{
  const path = 'src/components/AssessmentCenterPortal.tsx';
  let source = read(path);
  source = replaceOnce(source,
    "import { loadProgress } from '../lib/progress';",
    "import { loadProgress } from '../lib/progress';\nimport { useDialogFocus } from '../lib/dialog-focus';",
    'Assessment focus import');
  source = replaceOnce(source,
    "export default function AssessmentCenterPortal() {",
    "export default function AssessmentCenterPortal({ externalLauncher = false, openRequest = 0 }: { externalLauncher?: boolean; openRequest?: number }) {",
    'Assessment props');
  source = replaceOnce(source,
    "  const [open, setOpen] = useState(false);",
    "  const [open, setOpen] = useState(Boolean(openRequest));",
    'Assessment initial open');
  source = replaceOnce(source,
    "  const previousOverflow = useRef('');",
    "  const previousOverflow = useRef('');\n  const shellRef = useRef<HTMLDivElement>(null);",
    'Assessment shell ref');
  source = replaceOnce(source,
    "  useEffect(() => {\n    const mount = () => {",
    "  useEffect(() => {\n    if (externalLauncher) return;\n    const mount = () => {",
    'Assessment external launcher guard');
  source = replaceOnce(source,
    "    return () => observer.disconnect();\n  }, []);",
    "    return () => observer.disconnect();\n  }, [externalLauncher]);",
    'Assessment launcher dependency');
  source = replaceOnce(source,
    "  useEffect(() => {\n    if (!open) return;\n    previousOverflow.current = document.body.style.overflow;\n    document.body.style.overflow = 'hidden';\n    const onKeyDown = (event: KeyboardEvent) => {\n      if (event.key === 'Escape' && !session) setOpen(false);\n    };\n    window.addEventListener('keydown', onKeyDown);\n    return () => {\n      document.body.style.overflow = previousOverflow.current;\n      window.removeEventListener('keydown', onKeyDown);\n    };\n  }, [open, session]);",
    "  useEffect(() => { if (openRequest > 0) setOpen(true); }, [openRequest]);\n\n  useDialogFocus(open, shellRef, () => { if (!session) setOpen(false); }, !session);\n\n  useEffect(() => {\n    if (!open) return;\n    previousOverflow.current = document.body.style.overflow;\n    document.body.style.overflow = 'hidden';\n    return () => { document.body.style.overflow = previousOverflow.current; };\n  }, [open]);",
    'Assessment focus and overflow');
  source = replaceOnce(source,
    "<button onClick={() => void refreshHistory()} disabled={historyLoading}><RefreshCw className={historyLoading ? 'spin' : ''} /></button>",
    "<button onClick={() => void refreshHistory()} disabled={historyLoading} aria-label=\"Обновить историю assessment\"><RefreshCw className={historyLoading ? 'spin' : ''} /></button>",
    'Assessment history refresh name');
  source = replaceAll(source, 'className="assessment-notice"', 'className="assessment-notice" role="status" aria-live="polite"', 1, 'Assessment live notices');
  source = replaceOnce(source,
    "<div className={`assessment-timer ${secondsLeft <= 300 ? 'urgent' : ''}`} data-testid=\"assessment-timer\"><Clock3 />{formatTimer(secondsLeft)}</div>",
    "<div className={`assessment-timer ${secondsLeft <= 300 ? 'urgent' : ''}`} role=\"timer\" aria-label={`Осталось ${formatTimer(secondsLeft)}`} data-testid=\"assessment-timer\"><Clock3 />{formatTimer(secondsLeft)}</div>",
    'Assessment timer semantics');
  source = replaceOnce(source,
    "<textarea value={interviewerQuestion} onChange={event => setInterviewerQuestion(event.target.value)} placeholder=\"Задай уточняющий вопрос о требованиях…\" maxLength={600} />",
    "<textarea aria-label=\"Уточняющий вопрос AI Interviewer\" value={interviewerQuestion} onChange={event => setInterviewerQuestion(event.target.value)} placeholder=\"Задай уточняющий вопрос о требованиях…\" maxLength={600} />",
    'Assessment interviewer textarea name');
  source = replaceOnce(source,
    "<div className={`assessment-feedback ${runState}`}>",
    "<div className={`assessment-feedback ${runState}`} role=\"status\" aria-live=\"polite\">",
    'Assessment feedback live region');
  source = replaceOnce(source,
    "{engineError ? <div className=\"assessment-error\"><AlertTriangle />{engineError}</div>",
    "{engineError ? <div className=\"assessment-error\" role=\"alert\"><AlertTriangle />{engineError}</div>",
    'Assessment engine alert');
  source = replaceOnce(source,
    "  const shell = open ? <div className=\"assessment-shell\" data-testid=\"assessment-center\">",
    "  const shell = open ? <div ref={shellRef} tabIndex={-1} className=\"assessment-shell\" role=\"dialog\" aria-modal=\"true\" aria-labelledby=\"assessment-dialog-title\" data-testid=\"assessment-center\">",
    'Assessment dialog semantics');
  source = replaceOnce(source,
    "<div className=\"assessment-brand\"><div><ClipboardCheck /></div><span><strong>SQL Academy</strong><small>Assessment Center</small></span></div>",
    "<div className=\"assessment-brand\"><div><ClipboardCheck /></div><span><strong>SQL Academy</strong><small id=\"assessment-dialog-title\">Assessment Center</small></span></div>",
    'Assessment dialog title');
  source = replaceOnce(source,
    "    {desktopSlot && createPortal(desktopTrigger, desktopSlot)}\n    {mobileSlot && createPortal(mobileTrigger, mobileSlot)}",
    "    {!externalLauncher && desktopSlot && createPortal(desktopTrigger, desktopSlot)}\n    {!externalLauncher && mobileSlot && createPortal(mobileTrigger, mobileSlot)}",
    'Assessment conditional triggers');
  write(path, source);
}

console.log('Applied accessibility, deferred runtime and focus-management patches.');
