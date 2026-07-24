import { useEffect } from 'react';
import { loadAssessmentSession } from '../lib/assessment';

export default function AssessmentAutoResume() {
  useEffect(() => {
    if (!loadAssessmentSession()) return;
    let cancelled = false;
    let attempts = 0;
    let timer = 0;

    const openActiveAssessment = () => {
      if (cancelled) return;
      const trigger = document.querySelector<HTMLButtonElement>('[data-testid="assessment-trigger"]');
      if (trigger) {
        trigger.click();
        return;
      }
      attempts += 1;
      if (attempts < 40) timer = window.setTimeout(openActiveAssessment, 50);
    };

    openActiveAssessment();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, []);

  return null;
}
