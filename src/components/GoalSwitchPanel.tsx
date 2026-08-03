import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  CircleEqual,
  Clock3,
  LockKeyhole,
  RefreshCw,
  Route,
  ShieldCheck,
  Sparkles,
  Target
} from 'lucide-react';
import { modules } from '../data/course-catalog';
import type { GoalSwitchEvidence } from '../lib/goal-switch';
import { previewGoalChange } from '../lib/goal-switch';
import {
  goalOptions,
  saveOnboardingProfile,
  type LearnerGoal,
  type LearnerOnboardingProfile
} from '../lib/learner-onboarding';
import { syncOnboardingProfile } from '../lib/onboarding-sync';
import type { Progress } from '../lib/progress';

import '../goal-switch.css';

type SyncState = 'idle' | 'syncing' | 'synced' | 'offline';

function moduleTitle(moduleId: string | null) {
  if (!moduleId) return 'не меняется';
  return modules.find(([id]) => id === moduleId)?.[1] || moduleId;
}

function actionContext(action: ReturnType<typeof previewGoalChange>['currentFrontier']['action']) {
  const target = action.moduleTitle || action.phaseTitle || action.title;
  if (action.stage === 'review') return `Retrieval review · ${target}`;
  if (action.stage === 'checkpoint') return `Checkpoint · ${target}`;
  if (action.stage === 'assessment') return 'Итоговый assessment';
  if (action.stage === 'project') return `Capstone · ${target}`;
  return `${action.stage} · ${target}`;
}

function ModuleChips({ moduleIds, empty }: { moduleIds: string[]; empty: string }) {
  if (!moduleIds.length) return <p className="goal-switch-empty">{empty}</p>;
  return <div className="goal-switch-chips">{moduleIds.slice(0, 6).map(moduleId => <span key={moduleId}>{moduleTitle(moduleId)}</span>)}</div>;
}

export default function GoalSwitchPanel({
  profile,
  progress,
  evidence,
  onCancel,
  onProfileChanged
}: {
  profile: LearnerOnboardingProfile;
  progress: Progress;
  evidence: GoalSwitchEvidence;
  onCancel: () => void;
  onProfileChanged: (profile: LearnerOnboardingProfile) => void;
}) {
  const currentGoal = profile.goal || 'full';
  const [selectedGoal, setSelectedGoal] = useState<LearnerGoal>(currentGoal);
  const [syncState, setSyncState] = useState<SyncState>('idle');
  const [message, setMessage] = useState('');
  const [applied, setApplied] = useState(false);

  useEffect(() => {
    if (!applied) setSelectedGoal(profile.goal || 'full');
  }, [applied, profile.goal]);

  const preview = useMemo(
    () => previewGoalChange(profile, selectedGoal, progress, evidence),
    [evidence, profile, progress, selectedGoal]
  );

  const apply = async () => {
    if (!preview.changed || syncState === 'syncing') return;
    const proposedActionTitle = preview.proposedFrontier.action.title;
    const immediateActionChanged = preview.immediateActionChanged;
    const saved = saveOnboardingProfile(preview.proposedProfile);
    onProfileChanged(saved);
    setApplied(true);
    setSyncState('syncing');
    setMessage('Новая цель применена локально. Синхронизирую тот же профиль без сброса evidence…');
    try {
      const synced = await syncOnboardingProfile(saved);
      onProfileChanged(synced.profile);
      setSyncState('synced');
      setMessage(immediateActionChanged
        ? `Цель изменена. Следующий шаг теперь — «${proposedActionTitle}».`
        : 'Цель изменена, но текущий обязательный шаг остался прежним. Новый приоритет включится после него.');
    } catch {
      setSyncState('offline');
      setMessage('Цель сохранена локально. Облачная синхронизация повторится при восстановлении сети.');
    }
  };

  return <section className="goal-switch-panel" data-testid="goal-switch-panel" aria-labelledby="goal-switch-title">
    <div className="goal-switch-heading">
      <button className="goal-switch-back" onClick={onCancel} data-testid="goal-switch-cancel"><ArrowLeft />Учебный путь</button>
      <span><Sparkles /> безопасная смена специализации</span>
      <h1 id="goal-switch-title">Измени будущий маршрут, а не прошлые достижения</h1>
      <p>Уроки, задачи, checkpoints, assessments, capstones и placement evidence сохраняются. Меняется только приоритет ещё не завершённых prerequisite-safe модулей.</p>
    </div>

    <div className="goal-switch-options" role="radiogroup" aria-label="Новая цель обучения">
      {goalOptions.map(option => <button
        key={option.id}
        role="radio"
        aria-checked={selectedGoal === option.id}
        className={selectedGoal === option.id ? 'selected' : ''}
        onClick={() => {
          setSelectedGoal(option.id);
          setApplied(false);
          setSyncState('idle');
          setMessage('');
        }}
        data-testid={`goal-switch-option-${option.id}`}
      >
        <span>{selectedGoal === option.id ? <CheckCircle2 /> : <Target />}</span>
        <strong>{option.title}</strong>
        <small>{option.description}</small>
        {option.id === currentGoal && <em>текущая</em>}
      </button>)}
    </div>

    <div className="goal-switch-preview" data-testid="goal-switch-preview">
      <article data-testid="goal-switch-current-action">
        <small>Сейчас · {preview.currentGoalTitle}</small>
        <strong>{preview.currentFrontier.action.title}</strong>
        <span>{actionContext(preview.currentFrontier.action)}</span>
        <p>{preview.currentFrontier.action.routeReason || preview.currentFrontier.action.description}</p>
      </article>
      <ArrowRight className={preview.immediateActionChanged ? 'changed' : ''} />
      <article data-testid="goal-switch-proposed-action">
        <small>После применения · {preview.proposedGoalTitle}</small>
        <strong>{preview.proposedFrontier.action.title}</strong>
        <span>{actionContext(preview.proposedFrontier.action)}</span>
        <p>{preview.proposedFrontier.action.routeReason || preview.proposedFrontier.action.description}</p>
      </article>
    </div>

    <div className={`goal-switch-impact ${preview.immediateActionChanged ? 'changed' : 'stable'}`} data-testid="goal-switch-impact">
      {preview.immediateActionChanged ? <Route /> : <CircleEqual />}
      <div>
        <strong>{preview.changed
          ? preview.immediateActionChanged
            ? 'Следующий шаг изменится на реальной доступной развилке'
            : 'Текущий обязательный шаг не изменится'
          : 'Выбрана текущая цель'}</strong>
        <p>{!preview.changed
          ? 'Выбери другую цель, чтобы увидеть только будущие изменения.'
          : preview.immediateActionChanged
            ? `${moduleTitle(preview.currentDivergenceModuleId)} уступает приоритет модулю ${moduleTitle(preview.proposedDivergenceModuleId)}. Оба остаются обязательными.`
            : 'Review, checkpoint, remediation или общий prerequisite-prefix сильнее специализации. Новый приоритет применится позже.'}</p>
      </div>
    </div>

    <div className="goal-switch-route-grid">
      <article>
        <span><Check /><strong>Неизменный будущий prefix</strong></span>
        <ModuleChips moduleIds={preview.unchangedFuturePrefixModuleIds} empty="Маршрут расходится сразу после уже завершённого evidence." />
      </article>
      <article>
        <span><Sparkles /><strong>Поднимутся раньше</strong></span>
        <ModuleChips moduleIds={preview.movedEarlierModuleIds} empty="Ни один модуль не поднимается раньше при этой смене." />
      </article>
      <article>
        <span><Clock3 /><strong>Станут позже</strong></span>
        <ModuleChips moduleIds={preview.deferredModuleIds} empty="Ни один модуль не откладывается при этой смене." />
      </article>
    </div>

    <div className="goal-switch-preserved">
      <ShieldCheck />
      <div><strong>Evidence остаётся авторитетным</strong><p>{preview.completedModuleIds.length} завершённых или безопасно bypassed модулей не пересчитываются назад. Все {preview.proposedFrontier.routeModuleIds.length} модулей и expert outcomes остаются в маршруте.</p></div>
      <LockKeyhole />
    </div>

    {message && <div className={`goal-switch-message ${syncState}`} role="status" aria-live="polite">
      {syncState === 'syncing' ? <RefreshCw className="spin" /> : syncState === 'synced' ? <CheckCircle2 /> : <ShieldCheck />}
      <span>{message}</span>
    </div>}

    <div className="goal-switch-actions">
      <button onClick={onCancel}>Отмена без изменений</button>
      <button
        className="primary"
        disabled={!preview.changed || syncState === 'syncing'}
        onClick={() => void apply()}
        data-testid="goal-switch-apply"
      >
        {syncState === 'syncing' ? <RefreshCw className="spin" /> : <Check />}
        {preview.changed ? `Применить «${preview.proposedGoalTitle}»` : 'Это уже текущая цель'}
      </button>
    </div>
  </section>;
}