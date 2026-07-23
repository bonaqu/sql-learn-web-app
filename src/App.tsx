import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import initSqlJs, { Database } from 'sql.js';
import {
  Award, BookOpen, BrainCircuit, BriefcaseBusiness, ChevronRight, Cloud,
  Code2, Download, Flame, Github, Home, Moon, Puzzle, Search, Sparkles,
  Sun, Trophy, Upload, Wifi, WifiOff
} from 'lucide-react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { achievements, modules, SqlTask, tasks, TaskMode } from './data/course';

const Editor = lazy(() => import('@monaco-editor/react'));
type View = 'home' | 'catalog' | 'practice' | 'interview' | 'puzzle' | 'achievements' | 'mentor';
type Progress = { completed: string[]; attempts: Record<string, number>; xp: number; streak: number; history: { day: string; solved: number }[] };
const STORAGE_KEY = 'sql-academy-progress-v2';
const defaultProgress: Progress = { completed: [], attempts: {}, xp: 0, streak: 1, history: [{ day: 'Пн', solved: 1 }, { day: 'Вт', solved: 2 }, { day: 'Ср', solved: 0 }, { day: 'Чт', solved: 3 }, { day: 'Пт', solved: 2 }, { day: 'Сб', solved: 4 }, { day: 'Вс', solved: 1 }] };

const seedSql = `
CREATE TABLE engineers(engineer_id INTEGER PRIMARY KEY, name TEXT, level TEXT);
CREATE TABLE tickets(ticket_id INTEGER PRIMARY KEY, service TEXT, status TEXT, priority TEXT, engineer_id INTEGER, resolution_minutes INTEGER, sla_minutes INTEGER, created_at TEXT);
INSERT INTO engineers VALUES (1,'Артём','L2'),(2,'Марина','L2'),(3,'Илья','L1'),(4,'София','L3'),(5,'Олег','L2');
INSERT INTO tickets VALUES
(1001,'VPN','Closed','High',1,85,120,'2026-07-01'),(1002,'LMS','Open','Medium',2,NULL,240,'2026-07-01'),
(1003,'VPN','Closed','Low',1,40,240,'2026-07-02'),(1004,'VDI','Closed','Critical',4,510,60,'2026-07-02'),
(1005,'Email','Closed','High',3,190,120,'2026-07-03'),(1006,'VPN','Closed','Critical',2,330,60,'2026-07-03'),
(1007,'LMS','Open','High',3,NULL,120,'2026-07-04'),(1008,'Access','Closed','Low',4,25,240,'2026-07-04'),
(1009,'VPN','Closed','Medium',1,120,240,'2026-07-05'),(1010,'Email','Open','Critical',2,NULL,60,'2026-07-05'),
(1011,'Access','Closed','High',4,95,120,'2026-07-06'),(1012,'LMS','Open','Medium',3,NULL,240,'2026-07-06');
CREATE INDEX idx_tickets_service ON tickets(service);`;

function loadProgress(): Progress {
  try { return { ...defaultProgress, ...JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') }; }
  catch { return defaultProgress; }
}

function App() {
  const [view, setView] = useState<View>('home');
  const [theme, setTheme] = useState<'dark' | 'light'>(() => (localStorage.getItem('sql-theme') as 'dark' | 'light') || 'dark');
  const [progress, setProgress] = useState<Progress>(loadProgress);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<SqlTask>(tasks[0]);
  const [sql, setSql] = useState(tasks[0].starter);
  const [result, setResult] = useState<string>('SQLite загружается…');
  const [db, setDb] = useState<Database | null>(null);
  const [syncState, setSyncState] = useState<'local' | 'syncing' | 'synced'>('local');
  const [mentorInput, setMentorInput] = useState('Объясни, как улучшить мой SQL-запрос.');
  const [mentorAnswer, setMentorAnswer] = useState('AI Mentor использует Cloudflare Workers AI, а при недоступности даёт локальные инженерные подсказки.');

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('sql-theme', theme);
  }, [theme]);
  useEffect(() => { localStorage.setItem(STORAGE_KEY, JSON.stringify(progress)); }, [progress]);
  useEffect(() => {
    initSqlJs({ locateFile: file => `https://sql.js.org/dist/${file}` }).then(SQL => {
      const database = new SQL.Database(); database.run(seedSql); setDb(database); setResult('SQLite готов. Запусти запрос.');
    }).catch(() => setResult('Не удалось загрузить SQLite WASM. Проверь сеть.'));
  }, []);

  const filteredTasks = useMemo(() => tasks.filter(task => {
    const text = `${task.title} ${task.description} ${task.topic}`.toLowerCase();
    const modeOk = view === 'practice' ? task.mode === 'practice' : view === 'interview' ? task.mode === 'interview' : view === 'puzzle' ? task.mode === 'puzzle' : true;
    return modeOk && text.includes(query.toLowerCase());
  }), [query, view]);
  const completion = Math.round(progress.completed.length / tasks.length * 100);

  const selectTask = (task: SqlTask) => { setSelected(task); setSql(task.starter); setView(task.mode === 'interview' ? 'interview' : task.mode === 'puzzle' ? 'puzzle' : 'practice'); setResult('Задача открыта. Выполни запрос.'); };
  const runSql = () => {
    if (!db) return;
    try {
      const output = db.exec(sql);
      const printable = output.length ? output.map(block => `${block.columns.join(' | ')}\n${block.values.map(row => row.join(' | ')).join('\n')}`).join('\n\n') : 'Запрос выполнен. Строк результата нет.';
      setResult(printable);
      const already = progress.completed.includes(selected.id);
      setProgress(current => ({
        ...current,
        completed: already ? current.completed : [...current.completed, selected.id],
        attempts: { ...current.attempts, [selected.id]: (current.attempts[selected.id] || 0) + 1 },
        xp: already ? current.xp : current.xp + selected.xp
      }));
    } catch (error) { setResult(`Ошибка SQLite: ${error instanceof Error ? error.message : String(error)}\n\nПодсказка: проверь порядок SELECT → FROM → WHERE → GROUP BY → HAVING → ORDER BY.`); }
  };
  const exportProgress = () => {
    const blob = new Blob([JSON.stringify(progress, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'sql-academy-progress.json'; anchor.click(); URL.revokeObjectURL(url);
  };
  const importProgress = (file?: File) => {
    if (!file) return; const reader = new FileReader(); reader.onload = () => { try { setProgress(JSON.parse(String(reader.result))); } catch { alert('Некорректный файл прогресса'); } }; reader.readAsText(file);
  };
  const syncProgress = async () => {
    setSyncState('syncing');
    try {
      const response = await fetch('/api/progress', { method: 'PUT', headers: { 'content-type': 'application/json', 'x-profile-id': 'private-local-profile' }, body: JSON.stringify(progress) });
      if (!response.ok) throw new Error('sync'); setSyncState('synced');
    } catch { setSyncState('local'); }
  };
  const askMentor = async () => {
    setMentorAnswer('Анализирую запрос…');
    try {
      const response = await fetch('/api/mentor', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ question: mentorInput, sql }) });
      if (!response.ok) throw new Error('mentor'); const data = await response.json() as { answer: string }; setMentorAnswer(data.answer);
    } catch {
      const local = sql.toLowerCase().includes('select *') ? 'Замени SELECT * явным списком полей. Это улучшит читаемость и устойчивость запроса.' : 'Проверь фильтрацию NULL, детерминированную сортировку и план выполнения через EXPLAIN QUERY PLAN.';
      setMentorAnswer(`Локальный Mentor: ${local}`);
    }
  };

  return <div className="app">
    <aside className="sidebar">
      <button className="logo" onClick={() => setView('home')}><span>SQL</span><strong>Academy</strong></button>
      <nav>
        <Nav icon={<Home />} label="Главная" active={view === 'home'} onClick={() => setView('home')} />
        <Nav icon={<BookOpen />} label="Каталог" active={view === 'catalog'} onClick={() => setView('catalog')} />
        <Nav icon={<BrainCircuit />} label="Practice" active={view === 'practice'} onClick={() => setView('practice')} />
        <Nav icon={<BriefcaseBusiness />} label="Interview" active={view === 'interview'} onClick={() => setView('interview')} />
        <Nav icon={<Puzzle />} label="SQL Puzzle" active={view === 'puzzle'} onClick={() => setView('puzzle')} />
        <Nav icon={<Trophy />} label="Достижения" active={view === 'achievements'} onClick={() => setView('achievements')} />
        <Nav icon={<Sparkles />} label="AI Mentor" active={view === 'mentor'} onClick={() => setView('mentor')} />
      </nav>
      <div className="sidebar-bottom"><a href="https://github.com/bonaqu/sql-learn-web-app" target="_blank" rel="noreferrer"><Github size={17}/> GitHub</a><span className="privacy">Без персональных данных</span></div>
    </aside>

    <main>
      <header className="topbar">
        <div className="search"><Search size={18}/><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Поиск по 120 задачам и темам…" /></div>
        <div className="header-actions"><span className="xp"><Flame size={17}/>{progress.xp} XP</span><button className="icon" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? <Sun/> : <Moon/>}</button><button className="icon" onClick={syncProgress}>{syncState === 'synced' ? <Wifi/> : syncState === 'syncing' ? <Cloud className="spin"/> : <WifiOff/>}</button></div>
      </header>

      {view === 'home' && <HomeView progress={progress} completion={completion} onStart={() => setView('practice')} />}
      {(view === 'catalog' || view === 'practice' || view === 'interview' || view === 'puzzle') && <section className="workspace">
        <div className="catalog-panel"><div className="section-heading"><div><h1>{view === 'catalog' ? 'Каталог академии' : view === 'practice' ? 'Practice Mode' : view === 'interview' ? 'Interview Mode' : 'SQL Puzzle'}</h1><p>{filteredTasks.length} задач · реальные кейсы IT-поддержки</p></div></div>
          <div className="task-list">{filteredTasks.map(task => <button className={`task-row ${selected.id === task.id ? 'active' : ''}`} onClick={() => selectTask(task)} key={task.id}><span className="task-number">{task.id.replace('task-', '')}</span><span><strong>{task.title}</strong><small>{task.difficulty} · {task.xp} XP</small></span><ChevronRight/></button>)}</div>
        </div>
        <div className="editor-panel"><div className="task-copy"><span className="eyebrow">{selected.topic}</span><h2>{selected.title}</h2><p>{selected.description}</p><details><summary>Подсказки</summary><ol>{selected.hints.map(hint => <li key={hint}>{hint}</li>)}</ol></details></div>
          <div className="editor-wrap"><Suspense fallback={<div className="loading">Загрузка Monaco Editor…</div>}><Editor height="310px" language="sql" theme={theme === 'dark' ? 'vs-dark' : 'light'} value={sql} onChange={value => setSql(value || '')} options={{ minimap: { enabled: false }, fontSize: 15, padding: { top: 18 }, automaticLayout: true }} /></Suspense></div>
          <div className="runner-actions"><button className="primary" onClick={runSql}><Code2/> Выполнить SQL</button><button onClick={() => setSql(selected.starter)}>Сбросить</button></div><pre className="result">{result}</pre>
        </div>
      </section>}
      {view === 'achievements' && <section className="page"><h1>Достижения</h1><p className="lead">Вехи обучения и инженерная готовность.</p><div className="achievement-grid">{achievements.map((item, index) => { const unlocked = progress.completed.length >= item.threshold; return <article className={unlocked ? 'achievement unlocked' : 'achievement'} key={item.id}><Award/><span>0{index + 1}</span><h3>{item.title}</h3><p>{item.description}</p><strong>{unlocked ? 'Получено' : `${Math.min(progress.completed.length, item.threshold)} / ${item.threshold}`}</strong></article>; })}</div></section>}
      {view === 'mentor' && <section className="page mentor"><h1>AI SQL Mentor</h1><p className="lead">Cloudflare Workers AI с локальным fallback и без отправки персональных данных.</p><textarea value={mentorInput} onChange={e => setMentorInput(e.target.value)} /><div className="mentor-sql"><code>{sql}</code></div><button className="primary" onClick={askMentor}><Sparkles/> Разобрать запрос</button><article className="mentor-answer">{mentorAnswer}</article></section>}

      <footer><div><button onClick={exportProgress}><Download/> Экспорт прогресса</button><label className="button"><Upload/> Импорт<input hidden type="file" accept="application/json" onChange={e => importProgress(e.target.files?.[0])}/></label></div><span>SQL Academy · Open-source · T-Bonk training dataset</span></footer>
    </main>
  </div>;
}

function Nav({ icon, label, active, onClick }: { icon: React.ReactNode; label: string; active: boolean; onClick: () => void }) { return <button className={active ? 'active' : ''} onClick={onClick}>{icon}<span>{label}</span></button>; }
function HomeView({ progress, completion, onStart }: { progress: Progress; completion: number; onStart: () => void }) { return <>
  <section className="hero"><div><h1>SQL, который нужен<br/>в реальной поддержке.</h1><p>Полноценная академия для 2nd Support Engineer: от первого SELECT до оконных функций, EXPLAIN и аналитики SLA.</p><div className="hero-actions"><button className="primary" onClick={onStart}>Продолжить обучение <ChevronRight/></button><span>120 задач · 20 модулей · 4 режима</span></div></div><div className="terminal"><div className="terminal-bar"><i/><i/><i/><span>support_analytics.sql</span></div><pre><b>WITH</b> service_stats <b>AS</b> ({'\n'}  <b>SELECT</b> service, COUNT(*) tickets,{'\n'}         AVG(resolution_minutes) avg_time{'\n'}  <b>FROM</b> tickets <b>GROUP BY</b> service{'\n'}){'\n'}<b>SELECT</b> *, RANK() <b>OVER</b> ({'\n'}  <b>ORDER BY</b> tickets <b>DESC</b>{'\n'}) load_rank <b>FROM</b> service_stats;</pre><div className="terminal-success">✓ Query completed · 5 rows</div></div></section>
  <section className="stats"><article><small>Общий прогресс</small><strong>{completion}%</strong><div className="progress"><i style={{ width: `${completion}%` }}/></div></article><article><small>Решено задач</small><strong>{progress.completed.length}<span>/120</span></strong></article><article><small>Текущий streak</small><strong>{progress.streak}<span> дней</span></strong></article><article><small>Накоплено XP</small><strong>{progress.xp}</strong></article></section>
  <section className="dashboard-grid"><article className="chart-card"><div><h2>Активность</h2><p>Решённые задачи за неделю</p></div><ResponsiveContainer width="100%" height={250}><AreaChart data={progress.history}><defs><linearGradient id="fill" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#8b5cf6" stopOpacity={.35}/><stop offset="95%" stopColor="#8b5cf6" stopOpacity={0}/></linearGradient></defs><CartesianGrid strokeDasharray="3 3" vertical={false}/><XAxis dataKey="day"/><YAxis allowDecimals={false}/><Tooltip/><Area type="monotone" dataKey="solved" stroke="#8b5cf6" fill="url(#fill)" strokeWidth={3}/></AreaChart></ResponsiveContainer></article><article className="modules-card"><h2>Траектория</h2><div>{modules.slice(0, 7).map(([id, title], index) => <div key={id}><span>{String(index + 1).padStart(2, '0')}</span><p><strong>{title}</strong><small>{tasks.filter(task => task.module === id).length} задач</small></p><ChevronRight/></div>)}</div></article></section>
</>; }
export default App;
