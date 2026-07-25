import { lazy, Suspense, useEffect, useState } from 'react';
import {
  DeferredFeature,
  OPEN_DEFERRED_FEATURE_EVENT,
  PRELOAD_DEFERRED_FEATURE_EVENT
} from '../lib/deferred-features';

const LearningPathPortal = lazy(() => import('./LearningPathPortal'));
const ReadinessExplainer = lazy(() => import('./ReadinessExplainer'));
const AssessmentCenterPortal = lazy(() => import('./AssessmentCenterPortal'));
const CurriculumPortal = lazy(() => import('./CurriculumPortal'));
const SyllabusPortal = lazy(() => import('./SyllabusPortal'));
const CheckpointCenterPortal = lazy(() => import('./CheckpointCenterPortal'));
const OnboardingPortal = lazy(() => import('./OnboardingPortal'));

function activeSessionExists(prefix: string) {
  for (let index = 0; index < localStorage.length; index += 1) {
    if (localStorage.key(index)?.startsWith(prefix)) return true;
  }
  return false;
}

function preload(feature: DeferredFeature) {
  if (feature === 'learning-path') {
    void import('./LearningPathPortal');
    return void import('./ReadinessExplainer');
  }
  if (feature === 'assessment') return void import('./AssessmentCenterPortal');
  if (feature === 'syllabus') return void import('./SyllabusPortal');
  if (feature === 'checkpoints') return void import('./CheckpointCenterPortal');
  if (feature === 'onboarding') return void import('./OnboardingPortal');
  return void import('./CurriculumPortal');
}

export default function DeferredFeaturePortals() {
  const activeAssessment = activeSessionExists('sql-academy-assessment-session-v1:');
  const activeCheckpoint = activeSessionExists('sql-academy-checkpoint-session-v1:');
  const [pathLoaded, setPathLoaded] = useState(false);
  const [assessmentLoaded, setAssessmentLoaded] = useState(activeAssessment);
  const [curriculumLoaded, setCurriculumLoaded] = useState(false);
  const [syllabusLoaded, setSyllabusLoaded] = useState(false);
  const [checkpointLoaded, setCheckpointLoaded] = useState(activeCheckpoint);
  const [onboardingLoaded, setOnboardingLoaded] = useState(false);
  const [pathRequest, setPathRequest] = useState(0);
  const [assessmentRequest, setAssessmentRequest] = useState(activeAssessment ? 1 : 0);
  const [curriculumRequest, setCurriculumRequest] = useState(0);
  const [syllabusRequest, setSyllabusRequest] = useState(0);
  const [checkpointRequest, setCheckpointRequest] = useState(activeCheckpoint ? 1 : 0);
  const [onboardingRequest, setOnboardingRequest] = useState(0);

  useEffect(() => {
    const onPreload = (event: Event) => {
      const feature = (event as CustomEvent<{ feature?: DeferredFeature }>).detail?.feature;
      if (feature) preload(feature);
    };
    const onOpen = (event: Event) => {
      const feature = (event as CustomEvent<{ feature?: DeferredFeature }>).detail?.feature;
      if (feature === 'learning-path') {
        setPathLoaded(true);
        setPathRequest(value => value + 1);
      } else if (feature === 'assessment') {
        setAssessmentLoaded(true);
        setAssessmentRequest(value => value + 1);
      } else if (feature === 'curriculum') {
        setCurriculumLoaded(true);
        setCurriculumRequest(value => value + 1);
      } else if (feature === 'syllabus') {
        setSyllabusLoaded(true);
        setSyllabusRequest(value => value + 1);
      } else if (feature === 'checkpoints') {
        setCheckpointLoaded(true);
        setCheckpointRequest(value => value + 1);
      } else if (feature === 'onboarding') {
        setOnboardingLoaded(true);
        setOnboardingRequest(value => value + 1);
      }
    };
    window.addEventListener(PRELOAD_DEFERRED_FEATURE_EVENT, onPreload);
    window.addEventListener(OPEN_DEFERRED_FEATURE_EVENT, onOpen);
    return () => {
      window.removeEventListener(PRELOAD_DEFERRED_FEATURE_EVENT, onPreload);
      window.removeEventListener(OPEN_DEFERRED_FEATURE_EVENT, onOpen);
    };
  }, []);

  return <>
    {pathLoaded && <Suspense fallback={<div className="feature-loading" role="status">Загрузка учебного пути…</div>}>
      <LearningPathPortal externalLauncher openRequest={pathRequest} />
      <ReadinessExplainer />
    </Suspense>}
    {assessmentLoaded && <Suspense fallback={<div className="feature-loading" role="status">Загрузка Assessment Center…</div>}>
      <AssessmentCenterPortal externalLauncher openRequest={assessmentRequest} />
    </Suspense>}
    {curriculumLoaded && <Suspense fallback={<div className="feature-loading" role="status">Загрузка Curriculum Studio…</div>}>
      <CurriculumPortal openRequest={curriculumRequest} />
    </Suspense>}
    {syllabusLoaded && <Suspense fallback={<div className="feature-loading" role="status">Загрузка Syllabus Center…</div>}>
      <SyllabusPortal openRequest={syllabusRequest} />
    </Suspense>}
    {checkpointLoaded && <Suspense fallback={<div className="feature-loading" role="status">Загрузка Checkpoint Center…</div>}>
      <CheckpointCenterPortal openRequest={checkpointRequest || 1} />
    </Suspense>}
    {onboardingLoaded && <Suspense fallback={<div className="feature-loading" role="status">Загрузка стартового плана…</div>}>
      <OnboardingPortal openRequest={onboardingRequest || 1} />
    </Suspense>}
  </>;
}
