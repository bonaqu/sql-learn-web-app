import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { BarChart3 } from 'lucide-react';
import { openDeferredFeature, preloadDeferredFeature } from '../lib/deferred-features';

export default function LearningAnalyticsLauncher() {
  const [slot, setSlot] = useState<HTMLElement | null>(null);

  useEffect(() => {
    const mount = () => {
      const nav = document.querySelector('.nav-secondary-tools') || document.querySelector('.sidebar nav');
      if (!nav) return null;
      const existing = nav.querySelector<HTMLElement>('.learning-analytics-nav-slot');
      if (existing) {
        setSlot(existing);
        return () => undefined;
      }
      const target = nav.querySelector('[data-testid="syllabus-trigger"]');
      const next = document.createElement('span');
      next.className = 'learning-analytics-nav-slot';
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

  if (!slot) return null;
  return createPortal(<button
    type="button"
    data-testid="learning-analytics-trigger"
    onMouseEnter={() => preloadDeferredFeature('analytics')}
    onFocus={() => preloadDeferredFeature('analytics')}
    onClick={event => {
      event.currentTarget.focus({ preventScroll: true });
      openDeferredFeature('analytics');
    }}
  ><BarChart3 /><span>Моя аналитика</span></button>, slot);
}
