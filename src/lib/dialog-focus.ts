import { RefObject, useEffect, useRef } from 'react';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])'
].join(',');

function focusableElements(container: HTMLElement) {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
    .filter(element => !element.hidden && element.getAttribute('aria-hidden') !== 'true' && element.getClientRects().length > 0);
}

function topmostModalDialog() {
  const dialogs = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]'))
    .filter(dialog => dialog.getClientRects().length > 0);
  return dialogs.reduce<HTMLElement | null>((topmost, candidate) => {
    if (!topmost) return candidate;
    const topmostZ = Number.parseInt(getComputedStyle(topmost).zIndex, 10) || 0;
    const candidateZ = Number.parseInt(getComputedStyle(candidate).zIndex, 10) || 0;
    return candidateZ >= topmostZ ? candidate : topmost;
  }, null);
}

export function useDialogFocus(
  open: boolean,
  containerRef: RefObject<HTMLElement | null>,
  onClose: () => void,
  closeOnEscape = true
) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const container = containerRef.current;
    if (!container) return;

    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const applicationRoot = document.getElementById('root');
    const previousInert = applicationRoot?.inert || false;
    const previousAriaHidden = applicationRoot ? applicationRoot.getAttribute('aria-hidden') : null;

    if (applicationRoot && !applicationRoot.contains(container)) {
      applicationRoot.inert = true;
      applicationRoot.setAttribute('aria-hidden', 'true');
    }

    const focusInitial = () => {
      const preferred = container.querySelector<HTMLElement>('[data-autofocus]');
      const first = preferred || focusableElements(container)[0] || container;
      first.focus({ preventScroll: true });
    };
    const animationFrame = requestAnimationFrame(focusInitial);

    const onKeyDown = (event: KeyboardEvent) => {
      if (topmostModalDialog() !== container) return;
      if (event.key === 'Escape' && closeOnEscape) {
        event.preventDefault();
        closeRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = focusableElements(container);
      if (!focusable.length) {
        event.preventDefault();
        container.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !container.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      cancelAnimationFrame(animationFrame);
      document.removeEventListener('keydown', onKeyDown, true);
      if (applicationRoot && !applicationRoot.contains(container)) {
        applicationRoot.inert = previousInert;
        if (previousAriaHidden === null) applicationRoot.removeAttribute('aria-hidden');
        else applicationRoot.setAttribute('aria-hidden', previousAriaHidden);
      }
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, [closeOnEscape, containerRef, open]);
}
