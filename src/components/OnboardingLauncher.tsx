import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Compass } from 'lucide-react';
import { openDeferredFeature, preloadDeferredFeature } from '../lib/deferred-features';
import { loadOnboardingProfile, ONBOARDING_CHANGED_EVENT, onboardingReady } from '../lib/learner-onboarding';

export default function OnboardingLauncher() {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const [profile, setProfile] = useState(() => loadOnboardingProfile());

  useEffect(() => {
    const mount = () => {
      const nav = document.querySelector('.sidebar nav');
      if (!nav) return null;
      const existing = nav.querySelector<HTMLElement>('.onboarding-nav-slot');
      if (existing) {
        setSlot(existing);
        return () => undefined;
      }
      const target = nav.querySelector('[data-testid="learning-path-trigger"]');
      const next = document.createElement('span');
      next.className = 'onboarding-nav-slot';
      if (target) target.insertAdjacentElement('afterend', next);
      else nav.prepend(next);
      setSlot(next);
      return () => next.remove();
    };
    const cleanup = mount();
    if (cleanup) return cleanup;
    const observer = new MutationObserver(() => {
      const result = mount();
      if (result) observer.disconnect();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const update = () => setProfile(loadOnboardingProfile());
    window.addEventListener(ONBOARDING_CHANGED_EVENT, update);
    window.addEventListener('storage', update);
    return () => {
      window.removeEventListener(ONBOARDING_CHANGED_EVENT, update);
      window.removeEventListener('storage', update);
    };
  }, []);

  if (!slot) return null;
  const complete = onboardingReady(profile);
  return createPortal(<button
    type="button"
    data-testid="onboarding-trigger"
    onMouseEnter={() => preloadDeferredFeature('onboarding')}
    onFocus={() => preloadDeferredFeature('onboarding')}
    onClick={() => openDeferredFeature('onboarding')}
  ><Compass /><span>{complete ? 'Мой учебный план' : 'Настроить обучение'}</span></button>, slot);
}
