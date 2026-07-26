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
  type AssessmentReport
} from '../lib/assessment';
import '../assessment-calibration.css';

function latestMeasuredReport() {
  return loadLocalAssessmentReports().find(report => report.measurement) || null;
}

export default function AssessmentCalibrationPanel() {
  const [landingSlot, setLandingSlot] = useState<HTMLElement | null>(null);
  const [reportSlot, setReportSlot] = useState<HTMLElement | null>(null);
  const [snapshot, setSnapshot] = useState<AssessmentCalibrationSnapshot>(loadAssessmentCalibration);
  const [report, setReport] = useState<AssessmentReport | null>(latestMeasuredReport);
  const [syncState, setSyncState] = useState<'syncing' | 'synced' | 'local'>('syncing');
  const mounted = useRef<HTMLElement[]>([]);

  useEffect(() => {
    let cancelled = false;
    void syncAssessmentCalibration()
      .then(next => {
        if (cancelled) return;
        setSnapshot(next);
        setSyncState('synced');
      })
      .catch(() => {
        if (cancelled) return;
        setSnapshot(loadAssessmentCalibration());
        setSyncState('local');
      });
    return () => { cancelled = true; };
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
        setReport(latestMeasuredReport());
        setReportSlot(slot);
      }
      if (!landing) setLandingSlot(null);
      if (!reportHero) setReportSlot(null);
    };
    mount();
    const observer = new MutationObserver(mount);
    observer.observe(document.body, { childList: true, subtree: true });
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
    const onReports = () => setReport(latestMeasuredReport());
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
        ? 'Синхронизирую anonymous item aggregates…'
        : syncState === 'synced'
          ? `Cross-device snapshot получен: ${summary.observed} items имеют aggregate evidence.`
          : 'Облачная calibration недоступна. Форма безопасно использует authored difficulty без выдуманной точности.'}</p>
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
