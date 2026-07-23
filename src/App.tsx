import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import initSqlJs, { Database, QueryExecResult } from 'sql.js';
import {
  Award, BookOpen, BrainCircuit, BriefcaseBusiness, CheckCircle2, ChevronRight, Cloud,
  Code2, Download, Flame, Github, Home, Lightbulb, Menu, Moon, Puzzle, RotateCcw,
  Search, Sparkles, Sun, Target, Trophy, Upload, Wifi, WifiOff, X
} from 'lucide-react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { achievements, modules, SqlTask, tasks } from './data/course';

const Editor = lazy(() => import('@monaco-editor/react'));
type View = 'home' | 'catalog' | 'practice' | 'interview' | 'puzzle' | 'achievements' | 'mentor';
type Progress = { completed: string[]; attempts: Record<string, number>; xp: number; streak: number; history: { day: string; solved: number }[]; lastTask?: string };
type SqlTable = { columns: string[]; values: unknown[][] };
const STORAGE_KEY = 'sql-academy-progress-v3';
const PROFILE_KEY = 'sql-academy-profile-id';
const history = ['Пн','Вт','Ср','Чт','Пт','Сб','Вс'].map(day=>({day,solved:0}));
const defaultProgress: Progress = { completed: [], attempts: {}, xp: 0, streak: 1, history };

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
  try { const parsed=JSON.parse(localStorage.getItem(STORAGE_KEY)||'{}') as Partial<Progress>; return {...defaultProgress,...parsed,history:parsed.history?.length?parsed.history:history}; }
  catch { return defaultProgress; }
}
function profileId(){ const saved=localStorage.getItem(PROFILE_KEY); if(saved)return saved; const id=crypto.randomUUID(); localStorage.setItem(PROFILE_KEY,id); return id; }
function normalize(value:unknown){ if(value===null)return 'NULL'; if(typeof value==='number')return Number.isInteger(value)?String(value):value.toFixed(4).replace(/0+$/,'').replace(/\.$/,''); return String(value); }
function comparable(results:QueryExecResult[]){ return JSON.stringify(results.map(block=>({columns:block.columns.map(column=>column.toLowerCase()),values:block.values.map(row=>row.map(normalize))}))); }

function App(){
  const initial=loadProgress();
  const [view,setView]=useState<View>('home');
  const [theme,setTheme]=useState<'dark'|'light'>(()=>(localStorage.getItem('sql-theme') as 'dark'|'light')||'dark');
  const [progress,setProgress]=useState<Progress>(initial);
  const [query,setQuery]=useState('');
  const [moduleFilter,setModuleFilter]=useState('all');
  const [selected,setSelected]=useState<SqlTask>(()=>tasks.find(task=>task.id===initial.lastTask)||tasks[0]);
  const [sql,setSql]=useState(selected.starter);
  const [result,setResult]=useState<SqlTable[]>([]);
  const [message,setMessage]=useState('SQLite загружается…');
  const [status,setStatus]=useState<'idle'|'success'|'error'>('idle');
  const [db,setDb]=useState<Database|null>(null);
  const [syncState,setSyncState]=useState<'local'|'syncing'|'synced'>('local');
  const [mentorInput,setMentorInput]=useState('Объясни ошибку и подскажи следующий шаг, не раскрывая готовое решение.');
  const [mentorAnswer,setMentorAnswer]=useState('AI Mentor анализирует текущую задачу и SQL. При недоступности Workers AI работает локальная проверка.');
  const [mobileNav,setMobileNav]=useState(false);
  const [showSolution,setShowSolution]=useState(false);

  useEffect(()=>{document.documentElement.dataset.theme=theme;localStorage.setItem('sql-theme',theme)},[theme]);
  useEffect(()=>{localStorage.setItem(STORAGE_KEY,JSON.stringify(progress))},[progress]);
  useEffect(()=>{initSqlJs({locateFile:file=>`https://sql.js.org/dist/${file}`}).then(SQL=>{const database=new SQL.Database();database.run(seedSql);setDb(database);setMessage('SQLite готов. Выполни запрос.')}).catch(()=>setMessage('Не удалось загрузить SQLite WASM. Проверь сеть.'))},[]);

  const filteredTasks=useMemo(()=>tasks.filter(task=>{
    const text=`${task.title} ${task.description} ${task.topic} ${task.difficulty}`.toLowerCase();
    const modeOk=view==='practice'?task.mode==='practice':view==='interview'?task.mode==='interview':view==='puzzle'?task.mode==='puzzle':true;
    return modeOk&&(moduleFilter==='all'||task.module===moduleFilter)&&text.includes(query.trim().toLowerCase());
  }),[query,view,moduleFilter]);
  const completion=Math.round(progress.completed.length/tasks.length*100);
  const weakTopics=useMemo(()=>modules.map(([id,title])=>{const list=tasks.filter(task=>task.module===id);const attempts=list.reduce((sum,task)=>sum+(progress.attempts[task.id]||0),0);const solved=list.filter(task=>progress.completed.includes(task.id)).length;return{id,title,score:attempts-solved,solved}}).sort((a,b)=>b.score-a.score||a.solved-b.solved).slice(0,3),[progress]);

  const selectTask=(task:SqlTask)=>{setSelected(task);setSql(task.starter);setResult([]);setStatus('idle');setMessage('Задача открыта. Выполни запрос.');setShowSolution(false);setProgress(current=>({...current,lastTask:task.id}));if(view==='catalog')setView(task.mode==='interview'?'interview':task.mode==='puzzle'?'puzzle':'practice')};
  const runSql=()=>{if(!db)return;try{const output=db.exec(sql);const expected=db.exec(selected.solution);const correct=comparable(output)===comparable(expected);setResult(output as SqlTable[]);setStatus(correct?'success':'error');setMessage(correct?'Верно. Результат совпадает с контрольным набором.':'Запрос выполнился, но результат отличается. Проверь столбцы, фильтр, группировку и сортировку.');setProgress(current=>{const attempts={...current.attempts,[selected.id]:(current.attempts[selected.id]||0)+1};if(!correct||current.completed.includes(selected.id))return{...current,attempts};const index=new Date().getDay()===0?6:new Date().getDay()-1;return{...current,completed:[...current.completed,selected.id],attempts,xp:current.xp+selected.xp,history:current.history.map((item,i)=>i===index?{...item,solved:item.solved+1}:item),lastTask:selected.id}})}catch(error){setResult([]);setStatus('error');setMessage(`Ошибка SQLite: ${error instanceof Error?error.message:String(error)}`);setProgress(current=>({...current,attempts:{...current.attempts,[selected.id]:(current.attempts[selected.id]||0)+1}}))}};
  const exportProgress=()=>{const blob=new Blob([JSON.stringify({version:3,exportedAt:new Date().toISOString(),progress},null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const anchor=document.createElement('a');anchor.href=url;anchor.download='sql-academy-progress.json';anchor.click();URL.revokeObjectURL(url)};
  const importProgress=(file?:File)=>{if(!file)return;const reader=new FileReader();reader.onload=()=>{try{const parsed=JSON.parse(String(reader.result));setProgress(parsed.progress||parsed)}catch{setMessage('Файл прогресса повреждён или имеет неподдерживаемый формат.')}};reader.readAsText(file)};
  const syncProgress=async()=>{setSyncState('syncing');try{const response=await fetch('/api/progress',{method:'PUT',headers:{'content-type':'application/json','x-profile-id':profileId()},body:JSON.stringify(progress)});if(!response.ok)throw new Error('sync');setSyncState('synced')}catch{setSyncState('local')}};
  const askMentor=async()=>{setMentorAnswer('Анализирую запрос…');try{const response=await fetch('/api/mentor',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({question:mentorInput,sql,task:selected.description})});if(!response.ok)throw new Error('mentor');const data=await response.json() as {answer:string};setMentorAnswer(data.answer)}catch{const local=sql.toLowerCase().includes('select *')?'Замени SELECT * явным списком полей.':sql.toLowerCase().includes('= null')?'Для NULL используй IS NULL или IS NOT NULL.':'Проверь состав столбцов, фильтр, агрегирование и детерминированную сортировку.';setMentorAnswer(`Локальный Mentor: ${local}`)}};
  const navigate=(next:View)=>{setView(next);setMobileNav(false)};

  return <div className="app">
    <aside className={`sidebar ${mobileNav?'open':''}`}>
      <button className="logo" onClick={()=>navigate('home')} aria-label="SQL Academy — главная"><img src={`${import.meta.env.BASE_URL}logo.svg`} alt="" style={{width:38,height:38}}/><strong>SQL Academy</strong></button>
      <button className="close-mobile" onClick={()=>setMobileNav(false)} aria-label="Закрыть меню"><X/></button>
      <nav>
        <Nav icon={<Home/>} label="Главная" active={view==='home'} onClick={()=>navigate('home')}/><Nav icon={<BookOpen/>} label="Каталог" active={view==='catalog'} onClick={()=>navigate('catalog')}/><Nav icon={<BrainCircuit/>} label="Practice" active={view==='practice'} onClick={()=>navigate('practice')}/><Nav icon={<BriefcaseBusiness/>} label="Interview" active={view==='interview'} onClick={()=>navigate('interview')}/><Nav icon={<Puzzle/>} label="SQL Puzzle" active={view==='puzzle'} onClick={()=>navigate('puzzle')}/><Nav icon={<Trophy/>} label="Достижения" active={view==='achievements'} onClick={()=>navigate('achievements')}/><Nav icon={<Sparkles/>} label="AI Mentor" active={view==='mentor'} onClick={()=>navigate('mentor')}/>
      </nav>
      <div className="sidebar-bottom"><a href="https://github.com/bonaqu/sql-learn-web-app" target="_blank" rel="noreferrer"><Github size={17}/> GitHub</a><span className="privacy">Open-source · без персональных данных</span></div>
    </aside>
    <main>
      <header className="topbar"><button className="mobile-menu" onClick={()=>setMobileNav(true)} aria-label="Открыть меню"><Menu/></button><div className="search"><Search size={18}/><input value={query} onChange={event=>setQuery(event.target.value)} placeholder="Поиск по задачам и темам…"/></div><div className="header-actions"><span className="xp"><Flame size={17}/>{progress.xp} XP</span><button className="icon" onClick={()=>setTheme(theme==='dark'?'light':'dark')} aria-label="Переключить тему">{theme==='dark'?<Sun/>:<Moon/>}</button><button className="icon" onClick={syncProgress} aria-label="Синхронизировать прогресс">{syncState==='synced'?<Wifi/>:syncState==='syncing'?<Cloud className="spin"/>:<WifiOff/>}</button></div></header>
      {view==='home'&&<HomeView progress={progress} completion={completion} weakTopics={weakTopics} onStart={()=>navigate('practice')} onOpenTopic={id=>{setModuleFilter(id);navigate('catalog')}}/>}
      {(view==='catalog'||view==='practice'||view==='interview'||view==='puzzle')&&<section className="workspace"><div className="catalog-panel"><div className="section-heading"><div><h1>{view==='catalog'?'Каталог академии':view==='practice'?'Practice Mode':view==='interview'?'Interview Mode':'SQL Puzzle'}</h1><p>{filteredTasks.length} задач · проверка по реальному результату</p></div><select value={moduleFilter} onChange={event=>setModuleFilter(event.target.value)}><option value="all">Все модули</option>{modules.map(([id,title])=><option key={id} value={id}>{title}</option>)}</select></div><div className="task-list">{filteredTasks.map(task=><button className={`task-row ${selected.id===task.id?'active':''}`} onClick={()=>selectTask(task)} key={task.id}><span className="task-number">{task.id.replace('task-','')}</span><span><strong>{task.title}</strong><small>{task.difficulty} · {task.xp} XP</small></span>{progress.completed.includes(task.id)?<CheckCircle2 className="done"/>:<ChevronRight/>}</button>)}</div></div><div className="editor-panel"><div className="task-copy"><span className="eyebrow">{selected.topic} · {selected.difficulty} · {selected.xp} XP</span><h2>{selected.title}</h2><p>{selected.description}</p><details><summary><Lightbulb/> Подсказки</summary><ol>{selected.hints.map(hint=><li key={hint}>{hint}</li>)}</ol></details></div><div className="editor-wrap"><Suspense fallback={<div className="loading">Загрузка Monaco Editor…</div>}><Editor height="330px" language="sql" theme={theme==='dark'?'vs-dark':'light'} value={sql} onChange={value=>setSql(value||'')} options={{minimap:{enabled:false},fontSize:15,padding:{top:18},automaticLayout:true,wordWrap:'on',scrollBeyondLastLine:false}}/></Suspense></div><div className="runner-actions"><button className="primary" onClick={runSql}><Code2/> Проверить SQL</button><button onClick={()=>{setSql(selected.starter);setResult([]);setStatus('idle');setMessage('Редактор сброшен.')}}><RotateCcw/> Сбросить</button><button onClick={()=>setShowSolution(value=>!value)}><Target/> {showSolution?'Скрыть решение':'Показать решение'}</button></div>{showSolution&&<pre className="result">{selected.solution}</pre>}<div className={`feedback ${status}`}><p>{message}</p></div><ResultTables tables={result}/></div></section>}
      {view==='achievements'&&<section className="page"><h1>Достижения</h1><p className="lead">Вехи обучения и инженерная готовность.</p><div className="achievement-grid">{achievements.map((item,index)=>{const unlocked=progress.completed.length>=item.threshold;return <article className={unlocked?'achievement unlocked':'achievement'} key={item.id}><Award/><span>0{index+1}</span><h3>{item.title}</h3><p>{item.description}</p><strong>{unlocked?'Получено':`${Math.min(progress.completed.length,item.threshold)} / ${item.threshold}`}</strong></article>})}</div></section>}
      {view==='mentor'&&<section className="page mentor"><h1>AI SQL Mentor</h1><p className="lead">Разбор текущего запроса без передачи персональных данных.</p><textarea value={mentorInput} onChange={event=>setMentorInput(event.target.value)}/><div className="mentor-sql"><strong>{selected.title}</strong><br/><code>{sql}</code></div><button className="primary" onClick={askMentor}><Sparkles/> Разобрать запрос</button><article className="mentor-answer">{mentorAnswer}</article></section>}
      <footer><div><button onClick={exportProgress}><Download/> Экспорт</button><label className="button"><Upload/> Импорт<input hidden type="file" accept="application/json" onChange={event=>importProgress(event.target.files?.[0])}/></label></div><span>SQL Academy · T-Bonk training dataset · privacy-first</span></footer>
    </main>
  </div>;
}

function Nav({icon,label,active,onClick}:{icon:React.ReactNode;label:string;active:boolean;onClick:()=>void}){return <button className={active?'active':''} onClick={onClick}>{icon}<span>{label}</span></button>}
function ResultTables({tables}:{tables:SqlTable[]}){if(!tables.length)return null;return <div className="result-stack">{tables.map((table,index)=><div className="result-table-wrap" key={index}><table><thead><tr>{table.columns.map(column=><th key={column}>{column}</th>)}</tr></thead><tbody>{table.values.map((row,rowIndex)=><tr key={rowIndex}>{row.map((value,cellIndex)=><td key={cellIndex}>{normalize(value)}</td>)}</tr>)}</tbody></table><div className="row-count">{table.values.length} строк</div></div>)}</div>}
function HomeView({progress,completion,weakTopics,onStart,onOpenTopic}:{progress:Progress;completion:number;weakTopics:{id:string;title:string;score:number;solved:number}[];onStart:()=>void;onOpenTopic:(id:string)=>void}){return <><section className="hero"><div><h1>SQL, который работает<br/>в реальной поддержке.</h1><p>Практическая академия для 2nd Support Engineer: от точного SELECT до оконных функций, EXPLAIN и аналитики SLA.</p><div className="hero-actions"><button className="primary" onClick={onStart}>Продолжить обучение <ChevronRight/></button><span>120 проверяемых задач · 20 модулей · 4 режима</span></div></div><div className="terminal"><div className="terminal-bar"><i/><i/><i/><span>support_analytics.sql</span></div><pre><b>WITH</b> service_stats <b>AS</b> ({'\n'}  <b>SELECT</b> service, COUNT(*) tickets,{'\n'}         AVG(resolution_minutes) avg_time{'\n'}  <b>FROM</b> tickets <b>GROUP BY</b> service{'\n'}){'\n'}<b>SELECT</b> *, RANK() <b>OVER</b> ({'\n'}  <b>ORDER BY</b> tickets <b>DESC</b>{'\n'}) load_rank <b>FROM</b> service_stats;</pre><div className="terminal-success">✓ Query completed · 5 rows</div></div></section><section className="stats"><article><small>Общий прогресс</small><strong>{completion}%</strong><div className="progress"><i style={{width:`${completion}%`}}/></div></article><article><small>Решено задач</small><strong>{progress.completed.length}<span>/120</span></strong></article><article><small>Текущий streak</small><strong>{progress.streak}<span> дней</span></strong></article><article><small>Накоплено XP</small><strong>{progress.xp}</strong></article></section><section className="dashboard-grid"><article className="chart-card"><div><h2>Активность</h2><p>Правильно решённые задачи за неделю</p></div><ResponsiveContainer width="100%" height={250}><AreaChart data={progress.history}><defs><linearGradient id="fill" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#8b5cf6" stopOpacity={.35}/><stop offset="95%" stopColor="#8b5cf6" stopOpacity={0}/></linearGradient></defs><CartesianGrid strokeDasharray="3 3" vertical={false}/><XAxis dataKey="day"/><YAxis allowDecimals={false}/><Tooltip/><Area type="monotone" dataKey="solved" stroke="#8b5cf6" fill="url(#fill)" strokeWidth={3}/></AreaChart></ResponsiveContainer></article><article className="modules-card"><h2>Фокус повторения</h2><div>{weakTopics.map((topic,index)=><button className="weak-topic" key={topic.id} onClick={()=>onOpenTopic(topic.id)}><span>{String(index+1).padStart(2,'0')}</span><p><strong>{topic.title}</strong><small>{topic.solved}/6 решено</small></p><ChevronRight/></button>)}</div></article></section></>}
export default App;