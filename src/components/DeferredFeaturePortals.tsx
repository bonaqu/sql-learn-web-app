import { lazy, Suspense, useEffect, useState } from 'react';
import {
  DeferredFeature,
  OPEN_DEFERRED_FEATURE_EVENT,
  PRELOAD_DEFERRED_FEATURE_EVENT
} from '../lib/deferred-features';

const LearningPathPortal = lazy(() => import('./LearningPathPortal'));
const AssessmentCenterPortal = lazy(() => import('./AssessmentCenterPortal'));

function activeAssessmentExists() {
  for (let index = 0; index < localStorage.length; index += 1) {
    if (localStorage.key(index)?.startsWith('sql-academy-assessment-session-v1:')) return true;
  }
  return false;
}

function preload(feature: DeferredFeature) {
  if (feature === 'learning-path') return void import('./LearningPathPortal');
  return void import('./AssessmentCenterPortal');
}

export default function DeferredFeaturePortals() {
  const activeAssessment = activeAssessmentExists();
  const [pathLoaded, setPathLoaded] = useState(false);
  const [assessmentLoaded, setAssessmentLoaded] = useState(activeAssessment);
  const [pathRequest, setPathRequest] = useState(0);
  const [assessmentRequest, setAssessmentRequest] = useState(activeAssessment ? 1 : 0);

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
    </Suspense>}
    {assessmentLoaded && <Suspense fallback={<div className="feature-loading" role="status">Загрузка Assessment Center…</div>}>
      <AssessmentCenterPortal externalLauncher openRequest={assessmentRequest} />
    </Suspense>}
  </>;
}
