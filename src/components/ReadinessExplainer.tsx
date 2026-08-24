import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Gauge, Info, ShieldCheck } from 'lucide-react';
import {
  ASSESSMENT_REPORTS_CHANGED_EVENT,
  loadLocalAssessmentReports
} from '../lib/assessment';
import {
  CHECKPOINT_REPORTS_CHANGED_EVENT,
  loadLocalCheckpointReports
} from '../lib/checkpoints';
import {
  CURRICULUM_PROGRESS_CHANGED_EVENT,
  loadCurriculumProgress
} from '../lib/curriculum-progress';
import { loadProgress, PROGRESS_CHANGED_EVENT } from '../lib/progress';
import {
  READINESS_POLICY,
  type ReadinessEvidenceKind,
  type ReadinessEvidenceSource
} from '../lib/readiness-policy';
import { buildSkillEvidenceGraph } from '../lib/skill-evidence';
import '../readiness-explainer.css';

const CAPSTONE_REPORTS_CHANGED_EVENT = 'sql-academy-capstone-reports-changed';

const evidenceLabels: Record<ReadinessEvidenceKind, string> = {
  lesson: 'Уроки',
  practice: 'Практика',
  checkpoint: 'Контроль',
  assessment: 'Итоговая проверка',
  project: 'Проект'
};

const sourceLabels: Record<ReadinessEvidenceSource, string> = {
  'lesson-progress': 'завершённые уроки',
  'task-progress': 'самостоятельные задачи',
  'checkpoint-report': 'завершённый отчёт контрольного этапа',
  'assessment-report': 'завершённый отчёт итоговой проверки',
  'capstone-report': 'неизменяемый отчёт о пройденном итоговом проекте',
  'project-progress': 'старая отметка проекта (не подтверждает навык)'
};

function loadGraph() {
  return buildSkillEvidenceGraph(
    loadProgress(),
    loadCurriculumProgress(),
    loadLocalAssessmentReports(),
    loadLocalCheckpointReports()
  );
}

export default function ReadinessExplainer() {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [graph, setGraph] = useState(loadGraph);
  const [moduleId, setModuleId] = useState(() => loadGraph().modules[0]?.moduleId || '');

  useEffect(() => {
    let mounted: HTMLElement | null = null;
    const mount = () => {
      const roadmap = document.querySelector('.roadmap-section');
      if (!roadmap || roadmap.querySelector('[data-readiness-explainer-slot]')) return;
      const next = document.createElement('div');
      next.dataset.readinessExplainerSlot = 'true';
      roadmap.querySelector('.roadmap-heading')?.insertAdjacentElement('afterend', next);
      if (!next.isConnected) roadmap.prepend(next);
      mounted = next;
      setSlot(next);
    };
    mount();
    const observer = new MutationObserver(mount);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      mounted?.remove();
    };
  }, []);

  useEffect(() => {
    const refresh = () => setGraph(loadGraph());
    window.addEventListener(PROGRESS_CHANGED_EVENT, refresh);
    window.addEventListener(CURRICULUM_PROGRESS_CHANGED_EVENT, refresh);
    window.addEventListener(ASSESSMENT_REPORTS_CHANGED_EVENT, refresh);
    window.addEventListener(CHECKPOINT_REPORTS_CHANGED_EVENT, refresh);
    window.addEventListener(CAPSTONE_REPORTS_CHANGED_EVENT, refresh);
    window.addEventListener('storage', refresh);
    return () => {
      window.removeEventListener(PROGRESS_CHANGED_EVENT, refresh);
      window.removeEventListener(CURRICULUM_PROGRESS_CHANGED_EVENT, refresh);
      window.removeEventListener(ASSESSMENT_REPORTS_CHANGED_EVENT, refresh);
      window.removeEventListener(CHECKPOINT_REPORTS_CHANGED_EVENT, refresh);
      window.removeEventListener(CAPSTONE_REPORTS_CHANGED_EVENT, refresh);
      window.removeEventListener('storage', refresh);
    };
  }, []);

  const selected = graph.modules.find(module => module.moduleId === moduleId) || graph.modules[0];
  const applicableWeight = useMemo(() => {
    if (!selected) return 0;
    return (Object.keys(selected.evidence) as ReadinessEvidenceKind[])
      .filter(kind => selected.evidence[kind].available)
      .reduce((sum, kind) => sum + READINESS_POLICY.moduleWeights[kind], 0);
  }, [selected]);

  if (!slot || !selected) return null;

  return createPortal(<section className={expanded ? 'readiness-explainer expanded' : 'readiness-explainer'} data-testid="readiness-explainer">
    <button
      type="button"
      className="readiness-explainer-toggle"
      aria-expanded={expanded}
      onClick={() => {
        setGraph(loadGraph());
        setExpanded(value => !value);
      }}
    >
      <Info />
      <span><strong>Как считается готовность?</strong><small>Только подтверждённые результаты и нормализованные применимые веса</small></span>
      <ChevronDown />
    </button>

    {expanded && <div className="readiness-explainer-body">
      <header>
        <div><Gauge /><span><small>Выбранный модуль</small><strong>{selected.title}</strong></span></div>
        <label>Модуль<select value={selected.moduleId} onChange={event => setModuleId(event.target.value)}>{graph.modules.map(module => <option key={module.moduleId} value={module.moduleId}>{module.title}</option>)}</select></label>
      </header>

      <div className="readiness-formula">
        <strong>{selected.readiness}%</strong>
        <span>Сумма вкладов делится на {applicableWeight} применимых весовых пунктов. Неприменимый итоговый проект или контрольный этап не уменьшает максимум модуля.</span>
      </div>

      <div className="readiness-evidence-grid">{(Object.keys(selected.evidence) as ReadinessEvidenceKind[]).map(kind => {
        const evidence = selected.evidence[kind];
        const weight = READINESS_POLICY.moduleWeights[kind];
        const contribution = evidence.available && applicableWeight
          ? Math.round(evidence.score * weight / applicableWeight)
          : 0;
        return <article key={kind} className={evidence.available ? '' : 'unavailable'}>
          <header><span>{evidenceLabels[kind]}</span><strong>{evidence.available ? `${evidence.score}%` : 'Не применяется'}</strong></header>
          <div><i><b style={{ width: `${evidence.available ? evidence.score : 0}%` }} /></i><small>{evidence.available ? `вес ${weight} → вклад ${contribution} п.п.` : 'не относится к этому модулю'}</small></div>
          <p>{evidence.sourceKinds.length
            ? evidence.sourceKinds.map(source => sourceLabels[source]).join(' · ')
            : evidence.available ? 'подтверждённых результатов пока нет' : 'вес исключён из знаменателя'}</p>
          <footer>{evidence.completed}/{evidence.total} подтверждено</footer>
        </article>;
      })}</div>

      <aside><ShieldCheck /><span><strong>Правило целостности</strong><small>Просроченные и прерванные попытки остаются в истории, но не участвуют в готовности. Результат проекта создаёт только неизменяемый отчёт о пройденном итоговом проекте; старая отметка не участвует в сертификате.</small></span></aside>
    </div>}
  </section>, slot);
}
