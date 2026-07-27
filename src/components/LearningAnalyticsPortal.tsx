import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  Cloud,
  Download,
  EyeOff,
  RefreshCw,
  ShieldCheck,
  Trash2,
  X
} from 'lucide-react';
import { modules } from '../data/course-catalog';
import { useDialogFocus } from '../lib/dialog-focus';
import {
  deleteCloudLearningAnalytics,
  deleteLocalLearningAnalytics,
  exportCloudLearningAnalytics,
  exportLocalLearningAnalytics,
  loadCohortAnalyticsReport,
  loadLearningAnalyticsState,
  localLearningAnalyticsReport,
  saveLearningAnalyticsState,
  setLearningAnalyticsSharing,
  syncLearningAnalyticsSnapshot,
  type CohortAnalyticsReport,
  type LearningAnalyticsSharing,
  type LearningAnalyticsState
} from '../lib/learning-analytics';
import { loadProgress } from '../lib/progress';

import '../learning-analytics.css';

function moduleTitle(moduleId: string) {
  return modules.find(([id]) => id === moduleId)?.[1] || moduleId;
}

function downloadJson(name: string, content: string) {
  const blob = new Blob([content], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

async function updateCloudPreference(sharing: LearningAnalyticsSharing) {
  const response = await fetch('/api/learning-analytics/preferences', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sharing })
  });
  const payload = await response.json().catch(() => ({ error: `HTTP ${response.status}` })) as { error?: string };
  if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
}

function emptyState(): LearningAnalyticsState {
  return {
    version: 1,
    userId: '',
    sharing: 'off',
    events: [],
    experimentVariants: {},
    updatedAt: new Date().toISOString()
  };
}

export default function LearningAnalyticsPortal({ openRequest = 0 }: { openRequest?: number }) {
  const [open, setOpen] = useState(Boolean(openRequest));
  const [state, setState] = useState<LearningAnalyticsState>(() => loadLearningAnalyticsState() || emptyState());
  const [cohort, setCohort] = useState<CohortAnalyticsReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const shellRef = useRef<HTMLDivElement>(null);
  const progress = useMemo(() => loadProgress(), [openRequest, open, state.updatedAt]);
  const report = useMemo(() => localLearningAnalyticsReport(state, progress), [state, progress]);

  useDialogFocus(open, shellRef, () => setOpen(false));

  useEffect(() => {
    if (openRequest <= 0) return;
    setState(loadLearningAnalyticsState() || emptyState());
    setOpen(true);
    setMessage('');
    setConfirmDelete(false);
  }, [openRequest]);

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, [open]);

  const refresh = () => {
    setState(loadLearningAnalyticsState() || emptyState());
    setMessage('Локальный отчёт обновлён.');
  };

  const changeSharing = async (sharing: LearningAnalyticsSharing) => {
    if (!state.userId) return;
    setBusy(true);
    setMessage('');
    try {
      const next = setLearningAnalyticsSharing(sharing, state.userId);
      if (next) setState(next);
      await updateCloudPreference(sharing);
      if (sharing === 'off') {
        setCohort(null);
        setMessage('Отправка агрегатов выключена. Серверные snapshots удалены.');
      } else {
        setMessage('Opt-in включён. На сервер уйдут только coarse counters без SQL и task IDs.');
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Не удалось изменить настройку sharing.');
    } finally {
      setBusy(false);
    }
  };

  const sync = async () => {
    setBusy(true);
    setMessage('');
    try {
      await syncLearningAnalyticsSnapshot(progress, state.userId);
      const next = await loadCohortAnalyticsReport();
      setCohort(next);
      setMessage('Coarse snapshot синхронизирован. Малые cohorts остаются скрыты.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Синхронизация аналитики недоступна.');
    } finally {
      setBusy(false);
    }
  };

  const loadCohort = async () => {
    setBusy(true);
    setMessage('');
    try {
      setCohort(await loadCohortAnalyticsReport());
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Course-health report недоступен.');
    } finally {
      setBusy(false);
    }
  };

  const exportAll = async () => {
    setBusy(true);
    setMessage('');
    try {
      const cloud = state.sharing === 'coarse-opt-in'
        ? await exportCloudLearningAnalytics()
        : { version: 1, sharing: 'off', snapshots: [] };
      downloadJson('sql-academy-learning-analytics.json', JSON.stringify({
        version: 1,
        exportedAt: new Date().toISOString(),
        local: JSON.parse(exportLocalLearningAnalytics(state)),
        cloud
      }, null, 2));
      setMessage('Экспорт подготовлен. Он не содержит learner SQL.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Не удалось экспортировать аналитику.');
    } finally {
      setBusy(false);
    }
  };

  const removeAll = async () => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      setMessage('Нажми удаление ещё раз, чтобы стереть local events и cloud snapshots.');
      return;
    }
    setBusy(true);
    try {
      await deleteCloudLearningAnalytics().catch(() => ({ ok: false }));
      deleteLocalLearningAnalytics(state.userId);
      const next = loadLearningAnalyticsState(state.userId) || { ...emptyState(), userId: state.userId };
      saveLearningAnalyticsState(next);
      setState(next);
      setCohort(null);
      setConfirmDelete(false);
      setMessage('Learning analytics удалена локально и на сервере.');
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;

  return createPortal(<div className="learning-analytics-backdrop" role="presentation">
    <section
      ref={shellRef}
      className="learning-analytics-shell"
      role="dialog"
      aria-modal="true"
      aria-labelledby="learning-analytics-title"
      data-testid="learning-analytics-portal"
    >
      <header>
        <div>
          <span className="learning-analytics-kicker"><BarChart3 /> Privacy-first evidence</span>
          <h2 id="learning-analytics-title">Моя аналитика обучения</h2>
          <p>Полный журнал остаётся в этом браузере. Серверные aggregates — только после явного opt-in.</p>
        </div>
        <button type="button" className="icon" onClick={() => setOpen(false)} aria-label="Закрыть аналитику"><X /></button>
      </header>

      <div className="learning-analytics-privacy" role="note">
        <ShieldCheck />
        <div><strong>Не собирается:</strong> SQL, текст задач, логин, имя, работодатель, email и session token.</div>
      </div>

      <div className="learning-analytics-actions">
        <button type="button" onClick={refresh} disabled={busy}><RefreshCw /> Обновить</button>
        <button type="button" onClick={exportAll} disabled={busy}><Download /> Экспорт</button>
        <button type="button" className={confirmDelete ? 'danger armed' : 'danger'} onClick={removeAll} disabled={busy}><Trash2 /> {confirmDelete ? 'Подтвердить удаление' : 'Удалить данные'}</button>
      </div>

      <div className="learning-analytics-funnel" aria-label="Funnel освоения">
        {Object.entries(report.funnel).map(([key, value]) => <div key={key}>
          <strong>{value}</strong><span>{key}</span>
        </div>)}
      </div>

      <div className="learning-analytics-grid">
        <article>
          <h3>Локальный evidence</h3>
          <dl>
            <div><dt>Сессии</dt><dd>{report.sessions}</dd></div>
            <div><dt>Попытки</dt><dd>{report.attempts}</dd></div>
            <div><dt>Independent</dt><dd>{report.independentPasses}</dd></div>
            <div><dt>Retained</dt><dd>{report.retainedPasses}</dd></div>
            <div><dt>Lapses</dt><dd>{report.lapses}</dd></div>
            <div><dt>Remediation success</dt><dd>{report.remediationSuccesses}/{report.remediationStarts}</dd></div>
          </dl>
        </article>

        <article>
          <h3>Intervention rules</h3>
          {!report.interventions.length && <p className="learning-analytics-empty"><CheckCircle2 /> Критичных сигналов нет.</p>}
          <div className="learning-interventions">
            {report.interventions.map(item => <div key={`${item.id}:${item.moduleId || ''}`} className={`learning-intervention ${item.severity}`}>
              <AlertTriangle />
              <div><strong>{item.title}</strong><p>{item.reason}</p><small>{item.action}{item.moduleId ? ` · ${moduleTitle(item.moduleId)}` : ''}</small></div>
            </div>)}
          </div>
        </article>
      </div>

      <article className="learning-analytics-sharing">
        <div>
          <h3>Обезличенные course aggregates</h3>
          <p>Минимальный cohort: 5 contributors. Малые slices не возвращаются вообще.</p>
        </div>
        <div className="learning-sharing-choice" role="group" aria-label="Настройка отправки аналитики">
          <button type="button" className={state.sharing === 'off' ? 'active' : ''} onClick={() => changeSharing('off')} disabled={busy}><EyeOff /> Выключено</button>
          <button type="button" className={state.sharing === 'coarse-opt-in' ? 'active' : ''} onClick={() => changeSharing('coarse-opt-in')} disabled={busy}><Cloud /> Coarse opt-in</button>
        </div>
        {state.sharing === 'coarse-opt-in' && <div className="learning-cloud-actions">
          <button type="button" onClick={sync} disabled={busy}><Cloud /> Синхронизировать snapshot</button>
          <button type="button" onClick={loadCohort} disabled={busy}>Обновить course health</button>
        </div>}
      </article>

      {cohort && <article className="learning-cohort" data-testid="learning-cohort-report">
        <h3>Course health</h3>
        <p>{cohort.rows.length
          ? `${cohort.rows.length} агрегированных строк · suppressed ${cohort.suppressedRows}`
          : `Недостаточно contributors. Suppressed slices: ${cohort.suppressedRows}.`}</p>
        {cohort.rows.slice(0, 8).map(row => <div key={`${row.periodStart}:${row.moduleId}`}>
          <strong>{moduleTitle(row.moduleId)}</strong>
          <span>{row.contributors} contributors · {row.independent}/{row.attempted} independent</span>
        </div>)}
      </article>}

      {message && <p className="learning-analytics-message" role="status">{message}</p>}
    </section>
  </div>, document.body);
}
