import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Code2,
  Download,
  Eye,
  FileCode2,
  FileText,
  LoaderCircle,
  LockKeyhole,
  Play,
  Printer,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Target,
  X
} from 'lucide-react';
import { capstoneContract } from '../data/capstone-contracts';
import { capstoneProjects } from '../data/complete-curriculum';
import { capstoneWorkspaceTemplate } from '../data/capstone-workspace-templates';
import { loadAuthSession } from '../lib/auth';
import {
  bestCapstoneReport,
  evaluateCapstone,
  type CapstoneReport
} from '../lib/capstone-evaluator';
import {
  CAPSTONE_REPORTS_CHANGED_EVENT,
  loadLocalCapstoneReports,
  saveLocalCapstoneReport,
  syncCapstoneReports,
  uploadCapstoneReport
} from '../lib/capstone-reports';
import {
  downloadCapstoneMarkdown,
  downloadCapstoneSql,
  printCapstonePortfolio
} from '../lib/capstone-portfolio';
import { loadCapstoneSqlRuntime } from '../lib/capstone-sql-runtime';
import {
  completeProject,
  loadCurriculumProgress,
  projectDraftFor,
  updateProjectDraft,
  type CurriculumProgressV1
} from '../lib/curriculum-progress';
import { useDialogFocus } from '../lib/dialog-focus';
import '../capstone-evaluator.css';

export type CapstonePortalProps = {
  projectId: string;
  openRequest: number;
};

function projectTitle(projectId: string) {
  return capstoneProjects.find(project => project.id === projectId)?.title || projectId;
}

function fileSolution(projectId: string, fileId: string) {
  const file = capstoneContract(projectId)?.files.find(item => item.id === fileId);
  if (!file) return '';
  if (file.kind === 'schema') return file.starterSql;
  return file.referenceSql || file.starterSql;
}

function statusLabel(report: CapstoneReport | null) {
  if (!report) return 'Нет проверенной попытки';
  if (report.passed) return `Passed · ${report.score}%`;
  return `Нужна доработка · ${report.score}%`;
}

export default function CapstonePortal({ projectId, openRequest }: CapstonePortalProps) {
  const [open, setOpen] = useState(false);
  const [activeProjectId, setActiveProjectId] = useState(projectId);
  const [progress, setProgress] = useState<CurriculumProgressV1>(() => loadCurriculumProgress());
  const [activeFileId, setActiveFileId] = useState('');
  const [reports, setReports] = useState<CapstoneReport[]>(() => loadLocalCapstoneReports());
  const [latestReport, setLatestReport] = useState<CapstoneReport | null>(null);
  const [evaluating, setEvaluating] = useState(false);
  const [status, setStatus] = useState('Draft сохраняется локально; report будет синхронизирован с аккаунтом.');
  const shellRef = useRef<HTMLDivElement>(null);
  const previousOverflow = useRef('');
  const handledOpenRequest = useRef(0);

  const contract = capstoneContract(activeProjectId);
  const project = capstoneProjects.find(item => item.id === activeProjectId) || capstoneProjects[0];
  const draft = projectDraftFor(progress, activeProjectId);
  const projectReports = useMemo(
    () => reports.filter(report => report.projectId === activeProjectId),
    [activeProjectId, reports]
  );
  const bestReport = useMemo(
    () => bestCapstoneReport(activeProjectId, reports),
    [activeProjectId, reports]
  );
  const activeFile = contract?.files.find(file => file.id === activeFileId) || contract?.files[0] || null;

  useEffect(() => {
    if (openRequest <= 0 || handledOpenRequest.current === openRequest) return;
    handledOpenRequest.current = openRequest;
    const nextProjectId = capstoneContract(projectId) ? projectId : 'project-incident-command';
    const freshProgress = loadCurriculumProgress();
    const freshReports = loadLocalCapstoneReports();
    const nextContract = capstoneContract(nextProjectId);
    setActiveProjectId(nextProjectId);
    setProgress(freshProgress);
    setReports(freshReports);
    setLatestReport(freshReports.find(report => report.projectId === nextProjectId) || null);
    setActiveFileId(nextContract?.files[0]?.id || '');
    setStatus('Draft сохраняется локально; report будет синхронизирован с аккаунтом.');
    setOpen(true);
    if (navigator.onLine) {
      void syncCapstoneReports()
        .then(synced => {
          setReports(synced);
          setLatestReport(synced.find(report => report.projectId === nextProjectId) || null);
          setStatus('История попыток синхронизирована.');
        })
        .catch(reason => setStatus(`Cloud sync недоступен: ${reason instanceof Error ? reason.message : String(reason)}`));
    }
  }, [openRequest, projectId]);

  useDialogFocus(open, shellRef, () => setOpen(false));

  useEffect(() => {
    if (!open) return;
    previousOverflow.current = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const updateReports = (event: Event) => {
      const detail = (event as CustomEvent<CapstoneReport[]>).detail;
      const next = Array.isArray(detail) ? detail : loadLocalCapstoneReports();
      setReports(next);
      setLatestReport(next.find(report => report.projectId === activeProjectId) || null);
    };
    window.addEventListener(CAPSTONE_REPORTS_CHANGED_EVENT, updateReports);
    return () => {
      document.body.style.overflow = previousOverflow.current;
      window.removeEventListener(CAPSTONE_REPORTS_CHANGED_EVENT, updateReports);
    };
  }, [activeProjectId, open]);

  if (!open || !contract || !project) return null;

  const persistPatch = (patch: Parameters<typeof updateProjectDraft>[2]) => {
    setProgress(current => updateProjectDraft(current, activeProjectId, patch));
  };

  const updateFile = (fileId: string, sql: string) => {
    const files = { ...draft.files, [fileId]: sql };
    const firstFileId = contract.files[0]?.id;
    persistPatch({ files, sql: firstFileId ? files[firstFileId] || '' : '' });
  };

  const resetTemplate = () => {
    if (!activeFile) return;
    updateFile(activeFile.id, capstoneWorkspaceTemplate(activeFile.id, ''));
    persistPatch({ guidanceUses: draft.guidanceUses + 1 });
    setStatus('Шаблон восстановлен. Это отмечено как guidance use.');
  };

  const revealSolution = () => {
    if (!activeFile) return;
    const solution = fileSolution(activeProjectId, activeFile.id);
    if (!solution) return;
    updateFile(activeFile.id, solution);
    persistPatch({ solutionViews: draft.solutionViews + 1 });
    setStatus('Эталон помещён в файл. Следующая попытка будет solution-assisted.');
  };

  const submit = async () => {
    const auth = loadAuthSession();
    if (!auth) {
      setStatus('Для immutable report нужен вход в аккаунт.');
      return;
    }
    setEvaluating(true);
    setStatus('SQLite проверяет public contract и hidden datasets…');
    try {
      const SQL = await loadCapstoneSqlRuntime();
      const previous = loadLocalCapstoneReports(auth.userId).filter(report => report.projectId === activeProjectId);
      const report = await evaluateCapstone({
        SQL,
        userId: auth.userId,
        attemptNumber: previous.length + 1,
        bestScore: Math.max(0, ...previous.map(item => item.bestScore || item.score)),
        submission: {
          projectId: activeProjectId,
          files: draft.files,
          reflection: draft.notes,
          startedAt: draft.startedAt,
          guidanceUses: draft.guidanceUses,
          solutionViews: draft.solutionViews
        }
      });
      const nextReports = saveLocalCapstoneReport(report);
      setReports(nextReports);
      setLatestReport(report);
      if (report.passed) setProgress(current => completeProject(current, activeProjectId));
      try {
        if (navigator.onLine) await uploadCapstoneReport(report);
        setStatus(report.passed
          ? 'Capstone passed. Immutable report сохранён локально и в D1.'
          : 'Попытка сохранена. Исправь failed invariants и отправь новую попытку.');
      } catch (reason) {
        setStatus(`Report сохранён локально; cloud upload продолжится позже: ${reason instanceof Error ? reason.message : String(reason)}`);
      }
    } catch (reason) {
      setStatus(`Evaluator error: ${reason instanceof Error ? reason.message : String(reason)}`);
    } finally {
      setEvaluating(false);
    }
  };

  const shell = <div ref={shellRef} className="capstone-shell" role="dialog" aria-modal="true" aria-labelledby="capstone-title" data-testid="capstone-evaluator">
    <header className="capstone-topbar">
      <div><span><ShieldCheck /></span><div><small>Executable capstone</small><strong id="capstone-title">{project.title}</strong></div></div>
      <div className={bestReport ? 'capstone-best passed' : 'capstone-best'}>
        {bestReport ? <CheckCircle2 /> : <LockKeyhole />}
        <span><strong>{bestReport ? `${bestReport.score}%` : 'Not verified'}</strong><small>{bestReport ? `${bestReport.provenance} · independence ${bestReport.independence}%` : 'Passed report required'}</small></span>
      </div>
      <button onClick={() => setOpen(false)} aria-label="Закрыть executable capstone"><X /></button>
    </header>

    <div className="capstone-layout">
      <aside className="capstone-files" aria-label="SQL artifacts">
        <div><Sparkles /><span><strong>Submission bundle</strong><small>{contract.files.length} SQL artifacts</small></span></div>
        {contract.files.map(file => {
          const evidence = latestReport?.files.find(item => item.fileId === file.id);
          return <button key={file.id} className={file.id === activeFile?.id ? 'active' : ''} onClick={() => setActiveFileId(file.id)}>
            <span>{evidence?.passed ? <CheckCircle2 /> : <FileCode2 />}</span>
            <div><strong>{file.title}</strong><small>{file.kind} · {file.weight}%{evidence ? ` · ${evidence.score}/${evidence.maxScore}` : ''}</small></div>
            <ChevronRight />
          </button>;
        })}
        <div className="capstone-provenance">
          <strong>Provenance</strong>
          <span>Guidance: {draft.guidanceUses}</span>
          <span>Solution views: {draft.solutionViews}</span>
          <small>Эталон снижает independence и остаётся в cross-device draft.</small>
        </div>
      </aside>

      <main className="capstone-workspace">
        <section className="capstone-brief">
          <div><small>Scenario</small><h1>{project.summary}</h1><p>{project.scenario}</p></div>
          <span className={latestReport?.passed ? 'passed' : ''}>{latestReport?.passed ? <CheckCircle2 /> : <Target />}{statusLabel(latestReport)}</span>
        </section>

        <section className="capstone-engine-evidence" data-testid="capstone-engine-evidence">
          <div><ShieldCheck /><span><strong>Dataset provenance</strong><small>{contract.originality}</small></span></div>
          <p><b>Engine evidence:</b> {contract.engineEvidence}</p>
          <p><b>SQLite limitation:</b> {contract.sqliteLimitations}</p>
          <div>{contract.datasets.map(dataset => <span key={dataset.id}>{dataset.hidden ? 'Hidden' : 'Public'} · {dataset.edgeCases.join(' · ')}</span>)}</div>
        </section>

        {activeFile && <section className="capstone-editor-card">
          <header><div><Code2 /><span><small>{activeFile.kind} artifact</small><h2>{activeFile.title}</h2></span></div><strong>{activeFile.weight}%</strong></header>
          <p>{activeFile.description}</p>
          {!!activeFile.requiredColumns?.length && <div className="capstone-contract"><strong>Result contract</strong>{activeFile.requiredColumns.map(column => <code key={column}>{column}</code>)}</div>}
          <textarea
            data-testid="capstone-sql-editor"
            aria-label={`SQL artifact ${activeFile.title}`}
            spellCheck={false}
            value={draft.files[activeFile.id] || ''}
            onChange={event => updateFile(activeFile.id, event.target.value)}
          />
          <div className="capstone-editor-actions">
            <button onClick={resetTemplate}><RefreshCw />Сбросить к шаблону</button>
            <button onClick={revealSolution} className="danger"><Eye />Показать эталон</button>
          </div>
        </section>}

        <section className="capstone-reflection">
          <header><FileText /><div><small>Weighted reflection · {contract.reflection.weight}%</small><h2>{contract.reflection.title}</h2></div></header>
          <p>{contract.reflection.prompt}</p>
          <textarea
            data-testid="capstone-reflection"
            value={draft.notes}
            onChange={event => persistPatch({ notes: event.target.value })}
            placeholder={`Минимум ${contract.reflection.minimumCharacters} символов. Объясни ограничения, проверки и безопасное использование результата.`}
          />
          <small>{draft.notes.trim().length}/{contract.reflection.minimumCharacters} минимум</small>
        </section>

        <section className="capstone-submit">
          <div><strong>Deterministic evaluator</strong><small>Public contract + hidden edge cases + stable order + schema/final-state/plan invariants + reflection.</small></div>
          <button data-testid="submit-capstone" onClick={() => void submit()} disabled={evaluating}>
            {evaluating ? <LoaderCircle className="spin" /> : <Play />}{evaluating ? 'Проверяю…' : 'Отправить immutable attempt'}
          </button>
        </section>
        <p className="capstone-status" role="status" aria-live="polite">{status}</p>

        {latestReport && <section className={latestReport.passed ? 'capstone-report passed' : 'capstone-report failed'} data-testid="capstone-report">
          <header>
            <div>{latestReport.passed ? <CheckCircle2 /> : <AlertTriangle />}<span><small>Attempt {latestReport.attemptNumber} · {latestReport.provenance}</small><h2>{latestReport.passed ? 'Capstone passed' : 'Remediation report'}</h2></span></div>
            <strong>{latestReport.score}%</strong>
          </header>
          <div className="capstone-report-grid">
            <span><b>{latestReport.independence}%</b><small>independence</small></span>
            <span><b>{latestReport.files.filter(file => file.passed).length}/{latestReport.files.length}</b><small>artifacts passed</small></span>
            <span><b>{latestReport.checks.filter(check => check.passed).length}/{latestReport.checks.length}</b><small>invariants passed</small></span>
          </div>
          <div className="capstone-checks">{latestReport.checks.map(check => <article key={check.id} className={check.passed ? 'passed' : 'failed'}>
            {check.passed ? <CheckCircle2 /> : <Target />}
            <div><strong>{check.title}</strong><p>{check.message}</p>{check.remediation && <small>{check.remediation}</small>}</div>
            <b>{Math.round(check.score)}/{Math.round(check.maxScore)}</b>
          </article>)}</div>
        </section>}

        {bestReport && <section className="capstone-portfolio" data-testid="capstone-portfolio">
          <header><Download /><div><small>Reviewer-friendly artifact</small><h2>Verified SQL portfolio</h2></div></header>
          <p>Экспорт строится из immutable submission snapshot. Account ID не включается; email, телефоны, token/password/API-key patterns автоматически редактируются. Метка independent/guided/solution-assisted сохраняется.</p>
          <div>
            <button onClick={() => downloadCapstoneMarkdown(bestReport, projectTitle(activeProjectId))}><Download />Markdown</button>
            <button onClick={() => downloadCapstoneSql(bestReport, projectTitle(activeProjectId))}><FileCode2 />SQL bundle</button>
            <button onClick={() => printCapstonePortfolio(bestReport, projectTitle(activeProjectId))}><Printer />Печать / PDF</button>
          </div>
        </section>}

        {!!projectReports.length && <section className="capstone-history">
          <h2>Immutable attempt history</h2>
          {projectReports.map(report => <article key={report.id}><span className={report.passed ? 'passed' : ''}>{report.passed ? <CheckCircle2 /> : <Target />}</span><div><strong>Attempt {report.attemptNumber} · {report.score}%</strong><small>{new Date(report.completedAt).toLocaleString('ru-RU')} · {report.provenance}</small></div><b>{report.passed ? 'PASSED' : 'FAILED'}</b></article>)}
        </section>}
      </main>
    </div>
  </div>;

  return createPortal(shell, document.body);
}
