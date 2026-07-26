import { lazy, Suspense, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { ShieldCheck } from 'lucide-react';
import '../capstone-evaluator.css';

const CapstonePortal = lazy(() => import('./CapstonePortal'));
const DEFAULT_PROJECT = 'project-incident-command';

function selectedProjectId() {
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  return params.get('project') || DEFAULT_PROJECT;
}

export default function CapstoneLauncher() {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const [projectId, setProjectId] = useState(selectedProjectId);
  const [openRequest, setOpenRequest] = useState(0);

  useEffect(() => {
    const resolve = () => {
      const nextTarget = document.querySelector<HTMLElement>('.project-complete-bar');
      setTarget(current => current === nextTarget ? current : nextTarget);
      setProjectId(selectedProjectId());
    };
    resolve();
    const observer = new MutationObserver(resolve);
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('hashchange', resolve);
    window.addEventListener('popstate', resolve);
    return () => {
      observer.disconnect();
      window.removeEventListener('hashchange', resolve);
      window.removeEventListener('popstate', resolve);
    };
  }, []);

  const openEvaluator = () => {
    setProjectId(selectedProjectId());
    setOpenRequest(value => value + 1);
  };

  return <>
    {target && createPortal(<>
      <div className="capstone-launch-copy">
        <strong>Готово к исполняемой проверке?</strong>
        <small>Checkboxes — только план. Completion и certificate evidence создаёт immutable passed report.</small>
      </div>
      <button type="button" className="capstone-launch-button" data-testid="open-capstone-evaluator" onClick={openEvaluator}>
        <ShieldCheck />Открыть evaluator
      </button>
    </>, target)}
    {openRequest > 0 && <Suspense fallback={null}>
      <CapstonePortal projectId={projectId} openRequest={openRequest} />
    </Suspense>}
  </>;
}
