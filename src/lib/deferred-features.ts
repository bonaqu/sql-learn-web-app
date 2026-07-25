export type DeferredFeature = 'learning-path' | 'assessment' | 'curriculum' | 'syllabus' | 'checkpoints' | 'onboarding';

export const OPEN_DEFERRED_FEATURE_EVENT = 'sql-academy-open-feature';
export const PRELOAD_DEFERRED_FEATURE_EVENT = 'sql-academy-preload-feature';

function dispatch(name: string, feature: DeferredFeature) {
  window.dispatchEvent(new CustomEvent(name, { detail: { feature } }));
}

export function openDeferredFeature(feature: DeferredFeature) {
  dispatch(OPEN_DEFERRED_FEATURE_EVENT, feature);
}

export function preloadDeferredFeature(feature: DeferredFeature) {
  dispatch(PRELOAD_DEFERRED_FEATURE_EVENT, feature);
}
