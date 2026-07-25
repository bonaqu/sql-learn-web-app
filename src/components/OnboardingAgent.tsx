import { useEffect, useRef } from 'react';
import {
  ASSESSMENT_REPORTS_CHANGED_EVENT,
  loadLocalAssessmentReports
} from '../lib/assessment';
import { loadAuthSession } from '../lib/auth';
import { openDeferredFeature } from '../lib/deferred-features';
import {
  buildFirstWeekPlan,
  calculatePlacement,
  latestCompletedDiagnostic,
  loadOnboardingProfile,
  ONBOARDING_CHANGED_EVENT,
  onboardingReady,
  saveOnboardingProfile
} from '../lib/learner-onboarding';
import { syncOnboardingProfile } from '../lib/onboarding-sync';
import { loadProgress } from '../lib/progress';

function autoOpenedKey(userId: string) {
  return `sql-academy-onboarding-auto-opened:${userId}`;
}

export default function OnboardingAgent() {
  const timer = useRef<number | null>(null);
  const running = useRef(false);
  const queued = useRef(false);

  useEffect(() => {
    const auth = loadAuthSession();
    if (!auth) return;

    const run = async () => {
      if (running.current) {
        queued.current = true;
        return;
      }
      running.current = true;
      try {
        const synced = await syncOnboardingProfile();
        const profile = synced.profile;
        const progress = loadProgress();
        if (!onboardingReady(profile)
          && progress.completed.length === 0
          && !sessionStorage.getItem(autoOpenedKey(auth.userId))) {
          sessionStorage.setItem(autoOpenedKey(auth.userId), '1');
          window.setTimeout(() => openDeferredFeature('onboarding'), 180);
        }
      } catch {
        const profile = loadOnboardingProfile(auth.userId);
        if (!onboardingReady(profile)
          && loadProgress().completed.length === 0
          && !sessionStorage.getItem(autoOpenedKey(auth.userId))) {
          sessionStorage.setItem(autoOpenedKey(auth.userId), '1');
          window.setTimeout(() => openDeferredFeature('onboarding'), 180);
        }
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
      const profile = loadOnboardingProfile(auth.userId);
      if (profile.placement.status !== 'pending') {
        schedule();
        return;
      }
      const report = latestCompletedDiagnostic(loadLocalAssessmentReports(auth.userId));
      if (!report || report.id === profile.placement.reportId) return;
      const placement = calculatePlacement(profile, report);
      const next = saveOnboardingProfile({
        ...profile,
        placement,
        firstWeekPlan: buildFirstWeekPlan({ ...profile, placement }),
        completedAt: null,
        updatedAt: report.completedAt
      }, auth.userId);
      void syncOnboardingProfile(next).catch(() => undefined);
      sessionStorage.setItem(autoOpenedKey(auth.userId), '1');
      window.setTimeout(() => openDeferredFeature('onboarding'), 140);
    };

    void run();
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
