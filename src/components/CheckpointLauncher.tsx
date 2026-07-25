import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { FlagTriangleRight } from 'lucide-react';
import { openDeferredFeature, preloadDeferredFeature } from '../lib/deferred-features';

export const OPEN_CHECKPOINT_EVENT = 'sql-academy-open-checkpoint';
export const CHECKPOINT_REQUEST_KEY = 'sql-academy-checkpoint-open-request';

export function openCheckpointCenter(checkpointId?: string) {
  if (checkpointId) sessionStorage.setItem(CHECKPOINT_REQUEST_KEY, checkpointId);
  window.dispatchEvent(new CustomEvent(OPEN_CHECKPOINT_EVENT, { detail: { checkpointId } }));
}

export default function CheckpointLauncher() {
  const [desktopSlot, setDesktopSlot] = useState<HTMLElement | null>(null);
  const [mobileSlot, setMobileSlot] = useState<HTMLElement | null>(null);

  useEffect(() => {
    const mount = () => {
      const sidebarNav = document.querySelector('.sidebar nav');
      const mobileNav = document.querySelector('.mobile-bottom-nav');
      if (!sidebarNav || !mobileNav || document.querySelector('[data-checkpoint-launcher-slot="desktop"]')) return null;

      const desktop = document.createElement('span');
      desktop.dataset.checkpointLauncherSlot = 'desktop';
      desktop.className = 'assessment-nav-slot';

      const mobile = document.createElement('span');
      mobile.dataset.checkpointLauncherSlot = 'mobile';
      mobile.className = 'assessment-mobile-slot';

      const assessmentButton = Array.from(sidebarNav.querySelectorAll('button'))
        .find(button => button.textContent?.includes('Assessment Center'));
      if (assessmentButton) assessmentButton.insertAdjacentElement('afterend', desktop);
      else sidebarNav.append(desktop);
      mobileNav.append(mobile);

      setDesktopSlot(desktop);
      setMobileSlot(mobile);
      return () => {
        desktop.remove();
        mobile.remove();
      };
    };

    const cleanup = mount();
    if (cleanup) return cleanup;

    const observer = new MutationObserver(() => {
      const nextCleanup = mount();
      if (nextCleanup) observer.disconnect();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const onOpen = (event: Event) => {
      const checkpointId = (event as CustomEvent<{ checkpointId?: string }>).detail?.checkpointId;
      if (checkpointId) sessionStorage.setItem(CHECKPOINT_REQUEST_KEY, checkpointId);
      openDeferredFeature('checkpoints');
    };
    window.addEventListener(OPEN_CHECKPOINT_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_CHECKPOINT_EVENT, onOpen);
  }, []);

  const open = () => openDeferredFeature('checkpoints');
  const preload = () => preloadDeferredFeature('checkpoints');

  const desktopTrigger = <button
    type="button"
    onClick={open}
    onMouseEnter={preload}
    onFocus={preload}
    data-testid="checkpoint-trigger"
  >
    <FlagTriangleRight /><span>Checkpoints</span>
  </button>;

  const mobileTrigger = <button
    type="button"
    onClick={open}
    onTouchStart={preload}
    onFocus={preload}
    data-testid="checkpoint-mobile-trigger"
  >
    <span className="mobile-nav-icon"><FlagTriangleRight /></span><small>Этапы</small>
  </button>;

  return <>
    {desktopSlot && createPortal(desktopTrigger, desktopSlot)}
    {mobileSlot && createPortal(mobileTrigger, mobileSlot)}
  </>;
}
