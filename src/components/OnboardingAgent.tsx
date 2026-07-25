import { useEffect, useRef } from 'react';
import { openDeferredFeature } from '../lib/deferred-features';

const AUTH_SESSION_KEY = 'sql-academy-auth-session-v2';
const ONBOARDING_CHANGED_EVENT = 'sql-academy-onboarding-changed';
const ASSESSMENT_REPORTS_CHANGED_EVENT = 'sql-academy-assessment-reports-changed';

function currentUserId() {
  try {
    const session = JSON.parse(localStorage.getItem(AUTH_SESSION_KEY) || 'null') as { userId?: string } | null;
    return session?.userId || '';
  } catch {
    return '';
  }
}

export default function OnboardingAgent() {
  const timer = useRef<number | null>(null);
  const running = useRef(false);
  const queued = useRef(false);

  useEffect(() => {
    const userId = currentUserId();
    if (!userId) return;

    const run = async () => {
      if (running.current) {
        queued.current = true;
        return;
      }
      running.current = true;
      try {
        const { syncOnboardingProfile } = await import('../lib/onboarding-sync');
        await syncOnboardingProfile();
      } catch {
        // Local onboarding data remains authoritative offline; later events retry sync.
      } finally {
        running.current = false;
        if (queued.current) {
          queued.current = false;
          timer.current = window.setTimeout(() => void run(), 300);
        }
      }
    };

    const schedule = () => {
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => void run(), 900);
    };

    const assessmentChanged = () => {
      void Promise.all([
        import('../lib/assessment'),
        import('../lib/learner-onboarding'),
        import('../lib/onboarding-sync')
      ]).then(([assessment, onboarding, sync]) => {
        const profile = onboarding.loadOnboardingProfile(userId);
        if (profile.placement.status !== 'pending') {
          schedule();
          return;
        }
        const report = onboarding.latestCompletedDiagnostic(assessment.loadLocalAssessmentReports(userId));
        if (!report || report.id === profile.placement.reportId) return;
        const placement = onboarding.calculatePlacement(profile, report);
        const next = onboarding.saveOnboardingProfile({
          ...profile,
          placement,
          firstWeekPlan: onboarding.buildFirstWeekPlan({ ...profile, placement }),
          completedAt: null,
          updatedAt: report.completedAt
        }, userId);
        void sync.syncOnboardingProfile(next).catch(() => undefined);
        window.setTimeout(() => openDeferredFeature('onboarding'), 140);
      }).catch(() => undefined);
    };

    timer.current = window.setTimeout(() => void run(), 350);
    window.addEventListener(ONBOARDING_CHANGED_EVENT, schedule);
    window.addEventListener(ASSESSMENT_REPORTS_CHANGED_EVENT, assessmentChanged);
    window.addEventListener('online', schedule);
    return () => {
      window.removeEventListener(ONBOARDING_CHANGED_EVENT, schedule);
      window.removeEventListener(ASSESSMENT_REPORTS_CHANGED_EVENT, assessmentChanged);
      window.removeEventListener('online', schedule);
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, []);

  return null;
}
