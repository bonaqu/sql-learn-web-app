import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import initSqlJs from 'sql.js';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ChevronRight,
  Clock3,
  FlagTriangleRight,
  Gauge,
  History,
  ListChecks,
  LockKeyhole,
  Play,
  RefreshCw,
  ShieldCheck,
  SkipForward,
  Target,
  TimerReset,
  Trophy,
  X
} from 'lucide-react';
import { curriculumCheckpoints } from '../data/complete-curriculum';
import {
  advanceCheckpoint,
  CheckpointReport,
  CheckpointSession,
  checkpointDurationMinutes,
  checkpointEligibility,
  createCheckpointSession,
  currentCheckpointTask,
  finishCheckpointSession,
  goToCheckpointTask,
  loadCheckpointSession,
  loadLocalCheckpointReports,
  mergeCheckpointReports,
  remainingCheckpointSeconds,
  saveLocalCheckpointReport,
  updateCheckpointAnswer
} from '../lib/checkpoints';
import { AssessmentSqlEngine, AssessmentSqlTable, evaluateAssessmentSql } from '../lib/assessment-runtime';
import { loadAuthSession } from '../lib/auth';
import { useDialogFocus } from '../lib/dialog-focus';
import { loadProgress } from '../lib/progress';
import { CHECKPOINT_REQUEST_KEY } from './CheckpointLauncher';

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

function checkpointTitle(checkpointId: string) {
  return curriculumCheckpoints.find(item => item.id === checkpointId)?.title || checkpointId;
}

export default function CheckpointCenterPortal({ openRequest = 0 }: { openRequest?: number }) {
  const auth = loadAuthSession();
  const [session, setSession] = useState<CheckpointSession | null>(() => loadCheckpointSession());
  const [open, setOpen] = useState(() => Boolean(openRequest) || Boolean(loadCheckpointSession()));
  const [requestedCheckpointId, setRequestedCheckpointId] = useState(() => sessionStorage.getItem(CHECKPOINT_REQUEST_KEY) || '');
  const [report, setReport] = useState<CheckpointReport | null>(null);
  const [history, setHistory] = useState<CheckpointReport[]>(() => loadLocalCheckpointReports());
  const [historyLoading, setHistoryLoading] = useState(false);
  const [syncMessage, setSyncMessage] = useState('');
  const [engine, setEngine] = useState<AssessmentSqlEngine | null>(null);
  const [engineError, setEngineError] = useState('');
  const [secondsLeft, setSecondsLeft] = useState(() => session ? remainingCheckpointSeconds(session) : 0);
  const [editorSql, setEditorSql] = useState(() => {
    const activeTask = session ? currentCheckpointTask(session) : null;
    return activeTask && session ? session.answers[activeTask.id]?.sql || activeTask.starter : '';
  });
  const [result, setResult] = useState<AssessmentSqlTable[]>([]);
  const [runState, setRunState] = useState<RunState>('idle');
  const [message, setMessage] = useState('Выполни запрос. Результат сравнивается с canonical solution локально в SQLite.');
  const shellRef = useRef<HTMLDivElement>(null);
  const elapsedTicks = useRef(0);
  const persistTimer = useRef<number | null>(null);
  const progress = useMemo(() => loadProgress(), [open, session?.id, report?.id]);
  const activeTask = useMemo(() => session ? currentCheckpointTask(session) : null, [session]);
  const activeAnswer = activeTask && session ? session.answers[activeTask.id] : null;

  const close = useCallback(() => {
    if (!session) setOpen(false);
  }, [session]);

  useDialogFocus(open, shellRef, close, !session);

  useEffect(() => {
    if (openRequest <= 0) return;
    const requested = sessionStorage.getItem(CHECKPOINT_REQUEST_KEY) || '';
    if (requested) {
      setRequestedCheckpointId(requested);
      sessionStorage.removeItem(CHECKPOINT_REQUEST_KEY);
    }
    setOpen(true);
  }, [openRequest]);

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, [open]);

  useEffect(() => {
    if (!open || !session || engine || engineError) return;
    initSqlJs({ locateFile: file => `https://sql.js.org/dist/${file}` })
      .then(setEngine)
      .catch(() => setEngineError('Не удалось загрузить SQLite WASM. Проверь соединение и открой Checkpoint Center снова.'));
  }, [engine, engineError, open, session]);

  useEffect(() => {
    if (!session || !activeTask) return;
    setEditorSql(session.answers[activeTask.id]?.sql || activeTask.starter);
    setResult([]);
    setRunState('idle');
    setMessage('Integrity mode: подсказки, решение и AI Mentor отключены до завершения checkpoint.');
  }, [activeTask?.id, session?.id, session?.currentIndex]);

  const refreshHistory = useCallback(async () => {
    if (!auth) return;
    setHistoryLoading(true);
    try {
      const response = await fetch('/api/checkpoints/reports');
      if (!response.ok) throw new Error('history');
      const payload = await response.json() as { reports?: CheckpointReport[] };
      const merged = mergeCheckpointReports(loadLocalCheckpointReports(auth.userId), payload.reports || []);
      for (const item of merged) saveLocalCheckpointReport(item);
      setHistory(merged);
      setSyncMessage('История checkpoints синхронизирована.');
    } catch {
      setHistory(loadLocalCheckpointReports(auth.userId));
      setSyncMessage('Показана локальная история. Облачная синхронизация сейчас недоступна.');
    } finally {
      setHistoryLoading(false);
    }
  }, [auth?.userId]);

  useEffect(() => {
    if (open && !session) void refreshHistory();
  }, [open, refreshHistory, session]);

  const complete = useCallback(async (
    source: CheckpointSession,
    status: 'completed' | 'expired' | 'abandoned'
  ) => {
    const completedReport = finishCheckpointSession(source, status);
    setSession(null);
    setReport(completedReport);
    setHistory(loadLocalCheckpointReports(completedReport.userId));
    setResult([]);
    setRunState('idle');
    setSyncMessage('Сохраняю checkpoint report…');
    try {
      const response = await fetch('/api/checkpoints/reports', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(completedReport)
      });
      if (!response.ok) throw new Error('sync');
      setSyncMessage('Checkpoint report синхронизирован с аккаунтом.');
    } catch {
      setSyncMessage('Отчёт сохранён локально. Облачная синхронизация повторится при следующем открытии.');
    }
  }, []);

  useEffect(() => {
    if (!session) return;
    setSecondsLeft(remainingCheckpointSeconds(session));
    const timer = window.setInterval(() => {
      const left = remainingCheckpointSeconds(session);
      setSecondsLeft(left);
      elapsedTicks.current += 1;
      if (elapsedTicks.current >= 5 && activeTask) {
        elapsedTicks.current = 0;
        const next = updateCheckpointAnswer(session, activeTask.id, {
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
      setSession(updateCheckpointAnswer(session, activeTask.id, { sql: editorSql }));
    }, 350);
    return () => {
      if (persistTimer.current) window.clearTimeout(persistTimer.current);
    };
  }, [editorSql]);

  const start = (checkpointId: string) => {
    try {
      const next = createCheckpointSession(checkpointId, progress, history);
      setSession(next);
      setReport(null);
      setSecondsLeft(remainingCheckpointSeconds(next));
      setEngineError('');
      setSyncMessage('');
      setOpen(true);
    } catch (reason) {
      setSyncMessage(reason instanceof Error ? reason.message : 'Checkpoint пока недоступен.');
    }
  };

  const resume = () => {
    const stored = loadCheckpointSession();
    if (!stored) return;
    setSession(stored);
    setReport(null);
    setSecondsLeft(remainingCheckpointSeconds(stored));
    setOpen(true);
  };

  const runSql = () => {
    if (!engine || !session || !activeTask || !activeAnswer) return;
    const attempts = activeAnswer.attempts + 1;
    try {
      const evaluation = evaluateAssessmentSql(engine, editorSql, activeTask.solution);
      const next = updateCheckpointAnswer(session, activeTask.id, {
        sql: editorSql,
        attempts,
        incorrect: activeAnswer.incorrect + (evaluation.correct ? 0 : 1),
        correct: evaluation.correct,
        skipped: false,
        completedAt: evaluation.correct ? new Date().toISOString() : activeAnswer.completedAt
      });
      setSession(next);
      setResult(evaluation.output);
      setRunState(evaluation.correct ? 'success' : 'error');
      setMessage(evaluation.correct
        ? 'Результат совпал. Можно перейти к следующей задаче.'
        : 'Запрос выполнился, но форма или значения результата не совпали. Проверь гранулярность, NULL и порядок.');
    } catch (reason) {
      const next = updateCheckpointAnswer(session, activeTask.id, {
        sql: editorSql,
        attempts,
        incorrect: activeAnswer.incorrect + 1
      });
      setSession(next);
      setResult([]);
      setRunState('error');
      setMessage(`Ошибка SQLite: ${reason instanceof Error ? reason.message : String(reason)}`);
    }
  };

  const skip = () => {
    if (!session || !activeTask) return;
    const updated = updateCheckpointAnswer(session, activeTask.id, {
      sql: editorSql,
      skipped: true,
      completedAt: new Date().toISOString()
    });
    if (updated.currentIndex >= updated.taskIds.length - 1) void complete(updated, 'completed');
    else setSession(advanceCheckpoint(updated));
  };

  const nextTask = () => {
    if (!session) return;
    if (session.currentIndex >= session.taskIds.length - 1) void complete(session, 'completed');
    else setSession(advanceCheckpoint(session));
  };

  if (!open) return null;

  const landing = <main className="assessment-page" data-testid="checkpoint-landing">
    <section className="assessment-hero">
      <div>
        <span className="assessment-kicker"><ShieldCheck /> executable curriculum gates</span>
        <h1>Checkpoint Center</h1>
        <p>Восемь контрольных сессий связывают практику с этапами курса. SQL выполняется локально, а отчёт хранит точность, попытки, время и самостоятельность.</p>
      </div>
      <div className="assessment-readiness"><FlagTriangleRight /><strong>{history.filter(item => item.passed).length}</strong><span>из {curriculumCheckpoints.length} пройдено</span></div>
    </section>

    {loadCheckpointSession() && <section className="assessment-resume-card" data-testid="checkpoint-resume">
      <div><TimerReset /><span><strong>Есть незавершённый checkpoint</strong><small>{checkpointTitle(loadCheckpointSession()!.checkpointId)} · осталось {formatTimer(remainingCheckpointSeconds(loadCheckpointSession()!))}</small></span></div>
      <button type="button" onClick={resume}><Play />Продолжить</button>
    </section>}

    <section className="assessment-mode-grid">
      {curriculumCheckpoints.map((checkpoint, index) => {
        const eligibility = checkpointEligibility(checkpoint.id, progress, history);
        const best = history
          .filter(item => item.checkpointId === checkpoint.id)
          .sort((left, right) => right.bestScore - left.bestScore || right.completedAt.localeCompare(left.completedAt))[0];
        const requested = requestedCheckpointId === checkpoint.id;
        return <article
          className={`assessment-mode-card ${best?.passed ? 'interview' : index >= 4 ? 'exam' : ''}`}
          key={checkpoint.id}
          data-testid={`checkpoint-${checkpoint.id}`}
          aria-current={requested ? 'true' : undefined}
        >
          <div className="assessment-mode-icon">{best?.passed ? <Trophy /> : <FlagTriangleRight />}</div>
          <span className="assessment-duration"><Clock3 />{checkpointDurationMinutes(checkpoint.id)} минут</span>
          <h2>{checkpoint.title}</h2>
          <p>{checkpoint.description}</p>
          <ul>
            <li><ListChecks />{checkpoint.taskIds.length} result-checked задач</li>
            <li><Target />проходной балл {checkpoint.passingScore}%</li>
            <li><Gauge />readiness этапа {eligibility.phaseReadiness}%</li>
            {best && <li><CheckCircle2 />лучший результат {best.bestScore}%</li>}
          </ul>
          {eligibility.eligible
            ? <button type="button" onClick={() => start(checkpoint.id)} data-testid={`start-${checkpoint.id}`}><Play />{best ? 'Повторить' : 'Начать'}</button>
            : <div className="assessment-locked"><LockKeyhole /><span>{eligibility.blockers.join(' · ') || 'Checkpoint пока закрыт'}</span></div>}
        </article>;
      })}
    </section>

    <section className="assessment-history-card">
      <div className="assessment-section-heading">
        <div><span>Evidence history</span><h2>Checkpoint reports</h2></div>
        <button type="button" onClick={() => void refreshHistory()} disabled={historyLoading} aria-label="Обновить историю checkpoints"><RefreshCw className={historyLoading ? 'spin' : ''} /></button>
      </div>
      {!history.length && <div className="assessment-empty"><History /><p>После первой контрольной здесь появится измеримый evidence по модулям.</p></div>}
      <div className="assessment-history-list">
        {history.map(item => <button type="button" key={item.id} onClick={() => setReport(item)}>
          <span className={`assessment-score-badge ${item.passed ? 'grade-strong' : 'grade-developing'}`}>{item.score}</span>
          <span><strong>{checkpointTitle(item.checkpointId)}</strong><small>{new Date(item.completedAt).toLocaleString('ru-RU')} · попытка {item.attemptNumber} · best {item.bestScore}</small></span>
          <ChevronRight />
        </button>)}
      </div>
    </section>
    {syncMessage && <div className="assessment-notice" role="status" aria-live="polite">{syncMessage}</div>}
  </main>;

  const sessionView = session && activeTask && activeAnswer ? <main className="assessment-session" data-testid="checkpoint-session">
    <header className="assessment-session-header">
      <div><span className="assessment-mode-pill">Checkpoint</span><strong>{session.currentIndex + 1}/{session.taskIds.length}</strong></div>
      <div className={`assessment-timer ${secondsLeft <= 300 ? 'urgent' : ''}`} role="timer" aria-label={`Осталось ${formatTimer(secondsLeft)}`}><Clock3 />{formatTimer(secondsLeft)}</div>
      <button type="button" className="assessment-finish" onClick={() => void complete(session, 'completed')}>Завершить досрочно</button>
    </header>

    <div className="assessment-progress-strip">{session.taskIds.map((taskId, index) => {
      const answer = session.answers[taskId];
      return <button
        type="button"
        key={taskId}
        className={`${index === session.currentIndex ? 'active' : ''} ${answer.correct ? 'correct' : answer.skipped ? 'skipped' : ''}`}
        onClick={() => setSession(goToCheckpointTask(session, index))}
        aria-label={`Задача ${index + 1}`}
      ><span>{index + 1}</span></button>;
    })}</div>

    <section className="assessment-workspace">
      <article className="assessment-task-panel">
        <div className="assessment-task-meta"><span>{activeTask.topic}</span><span>{activeTask.difficulty}</span><span>попыток {activeAnswer.attempts}</span></div>
        <h1>{activeTask.title}</h1>
        <p>{activeTask.description}</p>
        <div className="assessment-integrity-note" data-testid="checkpoint-locked-tools"><LockKeyhole /><span><strong>Checkpoint integrity</strong><small>Подсказки, эталонное решение и AI Mentor физически не выводятся до завершения сессии.</small></span></div>
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
          <button type="button" className="assessment-run" onClick={runSql} disabled={!engine}><Play />Проверить SQL</button>
          <button type="button" onClick={skip}><SkipForward />Пропустить</button>
          <button type="button" onClick={nextTask} disabled={!activeAnswer.correct && !activeAnswer.skipped}>{session.currentIndex >= session.taskIds.length - 1 ? 'Завершить' : 'Следующая'}<ChevronRight /></button>
        </div>
        <div className={`assessment-feedback ${runState}`} role="status" aria-live="polite">{runState === 'success' ? <CheckCircle2 /> : runState === 'error' ? <AlertTriangle /> : <Target />}<span>{message}</span></div>
        {!!result.length && <div className="assessment-result-table" data-testid="checkpoint-result">
          {result.map((block, blockIndex) => <div className="result-table-wrap" key={blockIndex}><table><thead><tr>{block.columns.map(column => <th key={column}>{column}</th>)}</tr></thead><tbody>{block.values.map((row, rowIndex) => <tr key={rowIndex}>{row.map((value, columnIndex) => <td key={columnIndex}>{value === null ? 'NULL' : String(value)}</td>)}</tr>)}</tbody></table></div>)}
        </div>}
      </article>
    </section>
  </main> : null;

  const reportView = report ? <main className="assessment-report" data-testid="checkpoint-report">
    <section className="assessment-report-hero">
      <button type="button" className="assessment-back" onClick={() => setReport(null)}><ArrowLeft />К Checkpoint Center</button>
      <div className={`assessment-report-score ${report.passed ? 'grade-strong' : 'grade-developing'}`}><strong>{report.score}</strong><span>/100</span></div>
      <div><span>{checkpointTitle(report.checkpointId)}</span><h1>{report.passed ? 'Checkpoint пройден' : 'Нужно закрепление'}</h1><p>Проходной балл {report.passingScore}%. Лучший результат сохранён отдельно от текущей попытки.</p></div>
    </section>
    <section className="assessment-report-metrics">
      <article><CheckCircle2 /><span><small>Точность</small><strong>{report.accuracy}%</strong></span></article>
      <article><Target /><span><small>С первой попытки</small><strong>{report.firstAttemptRate}%</strong></span></article>
      <article><ShieldCheck /><span><small>Самостоятельность</small><strong>{report.independence}%</strong></span></article>
      <article><Clock3 /><span><small>Время</small><strong>{formatDuration(report.durationSeconds)}</strong></span></article>
      <article><Gauge /><span><small>Лучший балл</small><strong>{report.bestScore}%</strong></span></article>
    </section>
    <section className="assessment-history-card">
      <div className="assessment-section-heading"><div><span>Module evidence</span><h2>Результат по темам</h2></div><Trophy /></div>
      <div className="assessment-module-bars">
        {report.moduleScores.map(item => <div key={item.module}>
          <span><strong>{item.title}</strong><small>{item.correct}/{item.total} задач</small></span>
          <div><i style={{ width: `${item.score}%` }} /></div>
          <strong>{item.score}</strong>
        </div>)}
      </div>
      {!!report.remediationModules.length && <div className="assessment-notice">Повтори модули: {report.remediationModules.join(', ')}.</div>}
    </section>
  </main> : null;

  return createPortal(<div className="assessment-shell" role="dialog" aria-modal="true" aria-label="Checkpoint Center" ref={shellRef}>
    <header className="assessment-topbar">
      <div className="assessment-brand"><div><FlagTriangleRight /></div><span><strong>SQL Academy</strong><small>Checkpoint evidence</small></span></div>
      <div className="assessment-top-actions"><span><ShieldCheck /> integrity mode</span>{!session && <button type="button" onClick={() => setOpen(false)} aria-label="Закрыть Checkpoint Center"><X /></button>}</div>
    </header>
    {sessionView || reportView || landing}
  </div>, document.body);
}
