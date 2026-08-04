import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { FlagTriangleRight } from 'lucide-react';
import { openDeferredFeature } from '../lib/deferred-features';

export const OPEN_CHECKPOINT_EVENT = 'sql-academy-open-checkpoint';
export const CHECKPOINT_REQUEST_KEY = 'sql-academy-checkpoint-open-request';

export function openCheckpointCenter(checkpointId?: string) {
  if (checkpointId) sessionStorage.setItem(CHECKPOINT_REQUEST_KEY, checkpointId);
  window.dispatchEvent(new CustomEvent(OPEN_CHECKPOINT_EVENT, { detail: { checkpointId } }));
}

export default function CheckpointLauncher() {
  const [slot, setSlot] = useState<HTMLElement | null>(null);

  useEffect(() => {
    let currentSlot: HTMLElement | null = null;
    const createdSlots = new Set<HTMLElement>();

    const mount = () => {
      const nav = document.querySelector('.nav-secondary-tools') || document.querySelector('.sidebar nav');
      if (!nav) return;
      const existing = nav.querySelector<HTMLElement>('[data-checkpoint-launcher-slot="desktop"]');
      if (existing?.isConnected) {
        if (currentSlot !== existing) {
          currentSlot = existing;
          setSlot(existing);
        }
        return;
      }

      const next = document.createElement('span');
      next.dataset.checkpointLauncherSlot = 'desktop';
      next.className = 'assessment-nav-slot';
      const assessmentButton = Array.from(nav.querySelectorAll('button'))
        .find(button => button.textContent?.includes('Экзамены') || button.textContent?.includes('Assessment Center'));
      if (assessmentButton) assessmentButton.insertAdjacentElement('afterend', next);
      else nav.append(next);
      createdSlots.add(next);
      currentSlot = next;
      setSlot(next);
    };

    mount();
    const observer = new MutationObserver(mount);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      for (const created of createdSlots) created.remove();
      currentSlot = null;
    };
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

  if (!slot?.isConnected) return null;
  return createPortal(<button
    type="button"
    onClick={() => openDeferredFeature('checkpoints')}
    data-testid="checkpoint-trigger"
  >
    <FlagTriangleRight /><span>Контрольные этапы</span>
  </button>, slot);
}
