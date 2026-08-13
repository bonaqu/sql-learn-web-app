import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import initSqlJs from '../lib/sql-browser';
import {
  AlarmClock,
  AlertTriangle,
  ArrowLeft,
  BrainCircuit,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  Clock3,
  Gauge,
  History,
  ListChecks,
  LockKeyhole,
  Play,
  RefreshCw,
  ShieldCheck,
  SkipForward,
  Sparkles,
  Target,
  TimerReset,
  Trophy,
  X
} from 'lucide-react';
import {
  advanceAssessment,
  assessmentEligibility,
  assessmentModes,
  AssessmentMode,
  AssessmentReport,
  AssessmentSession,
  createAssessmentSession,
  currentAssessmentTask,
  finishAssessmentSession,
  goToAssessmentTask,
  loadAssessmentSession,
  loadLocalAssessmentReports,
  remainingSeconds,
  saveLocalAssessmentReport,
  updateAssessmentAnswer
} from '../lib/assessment';
import {
  AssessmentSqlEngine,
  AssessmentSqlExecutionError,
  AssessmentSqlTable,
  evaluateAssessmentSql
} from '../lib/assessment-runtime';
import { loadAuthSession } from '../lib/auth';
import { overallReadiness } from '../lib/learning-path';
import { loadProgress } from '../lib/progress';
import { useDialogFocus } from '../lib/dialog-focus';

const Editor = lazy(() => import('./SqlEditor'));
type RunState = 'idle' | 'success' | 'error';

function formatTimer(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
}

function formatDuration(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return minutes ? `${minutes} мин ${rest} сек` : `${rest} сек`;
}

function gradeLabel(report: AssessmentReport) {
  if (report.grade === 'strong') return 'Уверенный уровень';
  if (report.grade === 'ready') return 'Рабочая готовность';
  if (report.grade === 'developing') return 'Нужно закрепление';
  return 'Фундамент в работе';
}

function mergeReports(local: AssessmentReport[], remote: AssessmentReport[]) {
  const map = new Map<string, AssessmentReport>();
  for (const report of [...remote, ...local]) {
    const existing = map.get(report.id);
    if (!existing || new Date(report.completedAt).getTime() >= new Date(existing.completedAt).getTime()) map.set(report.id, report);
  }
  return Array.from(map.values()).sort((left, right) => new Date(right.completedAt).getTime() - new Date(left.completedAt).getTime()).slice(0, 20);
}

export default function AssessmentCenterPortal({ externalLauncher = false, openRequest = 0 }: { externalLauncher?: boolean; openRequest?: number }) {
  const auth = loadAuthSession();
  const [desktopSlot, setDesktopSlot] = useState<HTMLElement | null>(null);
  const [mobileSlot, setMobileSlot] = useState<HTMLElement | null>(null);
  const [open, setOpen] = useState(Boolean(openRequest));
  const [session, setSession] = useState<AssessmentSession | null>(() => loadAssessmentSession());
  const [report, setReport] = useState<AssessmentReport | null>(null);
  const [history, setHistory] = useState<AssessmentReport[]>(() => loadLocalAssessmentReports());
  const [engine, setEngine] = useState<AssessmentSqlEngine | null>(null);
  const [engineError, setEngineError] = useState('');
  const [secondsLeft, setSecondsLeft] = useState(() => session ? remainingSeconds(session) : 0);
  const [editorSql, setEditorSql] = useState(() => session ? currentAssessmentTask(session) ? session.answers[currentAssessmentTask(session)!.id]?.sql || '' : '' : '');
  const [result, setResult] = useState<AssessmentSqlTable[]>([]);
  const [runState, setRunState] = useState<RunState>('idle');
  const [message, setMessage] = useState('Выполни запрос и сравни результат с условиями задачи.');
  const [interviewerQuestion, setInterviewerQuestion] = useState('');
  const [interviewerAnswer, setInterviewerAnswer] = useState('AI Interviewer может уточнить требования, но не выдаёт решение.');
  const [interviewerLoading, setInterviewerLoading] = useState(false);
  const [debriefLoading, setDebriefLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [syncMessage, setSyncMessage] = useState('');
  const previousOverflow = useRef('');
  const shellRef = useRef<HTMLDivElement>(null);
  const persistTimer = useRef<number | null>(null);
  const elapsedTicks = useRef(0);

  const progress = useMemo(() => loadProgress(), [open, session?.id, report?.id]);
  const readiness = useMemo(() => overallReadiness(progress), [progress]);
  const activeTask = useMemo(() => session ? currentAssessmentTask(session) : null, [session]);
  const activeAnswer = activeTask && session ? session.answers[activeTask.id] : null;
  const config = session ? assessmentModes[session.mode] : null;

  useEffect(() => {
    if (externalLauncher) return;
    const mount = () => {
      const sidebarNav = document.querySelector('.sidebar nav');
      const mobileNav = document.querySelector('.mobile-bottom-nav');
      if (!sidebarNav || !mobileNav || document.querySelector('[data-assessment-slot="desktop"]')) return null;
      const desktop = document.createElement('span');
      desktop.dataset.assessmentSlot = 'desktop';
      desktop.className = 'assessment-nav-slot';
      const mobile = document.createElement('span');
      mobile.dataset.assessmentSlot = 'mobile';
      mobile.className = 'assessment-mobile-slot';
      const interviewButton = Array.from(sidebarNav.querySelectorAll('button')).find(button => button.textContent?.trim().startsWith('Interview'));
      if (interviewButton) interviewButton.insertAdjacentElement('afterend', desktop);
      else sidebarNav.append(desktop);
      mobileNav.append(mobile);
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
      const nextCleanup = mount();
      if (nextCleanup) observer.disconnect();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [externalLauncher]);

  useEffect(() => { if (openRequest > 0) setOpen(true); }, [openRequest]);

  useDialogFocus(open, shellRef, () => { if (!session) setOpen(false); }, !session);

  useEffect(() => {
    if (!open) return;
    previousOverflow.current = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previousOverflow.current; };
  }, [open]);

  useEffect(() => {
    if (!open || !session || engine || engineError) return;
    initSqlJs()
      .then(setEngine)
      .catch(() => setEngineError('Не удалось запустить локальный SQLite. Перезагрузи приложение и открой проверку снова.'));
  }, [engine, engineError, open, session]);

  useEffect(() => {
    if (!session || !activeTask) return;
    setEditorSql(session.answers[activeTask.id]?.sql || activeTask.starter);
    setResult([]);
    setRunState('idle');
    setMessage('Подсказки, эталонное решение и обычный Mentor отключены до завершения assessment.');
    setInterviewerQuestion('');
    setInterviewerAnswer('AI Interviewer может уточнить требования, но не выдаёт решение.');
  }, [activeTask?.id, session?.id, session?.currentIndex]);

  const complete = useCallback(async (source: AssessmentSession, status: 'completed' | 'expired' | 'abandoned') => {
    const reportValue = finishAssessmentSession(source, status);
    setSession(null);
    setReport(reportValue);
    setHistory(saveLocalAssessmentReport(reportValue));
    setResult([]);
    setRunState('idle');
    setSyncMessage('Сохраняю skill report…');
    try {
      const response = await fetch('/api/assessment/reports', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(reportValue)
      });
      if (!response.ok) throw new Error('sync');
      setSyncMessage('Skill report синхронизирован с аккаунтом.');
    } catch {
      setSyncMessage('Отчёт сохранён локально. Облачная синхронизация повторится при следующем открытии.');
    }
  }, []);

  useEffect(() => {
    if (!session) return;
    setSecondsLeft(remainingSeconds(session));
    const timer = window.setInterval(() => {
      const left = remainingSeconds(session);
      setSecondsLeft(left);
      elapsedTicks.current += 1;
      if (elapsedTicks.current >= 5 && activeTask) {
        elapsedTicks.current = 0;
        const next = updateAssessmentAnswer(session, activeTask.id, {
          elapsedSeconds: (session.answers[activeTask.id]?.elapsedSeconds || 0) + 5,
          sql: editorSql
        });
        setSession(next);
      }
      if (left <= 0) {
        window.clearInterval(timer);
        void complete(session, 'expired');
      }
    }, 1000);
    return () => window.clearInterval(timer);
  }, [activeTask?.id, complete, editorSql, session?.deadlineAt, session?.id]);

  useEffect(() => {
    if (!session || !activeTask) return;
    if (persistTimer.current) window.clearTimeout(persistTimer.current);
    persistTimer.current = window.setTimeout(() => {
      const next = updateAssessmentAnswer(session, activeTask.id, { sql: editorSql });
      setSession(next);
    }, 350);
    return () => {
      if (persistTimer.current) window.clearTimeout(persistTimer.current);
    };
  }, [editorSql]);

  const refreshHistory = useCallback(async () => {
    if (!auth) return;
    setHistoryLoading(true);
    try {
      const response = await fetch('/api/assessment/reports');
      if (!response.ok) throw new Error('history');
      const payload = await response.json() as { reports?: AssessmentReport[] };
      const merged = mergeReports(loadLocalAssessmentReports(auth.userId), payload.reports || []);
      setHistory(merged);
      for (const item of merged) saveLocalAssessmentReport(item);
    } catch {
      setHistory(loadLocalAssessmentReports(auth.userId));
    } finally {
      setHistoryLoading(false);
    }
  }, [auth?.userId]);

  useEffect(() => {
    if (open && !session) void refreshHistory();
  }, [open, refreshHistory, session]);

  const start = (mode: AssessmentMode) => {
    try {
      const next = createAssessmentSession(mode, progress, readiness);
      setSession(next);
      setReport(null);
      setSecondsLeft(remainingSeconds(next));
      setEngineError('');
      setSyncMessage('');
    } catch (error) {
      setSyncMessage(error instanceof Error ? error.message : 'Не удалось начать assessment');
    }
  };

  const resume = () => {
    const stored = loadAssessmentSession();
    if (!stored) return;
    if (remainingSeconds(stored) <= 0) {
      void complete(stored, 'expired');
      return;
    }
    setSession(stored);
    setReport(null);
    setSecondsLeft(remainingSeconds(stored));
  };

  const runSql = () => {
    if (!session || !activeTask || !activeAnswer || !engine) return;
    const started = Date.now();
    try {
      const evaluation = evaluateAssessmentSql(
        engine,
        editorSql,
        activeTask,
        session.mode === 'diagnostic' ? 'placement' : 'assessment'
      );
      const attempts = activeAnswer.attempts + 1;
      const next = updateAssessmentAnswer(session, activeTask.id, {
        sql: editorSql,
        attempts,
        incorrect: activeAnswer.incorrect + (evaluation.correct ? 0 : 1),
        correct: evaluation.correct,
        skipped: false,
        elapsedSeconds: activeAnswer.elapsedSeconds + Math.max(1, Math.round((Date.now() - started) / 1000)),
        completedAt: evaluation.correct ? new Date().toISOString() : activeAnswer.completedAt
      });
      setSession(next);
      setResult(evaluation.output);
      setRunState(evaluation.correct ? 'success' : 'error');
      setMessage(evaluation.correct
        ? 'Контракт результата и скрытые проверки пройдены. Ответ зафиксирован в assessment.'
        : `${evaluation.diagnostic?.title || 'Результат не совпал'}. ${evaluation.diagnostic?.nextStep || 'Проверь контракт результата.'}`);
    } catch (error) {
      const technical = error instanceof AssessmentSqlExecutionError && error.kind === 'technical';
      const next = updateAssessmentAnswer(session, activeTask.id, technical ? {
        sql: editorSql,
        technicalErrors: activeAnswer.technicalErrors + 1
      } : {
        sql: editorSql,
        attempts: activeAnswer.attempts + 1,
        incorrect: activeAnswer.incorrect + 1,
        elapsedSeconds: activeAnswer.elapsedSeconds + Math.max(1, Math.round((Date.now() - started) / 1000))
      });
      setSession(next);
      setResult([]);
      setRunState('error');
      setMessage(technical
        ? `Техническая ошибка assessment: ${error.message}. Она не учитывается как ошибка знания.`
        : `Ошибка SQLite: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const skip = () => {
    if (!session || !activeTask || !activeAnswer) return;
    const updated = updateAssessmentAnswer(session, activeTask.id, {
      sql: editorSql,
      skipped: true,
      completedAt: new Date().toISOString()
    });
    if (updated.currentIndex >= updated.taskIds.length - 1) void complete(updated, 'completed');
    else setSession(advanceAssessment(updated));
  };

  const nextTask = () => {
    if (!session) return;
    if (session.currentIndex >= session.taskIds.length - 1) void complete(session, 'completed');
    else setSession(advanceAssessment(session));
  };

  const askInterviewer = async () => {
    if (!session || !activeTask || !activeAnswer || !config?.interviewer || activeAnswer.interviewerUses >= 2 || !interviewerQuestion.trim()) return;
    setInterviewerLoading(true);
    const fallback = 'Уточни ожидаемую форму результата: что означает одна строка, какие столбцы обязательны и нужен ли стабильный порядок. Я не буду подсказывать готовый SQL.';
    setInterviewerAnswer(fallback);
    try {
      const response = await fetch('/api/assessment/interviewer', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sessionId: session.id,
          taskId: activeTask.id,
          title: activeTask.title,
          description: activeTask.description,
          topic: activeTask.topic,
          sql: editorSql,
          question: interviewerQuestion.trim(),
          attempts: activeAnswer.attempts
        })
      });
      if (!response.ok) throw new Error('interviewer');
      const payload = await response.json() as { answer?: string };
      setInterviewerAnswer(payload.answer?.trim() || fallback);
    } catch {
      setInterviewerAnswer(fallback);
    } finally {
      const next = updateAssessmentAnswer(session, activeTask.id, { interviewerUses: activeAnswer.interviewerUses + 1 });
      setSession(next);
      setInterviewerLoading(false);
    }
  };

  const requestDebrief = async () => {
    if (!report) return;
    setDebriefLoading(true);
    try {
      const response = await fetch('/api/assessment/debrief', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(report)
      });
      if (!response.ok) throw new Error('debrief');
      const payload = await response.json() as { answer?: string };
      const next = { ...report, aiDebrief: payload.answer?.trim() || report.localDebrief };
      setReport(next);
      setHistory(saveLocalAssessmentReport(next));
      await fetch('/api/assessment/reports', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(next)
      });
    } catch {
      setReport(current => current ? { ...current, aiDebrief: current.localDebrief } : current);
    } finally {
      setDebriefLoading(false);
    }
  };

  const desktopTrigger = <button className={open ? 'active' : ''} onClick={() => setOpen(true)} data-testid="assessment-trigger">
    <ClipboardCheck /><span>Assessment Center</span>
  </button>;
  const mobileTrigger = <button className={open ? 'active' : ''} onClick={() => setOpen(true)} data-testid="assessment-mobile-trigger">
    <span className="mobile-nav-icon"><ClipboardCheck /></span><small>Экзамен</small>
  </button>;

  const landing = <main className="assessment-page" data-testid="assessment-landing">
    <section className="assessment-hero">
      <div>
        <span className="assessment-kicker"><ShieldCheck /> проверка без учебных подсказок</span>
        <h1>Assessment Center</h1>
        <p>Проверь SQL так, как его проверят на интервью или в рабочей диагностике: время ограничено, результат измеряется, отчёт синхронизируется с аккаунтом.</p>
      </div>
      <div className="assessment-readiness"><Gauge /><strong>{readiness}%</strong><span>текущая readiness</span></div>
    </section>

    {loadAssessmentSession() && <section className="assessment-resume-card" data-testid="assessment-resume">
      <div><TimerReset /><span><strong>Есть незавершённая сессия</strong><small>{assessmentModes[loadAssessmentSession()!.mode].title} · осталось {formatTimer(remainingSeconds(loadAssessmentSession()!))}</small></span></div>
      <button onClick={resume}><Play />Продолжить</button>
    </section>}

    <section className="assessment-mode-grid">
      {(Object.keys(assessmentModes) as AssessmentMode[]).map(mode => {
        const modeConfig = assessmentModes[mode];
        const eligibility = assessmentEligibility(mode, progress);
        return <article className={`assessment-mode-card ${mode}`} key={mode} data-testid={`assessment-mode-${mode}`}>
          <div className="assessment-mode-icon">{mode === 'quick' ? <AlarmClock /> : mode === 'interview' ? <BrainCircuit /> : mode === 'diagnostic' ? <Target /> : mode === 'production' ? <ShieldCheck /> : <Trophy />}</div>
          <span className="assessment-duration"><Clock3 />{modeConfig.durationMinutes} минут</span>
          <h2>{modeConfig.title}</h2>
          <p>{modeConfig.description}</p>
          <ul>
            <li><ListChecks />{modeConfig.taskCount} задач</li>
            <li><LockKeyhole />без решения и обычного Mentor</li>
            {modeConfig.interviewer && <li><Sparkles />до 2 уточнений на задачу</li>}
          </ul>
          {eligibility.eligible
            ? <button onClick={() => start(mode)} data-testid={`start-${mode}`}><Play />Начать</button>
            : <div className="assessment-locked"><LockKeyhole /><span>Нужно ещё {eligibility.missingCompleted} задач, {eligibility.missingModules} модулей{eligibility.missingRequiredModules.length ? ' · prerequisites: ' + eligibility.missingRequiredModules.length : ''}</span></div>}
        </article>;
      })}
    </section>

    <section className="assessment-history-card">
      <div className="assessment-section-heading"><div><span>История</span><h2>Skill reports</h2></div><button onClick={() => void refreshHistory()} disabled={historyLoading} aria-label="Обновить историю assessment"><RefreshCw className={historyLoading ? 'spin' : ''} /></button></div>
      {!history.length && <div className="assessment-empty"><History /><p>Завершённые проверки появятся здесь и на других устройствах после входа.</p></div>}
      <div className="assessment-history-list">
        {history.map(item => <button key={item.id} onClick={() => setReport(item)}>
          <span className={`assessment-score-badge grade-${item.grade}`}>{item.score}</span>
          <span><strong>{assessmentModes[item.mode].title}</strong><small>{new Date(item.completedAt).toLocaleString('ru-RU')} · {item.accuracy}% точность{item.formId ? ` · ${item.formId}` : ''}</small></span>
          <ChevronRight />
        </button>)}
      </div>
    </section>
    {syncMessage && <div className="assessment-notice" role="status" aria-live="polite">{syncMessage}</div>}
  </main>;

  const sessionView = session && activeTask && activeAnswer && config ? <main className="assessment-session" data-testid="assessment-session">
    <header className="assessment-session-header">
      <div><span className="assessment-mode-pill">{config.shortTitle}</span><strong>{session.currentIndex + 1}/{session.taskIds.length}</strong></div>
      <div className={`assessment-timer ${secondsLeft <= 300 ? 'urgent' : ''}`} role="timer" aria-label={`Осталось ${formatTimer(secondsLeft)}`} data-testid="assessment-timer"><Clock3 />{formatTimer(secondsLeft)}</div>
      <button className="assessment-finish" onClick={() => void complete(session, 'completed')}>Завершить досрочно</button>
    </header>

    <div className="assessment-progress-strip">{session.taskIds.map((taskId, index) => {
      const answer = session.answers[taskId];
      return <button key={taskId} className={`${index === session.currentIndex ? 'active' : ''} ${answer.correct ? 'correct' : answer.skipped ? 'skipped' : ''}`} onClick={() => setSession(goToAssessmentTask(session, index))} aria-label={`Задача ${index + 1}`}><span>{index + 1}</span></button>;
    })}</div>

    <section className="assessment-workspace">
      <article className="assessment-task-panel">
        <div className="assessment-task-meta"><span>{activeTask.topic}</span><span>{activeTask.difficulty}</span><span>попыток {activeAnswer.attempts}</span>{activeAnswer.technicalErrors > 0 && <span>technical {activeAnswer.technicalErrors}</span>}</div>
        <h1>{activeTask.title}</h1>
        <p>{activeTask.description}</p>
        <div className="assessment-integrity-note" data-testid="assessment-locked-tools"><LockKeyhole /><span><strong>Assessment integrity</strong><small>Подсказки, эталон и обычный AI Mentor недоступны до завершения.</small></span></div>
        {config.interviewer && <div className="assessment-interviewer" data-testid="assessment-interviewer">
          <div><BrainCircuit /><span><strong>AI Interviewer</strong><small>Осталось уточнений: {Math.max(0, 2 - activeAnswer.interviewerUses)}</small></span></div>
          <textarea aria-label="Уточняющий вопрос AI Interviewer" value={interviewerQuestion} onChange={event => setInterviewerQuestion(event.target.value)} placeholder="Задай уточняющий вопрос о требованиях…" maxLength={600} />
          <button onClick={() => void askInterviewer()} disabled={interviewerLoading || activeAnswer.interviewerUses >= 2 || !interviewerQuestion.trim()}><Sparkles />{interviewerLoading ? 'Формулирую уточнение…' : 'Спросить'}</button>
          <p>{interviewerAnswer}</p>
        </div>}
      </article>

      <article className="assessment-editor-panel">
        {engineError ? <div className="assessment-error" role="alert"><AlertTriangle />{engineError}</div> : <Suspense fallback={<div className="assessment-loading">Загрузка Monaco Editor…</div>}>
          <Editor
            height="390px"
            language="sql"
            theme={document.documentElement.dataset.theme === 'light' ? 'light' : 'vs-dark'}
            value={editorSql}
            onChange={value => setEditorSql(value || '')}
            options={{ minimap: { enabled: false }, fontSize: 15, lineHeight: 23, padding: { top: 18 }, automaticLayout: true, wordWrap: 'on', scrollBeyondLastLine: false, tabSize: 2 }}
          />
        </Suspense>}
        <div className="assessment-runbar">
          <button className="assessment-run" onClick={runSql} disabled={!engine}><Play />Проверить SQL</button>
          <button onClick={skip}><SkipForward />Пропустить</button>
          <button onClick={nextTask} disabled={!activeAnswer.correct && !activeAnswer.skipped}>{session.currentIndex >= session.taskIds.length - 1 ? 'Завершить' : 'Следующая'}<ChevronRight /></button>
        </div>
        <div className={`assessment-feedback ${runState}`} role="status" aria-live="polite">{runState === 'success' ? <CheckCircle2 /> : runState === 'error' ? <AlertTriangle /> : <Target />}<span>{message}</span></div>
        {!!result.length && <div className="assessment-result-table" data-testid="assessment-result">
          {result.map((block, blockIndex) => <div className="result-table-wrap" key={blockIndex}><table><thead><tr>{block.columns.map(column => <th key={column}>{column}</th>)}</tr></thead><tbody>{block.values.map((row, rowIndex) => <tr key={rowIndex}>{row.map((value, columnIndex) => <td key={columnIndex}>{value === null ? 'NULL' : String(value)}</td>)}</tr>)}</tbody></table></div>)}
        </div>}
      </article>
    </section>
  </main> : null;

  const reportView = report ? <main className="assessment-report" data-testid="assessment-report">
    <section className="assessment-report-hero">
      <button className="assessment-back" onClick={() => setReport(null)}><ArrowLeft />К Assessment Center</button>
      <div className={`assessment-report-score grade-${report.grade}`}><strong>{report.score}</strong><span>/100</span></div>
      <div><span>{assessmentModes[report.mode].title}{report.formId ? ` · ${report.formId}` : ''}</span><h1>{gradeLabel(report)}</h1><p>{report.status === 'expired' ? 'Время истекло. Незавершённые задачи учтены как пропущенные.' : 'Skill report рассчитан по точности, времени, попыткам и самостоятельности.'}</p></div>
    </section>
    <section className="assessment-report-metrics">
      <article><CheckCircle2 /><span><small>Точность</small><strong>{report.accuracy}%</strong></span></article>
      <article><Target /><span><small>С первой попытки</small><strong>{report.firstAttemptRate}%</strong></span></article>
      <article><ShieldCheck /><span><small>Самостоятельность</small><strong>{report.independence}%</strong></span></article>
      <article><Clock3 /><span><small>Время</small><strong>{formatDuration(report.durationSeconds)}</strong></span></article>
      <article><Gauge /><span><small>Readiness delta</small><strong>{report.readinessDelta >= 0 ? '+' : ''}{report.readinessDelta}</strong></span></article>
    </section>
    <section className="assessment-report-grid">
      <article className="assessment-report-card">
        <div className="assessment-section-heading"><div><span>Компетенции</span><h2>Результат по модулям</h2></div><Trophy /></div>
        <div className="assessment-module-bars">{report.moduleScores.map(module => <div key={module.module}><span><strong>{module.title}</strong><small>{module.correct}/{module.total}</small></span><div><i style={{ width: `${module.score}%` }} /></div><b>{module.score}</b></div>)}</div>
      </article>
      <article className="assessment-report-card assessment-debrief-card">
        <div className="assessment-section-heading"><div><span>Debrief</span><h2>Что делать дальше</h2></div><BrainCircuit /></div>
        <pre>{report.aiDebrief || report.localDebrief}</pre>
        <button onClick={() => void requestDebrief()} disabled={debriefLoading}><Sparkles />{debriefLoading ? 'Анализирую…' : report.aiDebrief ? 'Обновить AI Debrief' : 'Получить AI Debrief'}</button>
        {syncMessage && <small>{syncMessage}</small>}
      </article>
    </section>
    <section className="assessment-task-breakdown assessment-report-card">
      <div className="assessment-section-heading"><div><span>Задачи</span><h2>Детализация попыток</h2></div><ListChecks /></div>
      {report.taskScores.map((task, index) => <div className="assessment-task-score" key={task.taskId}><span>{String(index + 1).padStart(2, '0')}</span><div><strong>{task.title}</strong><small>{task.topic} · {task.attempts} попыток · {formatDuration(task.elapsedSeconds)}{task.telemetryEligible === false ? ` · excluded: ${task.telemetryExclusionReason}` : ''}</small></div><b className={task.correct ? 'correct' : 'incorrect'}>{task.score}</b></div>)}
    </section>
  </main> : null;

  const shell = open ? <div ref={shellRef} tabIndex={-1} className="assessment-shell" role="dialog" aria-modal="true" aria-labelledby="assessment-dialog-title" data-testid="assessment-center">
    <header className="assessment-topbar">
      <div className="assessment-brand"><div><ClipboardCheck /></div><span><strong>SQL Academy</strong><small id="assessment-dialog-title">Assessment Center</small></span></div>
      <div className="assessment-top-actions"><span><ShieldCheck />{auth?.username}</span>{!session && <button onClick={() => setOpen(false)} aria-label="Закрыть Assessment Center"><X /></button>}</div>
    </header>
    {report ? reportView : session ? sessionView : landing}
  </div> : null;

  return <>
    {!externalLauncher && desktopSlot && createPortal(desktopTrigger, desktopSlot)}
    {!externalLauncher && mobileSlot && createPortal(mobileTrigger, mobileSlot)}
    {shell && createPortal(shell, document.body)}
  </>;
}
