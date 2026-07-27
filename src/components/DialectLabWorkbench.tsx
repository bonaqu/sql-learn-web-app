import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import type { Monaco } from '@monaco-editor/react';
import {
  AlertTriangle,
  CheckCircle2,
  Cloud,
  Code2,
  Database,
  Eye,
  FlaskConical,
  Gauge,
  Laptop,
  LockKeyhole,
  Play,
  RefreshCw,
  Server,
  ShieldCheck,
  TimerReset,
  WifiOff
} from 'lucide-react';
import { dialectLabCase } from '../data/dialect-lab-cases';
import {
  dialectLabManifests,
  type DialectExecutionMode,
  type SqlDialect
} from '../data/dialect-lab-manifests';
import { dialectPatterns, dialects as referenceDialects } from '../data/sql-dialects';
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
import '../dialect-labs.css';

const Editor = lazy(() => import('./SqlEditor'));
const executableDialects: SqlDialect[] = ['sqlite', 'postgresql', 'mysql'];
const DIALECT_DARK_THEME = 'sql-academy-dialect-dark';

function configureDialectEditor(monaco: Monaco) {
  monaco.editor.defineTheme(DIALECT_DARK_THEME, {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'string', foreground: 'FF7B72' },
      { token: 'string.sql', foreground: 'FF7B72' },
      { token: 'string.escape', foreground: 'FF9B93' },
      { token: 'string.quote', foreground: 'FF7B72' }
    ],
    colors: {
      'editor.background': '#1E1E1E'
    }
  });
}

const dialectTitles: Record<SqlDialect, string> = {
  sqlite: 'SQLite',
  postgresql: 'PostgreSQL',
  mysql: 'MySQL'
};

const modeTitles: Record<DialectExecutionMode, string> = {
  'local-sqlite': 'Local WASM',
  'remote-sandbox': 'Server contract',
  'deterministic-simulation': 'Session simulator'
};

function executionIcon(mode: DialectExecutionMode) {
  if (mode === 'local-sqlite') return <Laptop />;
  if (mode === 'remote-sandbox') return <Cloud />;
  return <TimerReset />;
}

function evidenceKey(labId: string, dialect: SqlDialect) {
  return `${labId}:${dialect}`;
}

function resultValue(value: string | number | null) {
  return value === null ? 'NULL' : String(value);
}

function patternForLab(labId: string) {
  const mapping: Record<string, string> = {
    'dialect-date-time-boundaries': 'date-month',
    'dialect-json-extraction': 'json-extract',
    'dialect-upsert-idempotency': 'upsert',
    'dialect-plan-vocabulary': 'explain',
    'dialect-null-ordering': 'null-safe-equality',
    'dialect-isolation-lost-update': 'upsert'
  };
  return dialectPatterns.find(pattern => pattern.id === mapping[labId]) || dialectPatterns[0];
}

export default function DialectLabWorkbench() {
  const auth = loadAuthSession();
  const [labId, setLabId] = useState(dialectLabManifests[0].id);
  const [dialect, setDialect] = useState<SqlDialect>('sqlite');
  const [sql, setSql] = useState(() => dialectLabCase(dialectLabManifests[0].id, 'sqlite')?.starterSql || '');
  const [execution, setExecution] = useState<DialectLabExecution | null>(null);
  const [running, setRunning] = useState(false);
  const [solutionViewed, setSolutionViewed] = useState(false);
  const [syncMessage, setSyncMessage] = useState('');
  const [progress, setProgress] = useState<DialectLabProgress | null>(() => {
    if (!auth) return null;
    return loadDialectLabProgress(auth.userId) || emptyDialectLabProgress(auth.userId);
  });

  const lab = useMemo(() => dialectLabManifests.find(item => item.id === labId) || dialectLabManifests[0], [labId]);
  const behavior = lab.behaviors.find(item => item.dialect === dialect) || lab.behaviors[0];
  const labCase = dialectLabCase(lab.id, dialect);
  const completion = progress ? dialectLabCompletion(progress, lab.id) : { passed: 0, required: 3, complete: false };
  const currentEvidence = progress?.evidence[evidenceKey(lab.id, dialect)];
  const classicPattern = patternForLab(lab.id);

  useEffect(() => {
    if (!auth) return;
    let cancelled = false;
    void hydrateDialectLabProgress(auth.userId)
      .then(value => { if (!cancelled && value) setProgress(value); })
      .catch(() => { if (!cancelled) setSyncMessage('Cloud evidence недоступен: локальный прогресс сохранён.'); });
    return () => { cancelled = true; };
  }, [auth?.userId]);

  useEffect(() => {
    const nextCase = dialectLabCase(lab.id, dialect);
    setSql(nextCase?.starterSql || '');
    setExecution(null);
    setSolutionViewed(false);
    setSyncMessage('');
  }, [dialect, lab.id]);

  const run = async () => {
    if (!labCase || !progress || running) return;
    setRunning(true);
    setSyncMessage('');
    try {
      const result = behavior.executionMode === 'remote-sandbox'
        ? await executeRemoteDialectLab(lab.id, dialect as Exclude<SqlDialect, 'sqlite'>, sql)
        : await executeLocalDialectLab(lab.id, dialect, sql);
      setExecution(result);
      const next = saveDialectLabProgress(recordDialectLabExecution(progress, result, !solutionViewed));
      setProgress(next);
      setSyncMessage(result.offlinePreview
        ? 'CI reference preview не засчитан: Cloudflare Free не запускает server engine; реальные PostgreSQL/MySQL контракты проверяются в Docker CI.'
        : result.passed && solutionViewed
          ? 'Результат верный, но reference был открыт: evidence отмечен как guided.'
          : result.passed
            ? 'Independent engine evidence подтверждён. Синхронизирую…'
            : 'Попытка сохранена. Исправь contract и запусти снова.');
      try {
        const synced = await syncDialectLabProgress(next);
        setProgress(synced);
        if (result.passed && !solutionViewed && !result.offlinePreview) {
          setSyncMessage('Independent evidence синхронизирован между устройствами.');
        }
      } catch {
        setSyncMessage(current => `${current} Cloud sync повторится при следующем открытии.`.trim());
      }
    } finally {
      setRunning(false);
    }
  };

  const revealReference = () => {
    if (!labCase) return;
    setSolutionViewed(true);
    setSql(labCase.referenceSql);
    setExecution(null);
  };

  return <div className="dialect-executable-shell" data-testid="dialect-executable-lab">
    <aside className="dialect-lab-list" aria-label="Executable dialect labs">
      <header><FlaskConical /><div><strong>Executable Dialect Lab</strong><small>manifest v1 · {dialectLabManifests.length} labs</small></div></header>
      {dialectLabManifests.map(item => {
        const state = progress ? dialectLabCompletion(progress, item.id) : { passed: 0, required: 3, complete: false };
        return <button key={item.id} className={item.id === lab.id ? 'active' : ''} onClick={() => setLabId(item.id)}>
          <span>{state.complete ? <CheckCircle2 /> : <Database />}</span>
          <div><strong>{item.title}</strong><small>{state.passed}/{state.required} engines · {item.capability}</small></div>
        </button>;
      })}
    </aside>

    <main className="dialect-executable-workspace">
      <header className="dialect-executable-hero">
        <div><small>Production portability evidence</small><h1>{lab.title}</h1><p>{lab.objective}</p></div>
        <div className={completion.complete ? 'complete' : ''}><Gauge /><strong>{completion.passed}/{completion.required}</strong><span>{completion.complete ? 'lab complete' : 'engine evidence'}</span></div>
      </header>

      <section className="dialect-failure-mode"><AlertTriangle /><div><strong>Production failure mode</strong><p>{lab.productionFailureMode}</p></div></section>

      <section className="dialect-free-boundary" role="note">
        <Cloud />
        <div>
          <strong>Cloudflare Free boundary</strong>
          <p>SQLite выполняется локально. PostgreSQL и MySQL показывают CI-verified reference contract, но не создают mastery без настоящего server engine.</p>
        </div>
      </section>

      <section className="dialect-engine-tabs" aria-label="Executable SQL engines">
        {executableDialects.map(engine => {
          const engineBehavior = lab.behaviors.find(item => item.dialect === engine)!;
          const evidence = progress?.evidence[evidenceKey(lab.id, engine)];
          return <button key={engine} className={engine === dialect ? 'active' : ''} onClick={() => setDialect(engine)} aria-pressed={engine === dialect}>
            {executionIcon(engineBehavior.executionMode)}
            <span><strong>{dialectTitles[engine]}</strong><small>{modeTitles[engineBehavior.executionMode]}</small></span>
            {evidence?.passed && evidence.independent ? <CheckCircle2 className="passed" /> : <LockKeyhole />}
          </button>;
        })}
      </section>

      <section className="dialect-engine-contract">
        <div>{executionIcon(behavior.executionMode)}<span><strong>{dialectTitles[dialect]} · {modeTitles[behavior.executionMode]}</strong><small>{behavior.expectedSummary}</small></span></div>
        <ul>{behavior.semanticInvariants.map(invariant => <li key={invariant}><ShieldCheck />{invariant}</li>)}</ul>
        {behavior.unsupportedOfflineReason && <p><WifiOff />{behavior.unsupportedOfflineReason}</p>}
      </section>

      <section className="dialect-editor-grid">
        <article className="dialect-editor-card">
          <header><Code2 /><div><strong>SQL submission</strong><small>{lab.statementPolicy.maximumStatements} statements · {lab.statementPolicy.timeoutMs} ms · {lab.statementPolicy.maximumRows} rows</small></div></header>
          <Suspense fallback={<div className="dialect-editor-loading">Загрузка SQL editor…</div>}>
            <Editor
              beforeMount={configureDialectEditor}
              height="330px"
              language="sql"
              theme={document.documentElement.dataset.theme === 'light' ? 'light' : DIALECT_DARK_THEME}
              value={sql}
              onChange={value => setSql(value || '')}
              options={{ minimap: { enabled: false }, fontSize: 14, lineHeight: 22, automaticLayout: true, wordWrap: 'on', scrollBeyondLastLine: false, tabSize: 2 }}
            />
          </Suspense>
          <div className="dialect-editor-actions">
            <button className="primary" onClick={() => void run()} disabled={running || !sql.trim()} data-testid="run-dialect-lab"><Play />{running ? 'Проверяю…' : behavior.executionMode === 'remote-sandbox' ? 'Проверить server contract' : behavior.executionMode === 'local-sqlite' ? 'Выполнить SQLite' : 'Проиграть сессии'}</button>
            <button onClick={() => { setSql(labCase?.starterSql || ''); setExecution(null); setSolutionViewed(false); }}><RefreshCw />Сбросить</button>
            <button onClick={revealReference} disabled={(currentEvidence?.attempts || 0) < 2}><Eye />Reference после 2 попыток</button>
          </div>
          <p className="dialect-independence-note"><ShieldCheck />Reference view делает следующую успешную попытку guided. Только independent engine evidence завершает lab.</p>
        </article>

        <article className={`dialect-evidence-card ${execution?.passed ? 'passed' : execution ? 'failed' : ''}`} data-testid="dialect-evidence-card">
          <header>{execution?.passed ? <CheckCircle2 /> : execution ? <AlertTriangle /> : <FlaskConical />}<div><strong>{execution ? execution.passed ? 'Contract подтверждён' : execution.offlinePreview ? 'CI reference preview' : 'Нужна коррекция' : 'Execution evidence'}</strong><small>{execution ? `${execution.durationMs} ms · ${execution.executionMode}` : 'Запусти SQL, чтобы получить evidence'}</small></div></header>
          {!execution && <div className="dialect-empty-evidence"><Database /><p>Результат, normalized plan или concurrent timeline появятся здесь. SQL не отправляется в progress storage.</p></div>}
          {execution && <>
            <p>{execution.summary}</p>
            {!!execution.errors.length && <ul className="dialect-errors">{execution.errors.map(error => <li key={error}>{error}</li>)}</ul>}
            {execution.output && <div className="dialect-result-table"><table><thead><tr>{execution.output.columns.map(column => <th key={column}>{column}</th>)}</tr></thead><tbody>{execution.output.rows.slice(0, 40).map((row, index) => <tr key={index}>{row.map((value, cell) => <td key={cell}>{resultValue(value)}</td>)}</tr>)}</tbody></table>{execution.output.rows.length > 40 && <small>Показаны первые 40 из {execution.output.rows.length} строк.</small>}</div>}
            {!!execution.normalizedPlan.length && <div className="dialect-plan"><strong>Normalized plan</strong>{execution.normalizedPlan.map(item => <span key={item}>{item}</span>)}</div>}
            {!!execution.timeline.length && <ol className="dialect-timeline">{execution.timeline.map(item => <li key={item}>{item}</li>)}</ol>}
            <footer><span>digest {execution.resultDigest}</span><span>{execution.evidenceEligible ? 'evidence eligible' : 'not evidence eligible'}</span></footer>
          </>}
        </article>
      </section>

      <section className="dialect-portability-contract">
        <div><ShieldCheck /><span><strong>Portability challenge</strong><p>{lab.portabilityChallenge.prompt}</p></span></div>
        <ul>{lab.portabilityChallenge.equivalenceInvariants.map(item => <li key={item}><CheckCircle2 />{item}</li>)}</ul>
      </section>

      <details className="dialect-reference-matrix">
        <summary><Server />Reference-only syntax matrix, включая SQL Server</summary>
        <p>{classicPattern.portableGuidance}</p>
        <div>{referenceDialects.map(item => <article key={item.id}><header><strong>{item.title}</strong><small>{item.role}</small></header><pre><code>{classicPattern.examples[item.id]}</code></pre>{classicPattern.notes[item.id] && <p>{classicPattern.notes[item.id]}</p>}</article>)}</div>
      </details>

      {syncMessage && <div className="dialect-sync-message" role="status" aria-live="polite">{syncMessage}</div>}
    </main>
  </div>;
}
