import { lazy, Suspense, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { ClipboardCheck, Map, Route } from 'lucide-react';

const LearningPathPortal = lazy(() => import('./LearningPathPortal'));
const AssessmentCenterPortal = lazy(() => import('./AssessmentCenterPortal'));

function activeAssessmentExists() {
  for (let index = 0; index < localStorage.length; index += 1) {
    if (localStorage.key(index)?.startsWith('sql-academy-assessment-session-v1:')) return true;
  }
  return false;
}

const preloadPath = () => void import('./LearningPathPortal');
const preloadAssessment = () => void import('./AssessmentCenterPortal');

export default function DeferredFeaturePortals() {
  const [pathDesktopSlot, setPathDesktopSlot] = useState<HTMLElement | null>(null);
  const [pathMobileSlot, setPathMobileSlot] = useState<HTMLElement | null>(null);
  const [assessmentDesktopSlot, setAssessmentDesktopSlot] = useState<HTMLElement | null>(null);
  const [assessmentMobileSlot, setAssessmentMobileSlot] = useState<HTMLElement | null>(null);
  const [pathLoaded, setPathLoaded] = useState(false);
  const [assessmentLoaded, setAssessmentLoaded] = useState(() => activeAssessmentExists());
  const [pathRequest, setPathRequest] = useState(0);
  const [assessmentRequest, setAssessmentRequest] = useState(() => activeAssessmentExists() ? 1 : 0);

  useEffect(() => {
    const mount = () => {
      const sidebarNav = document.querySelector('.sidebar nav');
      const mobileNav = document.querySelector('.mobile-bottom-nav');
      if (!sidebarNav || !mobileNav || document.querySelector('[data-deferred-feature-slots]')) return null;

      const marker = document.createElement('span');
      marker.dataset.deferredFeatureSlots = 'true';
      marker.hidden = true;
      document.body.append(marker);

      const pathDesktop = document.createElement('span');
      pathDesktop.className = 'learning-path-nav-slot';
      const pathMobile = document.createElement('span');
      pathMobile.className = 'learning-path-mobile-slot';
      sidebarNav.firstElementChild?.insertAdjacentElement('afterend', pathDesktop);
      mobileNav.firstElementChild?.insertAdjacentElement('afterend', pathMobile);

      const assessmentDesktop = document.createElement('span');
      assessmentDesktop.className = 'assessment-nav-slot';
      const assessmentMobile = document.createElement('span');
      assessmentMobile.className = 'assessment-mobile-slot';
      const interviewButton = Array.from(sidebarNav.querySelectorAll('button')).find(button => button.textContent?.trim().startsWith('Interview'));
      if (interviewButton) interviewButton.insertAdjacentElement('afterend', assessmentDesktop);
      else sidebarNav.append(assessmentDesktop);
      mobileNav.append(assessmentMobile);

      setPathDesktopSlot(pathDesktop);
      setPathMobileSlot(pathMobile);
      setAssessmentDesktopSlot(assessmentDesktop);
      setAssessmentMobileSlot(assessmentMobile);
      return () => {
        marker.remove();
        pathDesktop.remove();
        pathMobile.remove();
        assessmentDesktop.remove();
        assessmentMobile.remove();
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

  const openPath = () => {
    setPathLoaded(true);
    setPathRequest(value => value + 1);
  };
  const openAssessment = () => {
    setAssessmentLoaded(true);
    setAssessmentRequest(value => value + 1);
  };

  const pathDesktop = <button type="button" onMouseEnter={preloadPath} onFocus={preloadPath} onClick={openPath} data-testid="learning-path-trigger">
    <Route /><span>Учебный путь</span>
  </button>;
  const pathMobile = <button type="button" onTouchStart={preloadPath} onFocus={preloadPath} onClick={openPath} data-testid="learning-path-mobile-trigger">
    <span className="mobile-nav-icon"><Map /></span><small>Путь</small>
  </button>;
  const assessmentDesktop = <button type="button" onMouseEnter={preloadAssessment} onFocus={preloadAssessment} onClick={openAssessment} data-testid="assessment-trigger">
    <ClipboardCheck /><span>Assessment Center</span>
  </button>;
  const assessmentMobile = <button type="button" onTouchStart={preloadAssessment} onFocus={preloadAssessment} onClick={openAssessment} data-testid="assessment-mobile-trigger">
    <span className="mobile-nav-icon"><ClipboardCheck /></span><small>Экзамен</small>
  </button>;

  return <>
    {pathDesktopSlot && createPortal(pathDesktop, pathDesktopSlot)}
    {pathMobileSlot && createPortal(pathMobile, pathMobileSlot)}
    {assessmentDesktopSlot && createPortal(assessmentDesktop, assessmentDesktopSlot)}
    {assessmentMobileSlot && createPortal(assessmentMobile, assessmentMobileSlot)}

    {pathLoaded && <Suspense fallback={<div className="feature-loading" role="status">Загрузка учебного пути…</div>}>
      <LearningPathPortal externalLauncher openRequest={pathRequest} />
    </Suspense>}
    {assessmentLoaded && <Suspense fallback={<div className="feature-loading" role="status">Загрузка Assessment Center…</div>}>
      <AssessmentCenterPortal externalLauncher openRequest={assessmentRequest} />
    </Suspense>}
  </>;
}
