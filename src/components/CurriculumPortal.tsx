import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import CurriculumSyncButton from './CurriculumSyncButton';
import type { QueryExecResult, SqlJsStatic } from 'sql.js';
import {
  ArrowLeft,
  ArrowRight,
  BookMarked,
  BookOpen,
  Bookmark,
  Check,
  CheckCircle2,
  ChevronRight,
  Circle,
  ClipboardCheck,
  Code2,
  FileText,
  GraduationCap,
  ListChecks,
  Play,
  Search,
  Sparkles,
  Target,
  Trophy,
  X
} from 'lucide-react';
import {
  capstoneProjects,
  curriculumLessons,
  curriculumSearch,
  lessonById,
  lessonForModule
} from '../data/curriculum';
import { tasks } from '../data/course';
import { trainingSeedSql } from '../data/training-dataset';
import { openAcademyTask } from '../lib/academy-navigation';
import {
  answerCurriculumCheck,
  completeProject,
  curriculumCompletion as progressCompletion,
  CurriculumProgressV1,
  loadCurriculumProgress,
  markCurriculumSection,
  setCurriculumBookmark,
  updateProjectDraft
} from '../lib/curriculum-progress';
import { useDialogFocus } from '../lib/dialog-focus';
import '../styles-curriculum.css';

type CurriculumTab = 'lessons' | 'projects';
type SqlEngine = SqlJsStatic;
type SqlTable = { columns: string[]; values: unknown[][] };

function formatValue(value: unknown) {
  if (value === null) return 'NULL';
  if (typeof value === 'number' && !Number.isInteger(value)) return value.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
  return String(value);
}

function hashSelection() {
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  return {
    lessonId: params.get('lesson'),
    sectionId: params.get('section'),
    projectId: params.get('project')
  };
}

function replaceHash(values: { lessonId?: string; sectionId?: string; projectId?: string }) {
  const params = new URLSearchParams();
  if (values.lessonId) params.set('lesson', values.lessonId);
  if (values.sectionId) params.set('section', values.sectionId);
  if (values.projectId) params.set('project', values.projectId);
  const next = params.toString();
  history.replaceState(null, '', `${window.location.pathname}${window.location.search}${next ? `#${next}` : ''}`);
}

function projectDraft(progress: CurriculumProgressV1, projectId: string) {
  return progress.projectDrafts[projectId] || { sql: '', notes: '', completedDeliverables: [], updatedAt: '' };
}

export default function CurriculumPortal({ openRequest = 0 }: { openRequest?: number }) {
  const initialHash = hashSelection();
  const initialProgress = loadCurriculumProgress();
  const initialLesson = lessonById(initialHash.lessonId || '')
    || lessonById(initialProgress.bookmark?.lessonId || '')
    || curriculumLessons[0];
  const initialProject = capstoneProjects.find(project => project.id === initialHash.projectId) || capstoneProjects[0];

  const [open, setOpen] = useState(Boolean(openRequest));
  const [tab, setTab] = useState<CurriculumTab>(initialHash.projectId ? 'projects' : 'lessons');
  const [query, setQuery] = useState('');
  const [lessonId, setLessonId] = useState(initialLesson.id);
  const [projectId, setProjectId] = useState(initialProject.id);
  const [progress, setProgress] = useState<CurriculumProgressV1>(initialProgress);
  const [choice, setChoice] = useState<number | null>(initialProgress.answers[initialLesson.check.id]?.optionIndex ?? null);
  const [engine, setEngine] = useState<SqlEngine | null>(null);
  const [running, setRunning] = useState(false);
  const [runMessage, setRunMessage] = useState('Нажми «Выполнить», чтобы проверить пример на локальном SQLite.');
  const [result, setResult] = useState<SqlTable[]>([]);
  const shellRef = useRef<HTMLDivElement>(null);
  const previousOverflow = useRef('');

  const lesson = lessonById(lessonId) || curriculumLessons[0];
  const project = capstoneProjects.find(item => item.id === projectId) || capstoneProjects[0];
  const filteredLessons = useMemo(() => curriculumSearch(query), [query]);
  const completedSections = new Set(progress.completedSections);
  const completedLessons = new Set(progress.completedLessons);
  const completedProjects = new Set(progress.completedProjects);
  const completion = progressCompletion(progress);
  const activeDraft = projectDraft(progress, project.id);
  const currentLessonIndex = curriculumLessons.findIndex(item => item.id === lesson.id);

  useEffect(() => {
    if (openRequest <= 0) return;
    const hash = hashSelection();
    const requestedLesson = lessonById(hash.lessonId || '');
    const requestedProject = capstoneProjects.find(item => item.id === hash.projectId);
    if (requestedLesson) {
      setTab('lessons');
      setLessonId(requestedLesson.id);
      setChoice(loadCurriculumProgress().answers[requestedLesson.check.id]?.optionIndex ?? null);
    }
    if (requestedProject) {
      setTab('projects');
      setProjectId(requestedProject.id);
    }
    setProgress(loadCurriculumProgress());
    setOpen(true);
  }, [openRequest]);

  useDialogFocus(open, shellRef, () => setOpen(false));

  useEffect(() => {
    if (!open) return;
    previousOverflow.current = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previousOverflow.current; };
  }, [open]);

  useEffect(() => {
    if (!open || tab !== 'lessons') return;
    const sectionId = progress.bookmark?.lessonId === lesson.id ? progress.bookmark.sectionId : lesson.sections[0].id;
    replaceHash({ lessonId: lesson.id, sectionId });
  }, [lesson.id, open, progress.bookmark, tab]);

  useEffect(() => {
    if (!open || tab !== 'projects') return;
    replaceHash({ projectId: project.id });
  }, [open, project.id, tab]);

  const selectLesson = (nextId: string) => {
    const next = lessonById(nextId);
    if (!next) return;
    setLessonId(next.id);
    setChoice(progress.answers[next.check.id]?.optionIndex ?? null);
    setResult([]);
    setRunMessage('Нажми «Выполнить», чтобы проверить пример на локальном SQLite.');
    window.requestAnimationFrame(() => document.querySelector<HTMLElement>('.curriculum-reader')?.focus({ preventScroll: true }));
  };

  const scrollToSection = (sectionId: string) => {
    document.getElementById(`curriculum-${sectionId}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setProgress(current => setCurriculumBookmark(current, lesson.id, sectionId));
    replaceHash({ lessonId: lesson.id, sectionId });
  };

  const runExample = async () => {
    setRunning(true);
    setResult([]);
    setRunMessage('SQLite выполняет пример…');
    try {
      let sqlEngine = engine;
      if (!sqlEngine) {
        const module = await import('sql.js');
        sqlEngine = await module.default({ locateFile: file => `https://sql.js.org/dist/${file}` });
        setEngine(sqlEngine);
      }
      const database = new sqlEngine.Database();
      try {
        database.run(trainingSeedSql);
        const output = database.exec(lesson.example.sql) as QueryExecResult[];
        setResult(output as SqlTable[]);
        setRunMessage(output.length ? `Готово: ${output.reduce((sum, block) => sum + block.values.length, 0)} строк результата.` : 'SQL выполнен без табличного результата.');
      } finally {
        database.close();
      }
    } catch (reason) {
      setRunMessage(`Ошибка SQLite: ${reason instanceof Error ? reason.message : String(reason)}`);
    } finally {
      setRunning(false);
    }
  };

  const submitCheck = () => {
    if (choice === null) return;
    setProgress(current => answerCurriculumCheck(current, lesson.id, choice));
  };

  const switchTab = (next: CurriculumTab) => {
    setTab(next);
    if (next === 'lessons') replaceHash({ lessonId: lesson.id, sectionId: lesson.sections[0].id });
    else replaceHash({ projectId: project.id });
  };

  const close = () => {
    setOpen(false);
    replaceHash({});
  };

  if (!open) return null;

  const lessonContent = <div className="curriculum-layout">
    <aside className="curriculum-catalog" aria-label="Каталог уроков">
      <div className="curriculum-search">
        <Search />
        <input value={query} onChange={event => setQuery(event.target.value)} placeholder="Тема, термин или ошибка…" aria-label="Поиск по урокам" />
      </div>
      <div className="curriculum-lesson-list">
        {filteredLessons.map((item, index) => <button
          key={item.id}
          type="button"
          className={item.id === lesson.id ? 'active' : ''}
          onClick={() => selectLesson(item.id)}
          aria-current={item.id === lesson.id ? 'page' : undefined}
        >
          <span>{String(curriculumLessons.indexOf(item) + 1).padStart(2, '0')}</span>
          <div><strong>{item.title}</strong><small>{item.minutes} мин · {item.sections.length} раздела</small></div>
          {completedLessons.has(item.id) ? <CheckCircle2 className="complete" /> : <ChevronRight />}
        </button>)}
        {!filteredLessons.length && <div className="curriculum-empty"><Search /><strong>Ничего не найдено</strong><small>Попробуй термин из SQL или название ошибки.</small></div>}
      </div>
    </aside>

    <article className="curriculum-reader" tabIndex={-1} data-testid="curriculum-reader">
      <header className="curriculum-lesson-hero">
        <div className="curriculum-index">Урок {String(currentLessonIndex + 1).padStart(2, '0')} / {curriculumLessons.length}</div>
        <h1>{lesson.title}</h1>
        <p>{lesson.subtitle}</p>
        <div className="curriculum-lesson-meta">
          <span><BookOpen />{lesson.minutes} минут</span>
          <span><Target />{lesson.objectives.length} результата</span>
          <span className={completedLessons.has(lesson.id) ? 'done' : ''}><CheckCircle2 />{completedLessons.has(lesson.id) ? 'Урок завершён' : `${lesson.sections.filter(section => completedSections.has(section.id)).length}/${lesson.sections.length} раздела`}</span>
        </div>
        <div className="curriculum-objectives">
          <strong>После урока ты сможешь</strong>
          <ul>{lesson.objectives.map(item => <li key={item}><Check />{item}</li>)}</ul>
        </div>
        {!!lesson.prerequisites.length && <div className="curriculum-prerequisites">
          <span>Перед этим:</span>{lesson.prerequisites.map(moduleId => {
            const prerequisite = lessonForModule(moduleId);
            return prerequisite ? <button key={moduleId} onClick={() => selectLesson(prerequisite.id)}>{prerequisite.title}</button> : null;
          })}
        </div>}
      </header>

      <nav className="curriculum-section-nav" aria-label="Разделы текущего урока">
        {lesson.sections.map((section, index) => <button key={section.id} onClick={() => scrollToSection(section.id)}>
          {completedSections.has(section.id) ? <CheckCircle2 /> : <span>{index + 1}</span>}{section.title}
        </button>)}
      </nav>

      {lesson.sections.map(section => <section id={`curriculum-${section.id}`} className={`curriculum-section ${section.kind}`} key={section.id}>
        <div className="curriculum-section-heading">
          <span>{section.kind === 'concept' ? <GraduationCap /> : section.kind === 'workflow' ? <ListChecks /> : <Target />}</span>
          <div><small>{section.kind === 'concept' ? 'Понимание' : section.kind === 'workflow' ? 'Практика' : 'Диагностика'}</small><h2>{section.title}</h2></div>
        </div>
        <p className="curriculum-lead">{section.lead}</p>
        {section.paragraphs.map(paragraph => <p key={paragraph}>{paragraph}</p>)}
        <ul>{section.bullets.map(item => <li key={item}>{item}</li>)}</ul>
        <button
          type="button"
          className={completedSections.has(section.id) ? 'curriculum-complete-button done' : 'curriculum-complete-button'}
          onClick={() => setProgress(current => markCurriculumSection(current, lesson.id, section.id))}
        >{completedSections.has(section.id) ? <CheckCircle2 /> : <Circle />}{completedSections.has(section.id) ? 'Раздел изучен' : 'Отметить раздел изученным'}</button>
      </section>)}

      <section className="curriculum-example" aria-labelledby={`example-title-${lesson.id}`}>
        <div className="curriculum-section-heading"><span><Code2 /></span><div><small>Runnable example</small><h2 id={`example-title-${lesson.id}`}>{lesson.example.title}</h2></div></div>
        <p>{lesson.example.description}</p>
        <pre><code>{lesson.example.sql}</code></pre>
        <div className="curriculum-example-actions">
          <button onClick={() => void runExample()} disabled={running}><Play />{running ? 'Выполняю…' : 'Выполнить на SQLite'}</button>
          <span role="status" aria-live="polite">{runMessage}</span>
        </div>
        {!!result.length && <div className="curriculum-results" data-testid="curriculum-example-result">
          {result.map((block, blockIndex) => <div className="result-table-wrap" key={blockIndex}><table><caption className="sr-only">Результат примера {lesson.title}</caption><thead><tr>{block.columns.map(column => <th scope="col" key={column}>{column}</th>)}</tr></thead><tbody>{block.values.map((row, rowIndex) => <tr key={rowIndex}>{row.map((value, columnIndex) => <td key={columnIndex}>{formatValue(value)}</td>)}</tr>)}</tbody></table></div>)}
        </div>}
      </section>

      <section className="curriculum-glossary">
        <div className="curriculum-section-heading"><span><BookMarked /></span><div><small>Словарь</small><h2>Термины урока</h2></div></div>
        <dl>{lesson.glossary.map(entry => <div key={entry.term}><dt>{entry.term}</dt><dd>{entry.definition}</dd></div>)}</dl>
      </section>

      <section className="curriculum-check" data-testid="curriculum-check">
        <div className="curriculum-section-heading"><span><ClipboardCheck /></span><div><small>Knowledge check</small><h2>Проверь понимание</h2></div></div>
        <fieldset>
          <legend>{lesson.check.question}</legend>
          {lesson.check.options.map((option, index) => <label key={option} className={choice === index ? 'selected' : ''}>
            <input type="radio" name={lesson.check.id} checked={choice === index} onChange={() => setChoice(index)} />
            <span>{String.fromCharCode(65 + index)}</span>{option}
          </label>)}
        </fieldset>
        <button className="curriculum-check-submit" onClick={submitCheck} disabled={choice === null}>Проверить ответ</button>
        {progress.answers[lesson.check.id] && <div className={progress.answers[lesson.check.id].correct ? 'curriculum-feedback success' : 'curriculum-feedback error'} role="status" aria-live="polite">
          {progress.answers[lesson.check.id].correct ? <CheckCircle2 /> : <Target />}
          <div><strong>{progress.answers[lesson.check.id].correct ? 'Верно' : 'Пока неверно'}</strong><p>{lesson.check.explanation}</p></div>
        </div>}
      </section>

      <section className="curriculum-practice-links">
        <div><small>Закрепление</small><h2>Связанные задачи</h2><p>После теории реши несколько задач без подсказки.</p></div>
        <div>{lesson.practiceTaskIds.map(taskId => {
          const task = tasks.find(item => item.id === taskId);
          return task ? <button key={taskId} onClick={() => { close(); openAcademyTask(taskId); }}><Play /><span><strong>{task.title}</strong><small>{task.difficulty} · {task.xp} XP</small></span><ChevronRight /></button> : null;
        })}</div>
      </section>

      <footer className="curriculum-reader-footer">
        <button disabled={currentLessonIndex <= 0} onClick={() => selectLesson(curriculumLessons[currentLessonIndex - 1].id)}><ArrowLeft />Предыдущий</button>
        <button onClick={() => setProgress(current => setCurriculumBookmark(current, lesson.id, lesson.sections[0].id))}><Bookmark />Сохранить место</button>
        <button disabled={currentLessonIndex >= curriculumLessons.length - 1} onClick={() => selectLesson(curriculumLessons[currentLessonIndex + 1].id)}>Следующий<ArrowRight /></button>
      </footer>
    </article>
  </div>;

  const projectContent = <div className="project-lab-layout">
    <aside className="project-catalog" aria-label="Каталог проектов">
      <div className="project-catalog-heading"><Sparkles /><span><strong>Project Lab</strong><small>3 production-like кейса</small></span></div>
      {capstoneProjects.map(item => <button key={item.id} className={item.id === project.id ? 'active' : ''} onClick={() => setProjectId(item.id)} aria-current={item.id === project.id ? 'page' : undefined}>
        <span>{completedProjects.has(item.id) ? <CheckCircle2 /> : <FileText />}</span>
        <div><strong>{item.title}</strong><small>{item.estimatedMinutes} мин · {item.deliverables.length} deliverables</small></div>
        <ChevronRight />
      </button>)}
      <div className="project-progress"><span><Trophy />Проекты</span><strong>{progress.completedProjects.length}/{capstoneProjects.length}</strong><div><i style={{ width: `${capstoneProjects.length ? progress.completedProjects.length / capstoneProjects.length * 100 : 0}%` }} /></div></div>
    </aside>

    <main className="project-workspace" data-testid="project-lab">
      <header className="project-hero">
        <div><small>Capstone project</small><h1>{project.title}</h1><p>{project.summary}</p></div>
        <span className={completedProjects.has(project.id) ? 'project-status done' : 'project-status'}>{completedProjects.has(project.id) ? <CheckCircle2 /> : <Target />}{completedProjects.has(project.id) ? 'Завершён' : `${activeDraft.completedDeliverables.length}/${project.deliverables.length} этапа`}</span>
      </header>
      <section className="project-scenario"><strong>Сценарий</strong><p>{project.scenario}</p><div>{project.moduleIds.map(moduleId => <span key={moduleId}>{lessonForModule(moduleId)?.title || moduleId}</span>)}</div></section>

      <section className="project-deliverables">
        <div className="project-section-title"><span>01</span><div><small>План работы</small><h2>Deliverables</h2></div></div>
        {project.deliverables.map((deliverable, index) => {
          const done = activeDraft.completedDeliverables.includes(deliverable.id);
          return <article key={deliverable.id} className={done ? 'done' : ''}>
            <header><button aria-label={`${done ? 'Снять отметку' : 'Отметить'}: ${deliverable.title}`} onClick={() => {
              const completedDeliverables = done
                ? activeDraft.completedDeliverables.filter(id => id !== deliverable.id)
                : [...activeDraft.completedDeliverables, deliverable.id];
              setProgress(current => updateProjectDraft(current, project.id, { completedDeliverables }));
            }}>{done ? <CheckCircle2 /> : <Circle />}</button><span><small>Этап {index + 1}</small><h3>{deliverable.title}</h3></span></header>
            <p>{deliverable.description}</p>
            <ul>{deliverable.acceptance.map(item => <li key={item}><Check />{item}</li>)}</ul>
            <button className="project-use-starter" onClick={() => setProgress(current => updateProjectDraft(current, project.id, { sql: `${activeDraft.sql}${activeDraft.sql ? '\n\n' : ''}${deliverable.starterSql}` }))}><Code2 />Добавить starter в draft</button>
          </article>;
        })}
      </section>

      <section className="project-draft">
        <div className="project-section-title"><span>02</span><div><small>Рабочая область</small><h2>SQL draft и заметки</h2></div></div>
        <label><span>SQL draft</span><textarea data-testid="project-sql-draft" value={activeDraft.sql} onChange={event => setProgress(current => updateProjectDraft(current, project.id, { sql: event.target.value }))} placeholder="Собирай итоговый SQL здесь…" spellCheck={false} /></label>
        <label><span>Инженерные заметки</span><textarea value={activeDraft.notes} onChange={event => setProgress(current => updateProjectDraft(current, project.id, { notes: event.target.value }))} placeholder="Контракт результата, проверки, гипотезы по плану…" /></label>
        <small role="status" aria-live="polite">Draft сохраняется локально для текущего аккаунта.</small>
      </section>

      <section className="project-rubric">
        <div className="project-section-title"><span>03</span><div><small>Definition of done</small><h2>Rubric</h2></div></div>
        <div>{project.rubric.map(item => <article key={item.id}><strong>{item.weight}%</strong><span><b>{item.title}</b><small>{item.description}</small></span></article>)}</div>
      </section>

      <div className="project-complete-bar">
        <div><strong>Готово к завершению?</strong><small>Отметь все deliverables и сохрани рабочий SQL минимум из 20 символов.</small></div>
        <button data-testid="complete-project" disabled={project.deliverables.some(item => !activeDraft.completedDeliverables.includes(item.id)) || activeDraft.sql.trim().length < 20 || completedProjects.has(project.id)} onClick={() => setProgress(current => completeProject(current, project.id))}><Trophy />{completedProjects.has(project.id) ? 'Проект завершён' : 'Завершить проект'}</button>
      </div>
    </main>
  </div>;

  const shell = <div ref={shellRef} tabIndex={-1} className="curriculum-shell" role="dialog" aria-modal="true" aria-labelledby="curriculum-dialog-title" data-testid="curriculum-studio">
    <header className="curriculum-topbar">
      <div className="curriculum-brand"><span><GraduationCap /></span><div><strong id="curriculum-dialog-title">Curriculum Studio</strong><small>Теория, примеры и capstone-проекты</small></div></div>
      <div className="curriculum-tabs" role="tablist" aria-label="Режим Curriculum Studio">
        <button role="tab" aria-selected={tab === 'lessons'} className={tab === 'lessons' ? 'active' : ''} onClick={() => switchTab('lessons')}><BookOpen />Уроки</button>
        <button role="tab" aria-selected={tab === 'projects'} className={tab === 'projects' ? 'active' : ''} onClick={() => switchTab('projects')}><Sparkles />Project Lab</button>
      </div>
      <div className="curriculum-top-actions"><CurriculumSyncButton onProgress={setProgress} /><span><strong>{completion}%</strong><small>curriculum</small></span><button data-autofocus onClick={close} aria-label="Закрыть Curriculum Studio"><X /></button></div>
    </header>
    {tab === 'lessons' ? lessonContent : projectContent}
  </div>;

  return createPortal(shell, document.body);
}
