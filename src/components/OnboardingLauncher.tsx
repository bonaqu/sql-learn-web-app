import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Compass } from 'lucide-react';
import { openDeferredFeature, preloadDeferredFeature } from '../lib/deferred-features';

const ONBOARDING_CHANGED_EVENT = 'sql-academy-onboarding-changed';

export default function OnboardingLauncher() {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const [complete, setComplete] = useState(false);

  useEffect(() => {
    const mount = () => {
      const nav = document.querySelector('.nav-secondary-tools') || document.querySelector('.sidebar nav');
      if (!nav) return null;
      const existing = nav.querySelector<HTMLElement>('.onboarding-nav-slot');
      if (existing) {
        setSlot(existing);
        return () => undefined;
      }
      const target = nav.querySelector('[data-testid="syllabus-trigger"]');
      const next = document.createElement('span');
      next.className = 'onboarding-nav-slot';
      if (target) target.insertAdjacentElement('afterend', next);
      else nav.append(next);
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
    const update = () => {
      void import('../lib/learner-onboarding').then(module => {
        setComplete(module.onboardingReady(module.loadOnboardingProfile()));
      }).catch(() => setComplete(false));
    };
    update();
    window.addEventListener(ONBOARDING_CHANGED_EVENT, update);
    window.addEventListener('storage', update);
    return () => {
      window.removeEventListener(ONBOARDING_CHANGED_EVENT, update);
      window.removeEventListener('storage', update);
    };
  }, []);

  if (!slot) return null;
  return createPortal(<button
    type="button"
    data-testid="onboarding-trigger"
    onMouseEnter={() => preloadDeferredFeature('onboarding')}
    onFocus={() => preloadDeferredFeature('onboarding')}
    onClick={() => openDeferredFeature('onboarding')}
  ><Compass /><span>{complete ? 'Мой учебный план' : 'Настроить обучение'}</span></button>, slot);
}
