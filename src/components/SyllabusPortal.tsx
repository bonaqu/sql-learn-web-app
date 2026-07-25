import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  BookOpen,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  Clock3,
  Code2,
  Database,
  Gauge,
  GraduationCap,
  Languages,
  Layers3,
  LockKeyhole,
  Map,
  Play,
  Route,
  ShieldCheck,
  Target,
  Trophy,
  X
} from 'lucide-react';
import { curriculumCheckpoints, curriculumLessons } from '../data/complete-curriculum';
import { modules, tasks } from '../data/course-catalog';
import { dialectPatterns, dialects, type SqlDialect } from '../data/sql-dialects';
import { sqlExams, sqlTracks, type SqlTrackId } from '../data/sql-exams';
import { loadCurriculumProgress } from '../lib/curriculum-progress';
import { openDeferredFeature } from '../lib/deferred-features';
import { moduleMastery, overallReadiness } from '../lib/learning-path';
import { loadProgress } from '../lib/progress';
import { useDialogFocus } from '../lib/dialog-focus';
import '../syllabus.css';

type SyllabusTab = 'map' | 'dialects' | 'exams';

function masteryLabel(value: number) {
  if (value >= 82) return 'Освоено';
  if (value >= 55) return 'Закрепление';
  if (value > 0) return 'В работе';
  return 'Не начато';
}

export default function SyllabusPortal({ openRequest = 0 }: { openRequest?: number }) {
  const [open, setOpen] = useState(Boolean(openRequest));
  const [tab, setTab] = useState<SyllabusTab>('map');
  const [trackId, setTrackId] = useState<SqlTrackId>('fundamentals');
  const [patternId, setPatternId] = useState(dialectPatterns[0].id);
  const shellRef = useRef<HTMLDivElement>(null);
  const previousOverflow = useRef('');

  const progress = useMemo(() => loadProgress(), [openRequest, open]);
  const curriculumProgress = useMemo(() => loadCurriculumProgress(), [openRequest, open]);
  const mastery = useMemo(() => moduleMastery(progress), [progress]);
  const readiness = useMemo(() => overallReadiness(progress), [progress]);
  const activeTrack = sqlTracks.find(track => track.id === trackId) || sqlTracks[0];
  const activePattern = dialectPatterns.find(pattern => pattern.id === patternId) || dialectPatterns[0];

  useEffect(() => { if (openRequest > 0) setOpen(true); }, [openRequest]);
  useDialogFocus(open, shellRef, () => setOpen(false));
  useEffect(() => {
    if (!open) return;
    previousOverflow.current = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previousOverflow.current; };
  }, [open]);

  if (!open) return null;

  const mapContent = <div className="syllabus-map-layout" data-testid="syllabus-map">
    <aside className="syllabus-track-list" aria-label="Учебные треки">
      <header><Map /><div><strong>Learning tracks</strong><small>Выбери маршрут под цель</small></div></header>
      {sqlTracks.map(track => {
        const trackModules = mastery.filter(item => track.moduleIds.includes(item.id));
        const score = Math.round(trackModules.reduce((sum, item) => sum + item.mastery, 0) / Math.max(trackModules.length, 1));
        return <button key={track.id} className={track.id === activeTrack.id ? 'active' : ''} onClick={() => setTrackId(track.id)} aria-current={track.id === activeTrack.id ? 'page' : undefined}>
          <span><Route /></span>
          <div><strong>{track.title}</strong><small>{track.estimatedHours} ч · {track.moduleIds.length} модулей</small><i><b style={{ width: `${score}%` }} /></i></div>
          <em>{score}%</em>
        </button>;
      })}
    </aside>

    <main className="syllabus-track-workspace">
      <header className="syllabus-track-hero">
        <div><small>Учебный трек</small><h1>{activeTrack.title}</h1><p>{activeTrack.purpose}</p></div>
        <div className="syllabus-track-score"><Gauge /><strong>{readiness}%</strong><span>общая готовность</span></div>
      </header>
      <section className="syllabus-outcomes"><div><Target /><span><strong>Результаты трека</strong><small>Что должно стать самостоятельным навыком</small></span></div><ul>{activeTrack.outcomes.map(outcome => <li key={outcome}><CheckCircle2 />{outcome}</li>)}</ul></section>
      <section className="syllabus-module-roadmap">
        <div className="syllabus-section-title"><Layers3 /><div><small>{activeTrack.estimatedHours} часов fast-track</small><h2>Модули маршрута</h2></div></div>
        <div>{activeTrack.moduleIds.map((moduleId, index) => {
          const module = modules.find(([id]) => id === moduleId);
          const state = mastery.find(item => item.id === moduleId);
          const lessonCount = curriculumLessons.filter(lesson => lesson.module === moduleId).length;
          const taskCount = tasks.filter(task => task.module === moduleId).length;
          return <article key={moduleId} className={state?.mastery && state.mastery >= 82 ? 'mastered' : ''}>
            <span className="syllabus-module-index">{String(index + 1).padStart(2, '0')}</span>
            <div className="syllabus-module-copy"><small>{masteryLabel(state?.mastery || 0)}</small><h3>{module?.[1] || moduleId}</h3><p>{module?.[2]}</p><div><span><BookOpen />{lessonCount} урока</span><span><Code2 />{taskCount} задач</span><span><Trophy />{state?.mastery || 0}% mastery</span></div></div>
            <div className="syllabus-module-meter"><i style={{ height: `${state?.mastery || 0}%` }} /></div>
          </article>;
        })}</div>
      </section>
      <section className="syllabus-checkpoint-summary"><ClipboardCheck /><div><strong>{curriculumCheckpoints.length} контрольных точек</strong><p>Checkpoint объединяет несколько модулей и проверяет перенос навыка, а не повтор одного шаблона.</p></div></section>
    </main>
  </div>;

  const dialectContent = <div className="dialect-lab" data-testid="dialect-lab">
    <aside className="dialect-pattern-list" aria-label="SQL patterns">
      <header><Languages /><div><strong>Dialect Lab</strong><small>{dialectPatterns.length} production patterns</small></div></header>
      {dialectPatterns.map(pattern => <button key={pattern.id} className={pattern.id === activePattern.id ? 'active' : ''} onClick={() => setPatternId(pattern.id)}><Database /><span><strong>{pattern.title}</strong><small>{pattern.concept}</small></span><ChevronRight /></button>)}
    </aside>
    <main className="dialect-workspace">
      <header><small>Portable SQL reasoning</small><h1>{activePattern.title}</h1><p>{activePattern.portableGuidance}</p></header>
      <section className="dialect-grid">{dialects.map(dialect => <article key={dialect.id}>
        <div className="dialect-card-heading"><span>{dialect.title.slice(0, 2).toUpperCase()}</span><div><h2>{dialect.title}</h2><small>{dialect.role}</small></div></div>
        <pre><code>{activePattern.examples[dialect.id as SqlDialect]}</code></pre>
        {activePattern.notes[dialect.id] && <p><ShieldCheck />{activePattern.notes[dialect.id]}</p>}
      </article>)}</section>
      <section className="dialect-rule"><Languages /><div><strong>Правило переноса</strong><p>Сначала переноси семантику: форму результата, NULL-поведение, конфликт ключа и transaction boundary. Синтаксис переписывается после этого.</p></div></section>
    </main>
  </div>;

  const examContent = <main className="syllabus-exams" data-testid="syllabus-exams">
    <header className="syllabus-exam-hero"><div><small>Graded assessment</small><h1>Экзамены SQL Academy</h1><p>Три уровня проверки: входная диагностика, production-надежность и финальная смешанная готовность.</p></div><ClipboardCheck /></header>
    <div className="syllabus-exam-grid">{sqlExams.map((exam, index) => {
      const unlocked = exam.requiredModuleIds.every(moduleId => (mastery.find(item => item.id === moduleId)?.mastery || 0) >= 45);
      return <article key={exam.id} className={unlocked ? 'unlocked' : ''}>
        <header><span>0{index + 1}</span><div><small>{exam.durationMinutes} минут · проходной {exam.passingScore}%</small><h2>{exam.title}</h2></div>{unlocked ? <CheckCircle2 /> : <LockKeyhole />}</header>
        <p>{exam.description}</p>
        <div className="syllabus-exam-stats"><span><Code2 /><strong>{exam.taskIds.length}</strong> задач</span><span><Gauge /><strong>{exam.readinessWeight}%</strong> readiness weight</span></div>
        <ul>{exam.rules.map(rule => <li key={rule}><ShieldCheck />{rule}</li>)}</ul>
        {!!exam.requiredModuleIds.length && <div className="syllabus-exam-required"><strong>Prerequisites</strong><div>{exam.requiredModuleIds.map(moduleId => <span key={moduleId}>{modules.find(([id]) => id === moduleId)?.[1] || moduleId}</span>)}</div></div>}
        <button onClick={() => { setOpen(false); window.setTimeout(() => openDeferredFeature('assessment'), 50); }}><Play />Открыть Assessment Center</button>
      </article>;
    })}</div>
    <section className="syllabus-certificate"><Trophy /><div><strong>Readiness certificate</strong><p>Финальный статус учитывает задачи, уроки, checkpoints, экзамены и capstone. Сейчас завершено уроков: {curriculumProgress.completedLessons.length}/{curriculumLessons.length}, проектов: {curriculumProgress.completedProjects.length}/3.</p></div></section>
  </main>;

  const shell = <div ref={shellRef} tabIndex={-1} className="syllabus-shell" role="dialog" aria-modal="true" aria-labelledby="syllabus-dialog-title">
    <header className="syllabus-topbar">
      <div className="syllabus-brand"><span><GraduationCap /></span><div><strong id="syllabus-dialog-title">SQL Syllabus Center</strong><small>32 модуля · 240 задач · 5 tracks</small></div></div>
      <div className="syllabus-tabs" role="tablist" aria-label="Разделы syllabus">
        <button role="tab" aria-selected={tab === 'map'} className={tab === 'map' ? 'active' : ''} onClick={() => setTab('map')}><Map />Карта курса</button>
        <button role="tab" aria-selected={tab === 'dialects'} className={tab === 'dialects' ? 'active' : ''} onClick={() => setTab('dialects')}><Languages />Dialect Lab</button>
        <button role="tab" aria-selected={tab === 'exams'} className={tab === 'exams' ? 'active' : ''} onClick={() => setTab('exams')}><ClipboardCheck />Экзамены</button>
      </div>
      <div className="syllabus-top-stats"><span><Clock3 />74 ч</span><button data-autofocus onClick={() => setOpen(false)} aria-label="Закрыть SQL Syllabus Center"><X /></button></div>
    </header>
    {tab === 'map' ? mapContent : tab === 'dialects' ? dialectContent : examContent}
  </div>;

  return createPortal(shell, document.body);
}
