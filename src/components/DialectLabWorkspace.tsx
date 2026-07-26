import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Cloud,
  Code2,
  Database,
  Eye,
  Gauge,
  Languages,
  LoaderCircle,
  LockKeyhole,
  Play,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Target,
  WifiOff
} from 'lucide-react';
import { dialectLabCase } from '../data/dialect-lab-cases';
import {
  dialectLabManifests,
  type DialectExecutionMode,
  type SqlDialect
} from '../data/dialect-lab-manifests';
import { loadAuthSession } from '../lib/auth';
import {
  dialectLabCompletion,
  emptyDialectLabProgress,
  hydrateDialectLabProgress,
  loadDialectLabProgress,
  recordDialectLabExecution,
  saveDialectLabProgress,
  syncDialectLabProgress,
  type DialectLabProgress
} from '../lib/dialect-lab-progress';
import {
  executeLocalDialectLab,
  executeRemoteDialectLab,
  type DialectLabExecution
} from '../lib/dialect-lab-runtime';
import '../dialect-lab.css';

const dialects: Array<{ id: SqlDialect; title: string; short: string }> = [
  { id: 'sqlite', title: 'SQLite', short: 'SQ' },
  { id: 'postgresql', title: 'PostgreSQL', short: 'PG' },
  { id: 'mysql', title: 'MySQL', short: 'MY' }
];

function modeLabel(mode: DialectExecutionMode) {
  if (mode === 'local-sqlite') return 'Локальный SQLite WASM';
  if (mode === 'deterministic-simulation') return 'Детерминированная simulation';
  return 'Manifest-constrained remote sandbox';
}

function formatDuration(milliseconds: number | null) {
  if (!milliseconds) return '—';
  return milliseconds < 1000 ? `${milliseconds} мс` : `${(milliseconds / 1000).toFixed(1)} с`;
}

export default function DialectLabWorkspace() {
  const auth = loadAuthSession();
  const [labId, setLabId] = useState(dialectLabManifests[0].id);
  const [dialect, setDialect] = useState<SqlDialect>('sqlite');
  const [progress, setProgress] = useState<DialectLabProgress | null>(() => auth
    ? loadDialectLabProgress(auth.userId) || emptyDialectLabProgress(auth.userId)
    : null);
  const [sql, setSql] = useState(() => dialectLabCase(dialectLabManifests[0].id, 'sqlite')?.starterSql || '');
  const [execution, setExecution] = useState<DialectLabExecution | null>(null);
  const [running, setRunning] = useState(false);
  const [referenceVisible, setReferenceVisible] = useState(false);
  const [online, setOnline] = useState(() => navigator.onLine);
  const [syncStatus, setSyncStatus] = useState('Evidence сохраняется локально; cloud sync выполняется после попытки.');

  const manifest = useMemo(() => dialectLabManifests.find(item => item.id === labId) || dialectLabManifests[0], [labId]);
  const labCase = useMemo(() => dialectLabCase(manifest.id, dialect), [dialect, manifest.id]);
  const behavior = manifest.behaviors.find(item => item.dialect === dialect) || manifest.behaviors[0];
  const evidence = progress?.evidence[`${manifest.id}:${dialect}`] || null;
  const completion = progress ? dialectLabCompletion(progress, manifest.id) : { passed: 0, required: 3, complete: false };
  const completedLabs = progress
    ? dialectLabManifests.filter(item => dialectLabCompletion(progress, item.id).complete).length
    : 0;

  useEffect(() => {
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  useEffect(() => {
    if (!auth || !navigator.onLine) return;
    let cancelled = false;
    void hydrateDialectLabProgress(auth.userId)
      .then(next => {
        if (!cancelled && next) {
          setProgress(next);
          setSyncStatus('Dialect evidence синхронизирован с аккаунтом.');
        }
      })
      .catch(() => {
        if (!cancelled) setSyncStatus('Cloud sync недоступен: продолжаю с локальным evidence.');
      });
    return () => { cancelled = true; };
  }, [auth?.userId]);

  useEffect(() => {
    setSql(labCase?.starterSql || '');
    setExecution(null);
    setReferenceVisible(false);
  }, [labCase?.labId, labCase?.dialect]);

  const resetAttempt = () => {
    setSql(labCase?.starterSql || '');
    setExecution(null);
    setReferenceVisible(false);
    setSyncStatus('Новая independent attempt готова.');
  };

  const run = async () => {
    if (!labCase || !progress) return;
    setRunning(true);
    setExecution(null);
    setSyncStatus('Проверяю policy, semantic markers и result contract…');
    try {
      const result = behavior.executionMode === 'deterministic-simulation' || dialect === 'sqlite'
        ? await executeLocalDialectLab(manifest.id, dialect, sql)
        : await executeRemoteDialectLab(manifest.id, dialect as Exclude<SqlDialect, 'sqlite'>, sql);
      setExecution(result);
      const independent = !referenceVisible;
      const local = saveDialectLabProgress(recordDialectLabExecution(progress, result, independent));
      setProgress(local);
      if (navigator.onLine) {
        try {
          const synced = await syncDialectLabProgress(local);
          setProgress(synced);
          setSyncStatus(result.offlinePreview
            ? 'Сохранена попытка без engine evidence; completion не начислен.'
            : 'Attempt и evidence синхронизированы.');
        } catch {
          setSyncStatus('Attempt сохранён локально; cloud sync повторится позже.');
        }
      } else {
        setSyncStatus(result.evidenceEligible
          ? 'SQLite/simulation evidence сохранён локально; cloud sync ждёт сеть.'
          : 'Offline preview не создаёт mastery evidence.');
      }
    } catch (error) {
      setSyncStatus(`Execution не завершён: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setRunning(false);
    }
  };

  return <div className="dialect-executable-lab" data-testid="dialect-lab">
    <aside className="dialect-lab-list" aria-label="Executable dialect labs">
      <header><Languages /><div><strong>Executable Dialect Lab</strong><small>{completedLabs}/{dialectLabManifests.length} labs complete</small></div></header>
      {dialectLabManifests.map(item => {
        const state = progress ? dialectLabCompletion(progress, item.id) : { passed: 0, required: 3, complete: false };
        return <button
          key={item.id}
          className={`${item.id === manifest.id ? 'active' : ''} ${state.complete ? 'complete' : ''}`}
          onClick={() => setLabId(item.id)}
          data-testid={`dialect-lab-${item.id}`}
        >
          <span>{state.complete ? <CheckCircle2 /> : <Database />}</span>
          <div><strong>{item.title}</strong><small>{state.passed}/{state.required} engine evidence</small></div>
        </button>;
      })}
    </aside>

    <main className="dialect-lab-workspace">
      <header className="dialect-lab-hero">
        <div><small>{manifest.kind} · manifest v{manifest.version}</small><h1>{manifest.title}</h1><p>{manifest.objective}</p></div>
        <div className={`dialect-lab-score ${completion.complete ? 'complete' : ''}`}><Gauge /><strong>{completion.passed}/{completion.required}</strong><span>engines passed</span></div>
      </header>

      <section className="dialect-production-risk"><AlertTriangle /><div><strong>Production failure mode</strong><p>{manifest.productionFailureMode}</p></div></section>

      <div className="dialect-engine-tabs" role="tablist" aria-label="SQL dialect">
        {dialects.map(item => <button
          key={item.id}
          role="tab"
          aria-selected={dialect === item.id}
          className={dialect === item.id ? 'active' : ''}
          onClick={() => setDialect(item.id)}
          data-testid={`dialect-engine-${item.id}`}
        ><span>{item.short}</span><strong>{item.title}</strong>{progress?.evidence[`${manifest.id}:${item.id}`]?.independent ? <CheckCircle2 /> : null}</button>)}
      </div>

      <section className="dialect-engine-contract">
        <article><ShieldCheck /><div><small>Execution</small><strong>{modeLabel(behavior.executionMode)}</strong><p>{behavior.expectedSummary}</p></div></article>
        <article><Target /><div><small>Portability challenge</small><strong>Semantic equivalence</strong><p>{manifest.portabilityChallenge.prompt}</p></div></article>
        <article>{online ? <Cloud /> : <WifiOff />}<div><small>Connectivity</small><strong>{online ? 'Remote evidence доступен' : 'SQLite-only fallback'}</strong><p>{!online && behavior.executionMode === 'remote-sandbox' ? 'Проверка покажет preview, но не выдаст engine evidence.' : labCase?.runtimeNote}</p></div></article>
      </section>

      <section className="dialect-code-panel">
        <header><div><Code2 /><span><strong>{dialect.toUpperCase()} submission</strong><small>{referenceVisible ? 'guided attempt' : 'independent attempt'}</small></span></div><span><LockKeyhole /> allowlist · {manifest.statementPolicy.timeoutMs} ms · {manifest.statementPolicy.maximumRows} rows</span></header>
        <textarea
          value={sql}
          onChange={event => setSql(event.target.value)}
          spellCheck={false}
          aria-label={`SQL для ${dialect}`}
          data-testid="dialect-sql-editor"
        />
        <div className="dialect-code-actions">
          <button className="primary" onClick={() => void run()} disabled={running || !sql.trim()} data-testid="run-dialect-lab">{running ? <LoaderCircle className="spin" /> : <Play />}{running ? 'Выполняю…' : 'Проверить contract'}</button>
          <button onClick={resetAttempt}><RotateCcw />Новая попытка</button>
          <button onClick={() => setReferenceVisible(value => !value)}><Eye />{referenceVisible ? 'Скрыть reference' : 'Показать reference'}</button>
        </div>
        {referenceVisible && <pre className="dialect-reference" data-testid="dialect-reference"><code>{labCase?.referenceSql}</code></pre>}
      </section>

      {execution && <section className={`dialect-execution-result ${execution.passed ? 'passed' : 'failed'}`} data-testid="dialect-execution-result">
        <header>{execution.passed ? <CheckCircle2 /> : <AlertTriangle />}<div><strong>{execution.passed ? 'Semantic contract подтверждён' : 'Нужна доработка'}</strong><small>{modeLabel(execution.executionMode)} · {formatDuration(execution.durationMs)} · {execution.resultDigest}</small></div></header>
        <p>{execution.summary}</p>
        {!!execution.errors.length && <ul>{execution.errors.map(error => <li key={error}>{error}</li>)}</ul>}
        {execution.output && <div className="dialect-result-table"><table><thead><tr>{execution.output.columns.map(column => <th key={column}>{column}</th>)}</tr></thead><tbody>{execution.output.rows.map((row, index) => <tr key={index}>{row.map((cell, cellIndex) => <td key={cellIndex}>{cell === null ? 'NULL' : String(cell)}</td>)}</tr>)}</tbody></table></div>}
        {!!execution.normalizedPlan.length && <div className="dialect-plan-evidence"><strong>Normalized plan</strong>{execution.normalizedPlan.map(item => <span key={item}>{item}</span>)}</div>}
        {!!execution.timeline.length && <ol className="dialect-timeline">{execution.timeline.map(item => <li key={item}>{item}</li>)}</ol>}
        {execution.offlinePreview && <div className="dialect-preview-warning"><WifiOff />Preview не считается engine evidence.</div>}
      </section>}

      <section className="dialect-evidence-card" data-testid="dialect-evidence-card">
        <div><RefreshCw /><span><strong>Evidence state</strong><small>{syncStatus}</small></span></div>
        <dl>
          <div><dt>Attempts</dt><dd>{evidence?.attempts || 0}</dd></div>
          <div><dt>Independent</dt><dd>{evidence?.independent ? 'yes' : 'no'}</dd></div>
          <div><dt>Best time</dt><dd>{formatDuration(evidence?.bestDurationMs || null)}</dd></div>
          <div><dt>Completed</dt><dd>{evidence?.completedAt ? new Date(evidence.completedAt).toLocaleDateString('ru-RU') : '—'}</dd></div>
        </dl>
      </section>
    </main>
  </div>;
}
