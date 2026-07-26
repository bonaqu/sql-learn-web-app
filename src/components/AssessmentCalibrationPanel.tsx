import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { BarChart3, FlaskConical, Gauge, ShieldCheck } from 'lucide-react';
import {
  ASSESSMENT_CALIBRATION_CHANGED_EVENT,
  loadAssessmentCalibration,
  syncAssessmentCalibration,
  type AssessmentCalibrationSnapshot
} from '../lib/assessment-calibration';
import {
  ASSESSMENT_REPORTS_CHANGED_EVENT,
  loadLocalAssessmentReports,
  saveLocalAssessmentReport,
  type AssessmentReport
} from '../lib/assessment';
import '../assessment-calibration.css';

function measuredReports() {
  return loadLocalAssessmentReports().filter(report => report.measurement);
}

function visibleMeasuredReport(reportHero?: HTMLElement | null) {
  const reports = measuredReports();
  const visibleText = reportHero?.textContent || '';
  return reports.find(report => report.formId && visibleText.includes(report.formId)) || reports[0] || null;
}

function setStartButtonsReady(ready: boolean) {
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-testid^="start-"]')) {
    button.disabled = !ready;
    button.dataset.evidenceReady = ready ? 'true' : 'false';
    if (!ready) button.setAttribute('aria-label', `${button.textContent?.trim() || 'Начать'} — синхронизация evidence`);
    else button.removeAttribute('aria-label');
  }
}

export default function AssessmentCalibrationPanel() {
  const [landingSlot, setLandingSlot] = useState<HTMLElement | null>(null);
  const [reportSlot, setReportSlot] = useState<HTMLElement | null>(null);
  const [snapshot, setSnapshot] = useState<AssessmentCalibrationSnapshot>(loadAssessmentCalibration);
  const [report, setReport] = useState<AssessmentReport | null>(() => visibleMeasuredReport());
  const [syncState, setSyncState] = useState<'syncing' | 'synced' | 'local'>('syncing');
  const mounted = useRef<HTMLElement[]>([]);
  const evidenceReady = useRef(false);

  useEffect(() => {
    let cancelled = false;
    evidenceReady.current = false;
    setStartButtonsReady(false);
    const hydrate = async () => {
      try {
        const [nextCalibration, reportsResponse] = await Promise.all([
          syncAssessmentCalibration(),
          fetch('/api/assessment/reports')
        ]);
        if (!reportsResponse.ok) throw new Error('Assessment report history is unavailable');
        const payload = await reportsResponse.json() as { reports?: AssessmentReport[] };
        for (const remote of [...(payload.reports || [])].reverse()) saveLocalAssessmentReport(remote);
        if (cancelled) return;
        setSnapshot(nextCalibration);
        setReport(visibleMeasuredReport(document.querySelector<HTMLElement>('.assessment-report .assessment-report-hero')));
        setSyncState('synced');
      } catch {
        if (cancelled) return;
        setSnapshot(loadAssessmentCalibration());
        setReport(visibleMeasuredReport(document.querySelector<HTMLElement>('.assessment-report .assessment-report-hero')));
        setSyncState('local');
      } finally {
        if (!cancelled) {
          evidenceReady.current = true;
          setStartButtonsReady(true);
        }
      }
    };
    void hydrate();
    return () => {
      cancelled = true;
      evidenceReady.current = true;
      setStartButtonsReady(true);
    };
  }, []);

  useEffect(() => {
    const mount = () => {
      const landing = document.querySelector<HTMLElement>('.assessment-page .assessment-hero');
      if (landing && !document.querySelector('[data-assessment-calibration-slot="landing"]')) {
        const slot = document.createElement('div');
        slot.dataset.assessmentCalibrationSlot = 'landing';
        landing.insertAdjacentElement('afterend', slot);
        mounted.current.push(slot);
        setLandingSlot(slot);
      }
      const reportHero = document.querySelector<HTMLElement>('.assessment-report .assessment-report-hero');
      if (reportHero && !document.querySelector('[data-assessment-calibration-slot="report"]')) {
        const slot = document.createElement('div');
        slot.dataset.assessmentCalibrationSlot = 'report';
        reportHero.insertAdjacentElement('afterend', slot);
        mounted.current.push(slot);
        setReportSlot(slot);
      }
      if (reportHero) setReport(visibleMeasuredReport(reportHero));
      if (!landing) setLandingSlot(null);
      if (!reportHero) setReportSlot(null);
      setStartButtonsReady(evidenceReady.current);
    };
    mount();
    const observer = new MutationObserver(mount);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    return () => {
      observer.disconnect();
      for (const slot of mounted.current) slot.remove();
      mounted.current = [];
    };
  }, []);

  useEffect(() => {
    const onCalibration = (event: Event) => {
      const detail = (event as CustomEvent<AssessmentCalibrationSnapshot>).detail;
      setSnapshot(detail || loadAssessmentCalibration());
    };
    const onReports = () => setReport(visibleMeasuredReport(document.querySelector<HTMLElement>('.assessment-report .assessment-report-hero')));
    window.addEventListener(ASSESSMENT_CALIBRATION_CHANGED_EVENT, onCalibration);
    window.addEventListener(ASSESSMENT_REPORTS_CHANGED_EVENT, onReports);
    return () => {
      window.removeEventListener(ASSESSMENT_CALIBRATION_CHANGED_EVENT, onCalibration);
      window.removeEventListener(ASSESSMENT_REPORTS_CHANGED_EVENT, onReports);
    };
  }, []);

  const summary = useMemo(() => {
    const items = Object.values(snapshot.items);
    return {
      observed: items.length,
      calibrated: items.filter(item => item.evidence === 'calibrated').length,
      emerging: items.filter(item => item.evidence === 'emerging').length,
      flagged: items.filter(item => item.flags.length > 0).length
    };
  }, [snapshot]);

  const landing = landingSlot ? createPortal(
    <section className="assessment-calibration-summary" data-testid="assessment-calibration-summary">
      <div><FlaskConical /><span><small>Measurement contract</small><strong>Blueprint v2 · adaptive parallel forms</strong></span></div>
      <div className="assessment-calibration-metrics">
        <span><b>{summary.calibrated}</b><small>calibrated items</small></span>
        <span><b>{summary.emerging}</b><small>emerging evidence</small></span>
        <span><b>{summary.flagged}</b><small>quality review flags</small></span>
      </div>
      <p>{syncState === 'syncing'
        ? 'Синхронизирую reports и anonymous item aggregates перед выбором формы…'
        : syncState === 'synced'
          ? `Cross-device evidence готов: ${summary.observed} items имеют aggregate evidence.`
          : 'Облачное evidence недоступно. Форма безопасно использует локальную историю и authored difficulty без выдуманной точности.'}</p>
    </section>,
    landingSlot
  ) : null;

  const measurement = report?.measurement;
  const reportPanel = reportSlot && measurement ? createPortal(
    <section className={`assessment-measurement-panel ${measurement.reliability}`} data-testid="assessment-measurement-panel">
      <header><div><BarChart3 /><span><small>{measurement.formId}</small><strong>Как читать этот результат</strong></span></div><b>{measurement.scoreBand.low}–{measurement.scoreBand.high}</b></header>
      <div>
        <article><Gauge /><span><small>Наблюдаемый score</small><strong>{report.score}/100</strong></span></article>
        <article><ShieldCheck /><span><small>90% interval точности</small><strong>{measurement.accuracyInterval.low}–{measurement.accuracyInterval.high}%</strong></span></article>
        <article><FlaskConical /><span><small>Надёжность evidence</small><strong>{measurement.reliability}</strong></span></article>
      </div>
      <p>Диапазон отражает неопределённость короткой формы, а не обещание следующего результата. В измерение вошло {measurement.eligibleItems} items; исключено {measurement.excludedItems}; calibrated evidence есть у {measurement.calibratedItems}.</p>
    </section>,
    reportSlot
  ) : null;

  return <>{landing}{reportPanel}</>;
}
