import { useEffect, useRef } from 'react';
import { clearAuthSession, loadAuthSession } from '../lib/auth';
import {
  CURRICULUM_PROGRESS_CHANGED_EVENT,
  syncCurriculumWithStatus
} from '../lib/curriculum-sync';

export default function CurriculumSyncAgent() {
  const timer = useRef<number | null>(null);
  const running = useRef(false);
  const queued = useRef(false);

  useEffect(() => {
    const run = async () => {
      if (!loadAuthSession() || running.current) {
        queued.current = true;
        return;
      }
      running.current = true;
      try {
        await syncCurriculumWithStatus();
      } catch (reason) {
        if ((reason as Error & { status?: number }).status === 401) clearAuthSession();
      } finally {
        running.current = false;
        if (queued.current) {
          queued.current = false;
          timer.current = window.setTimeout(() => void run(), 250);
        }
      }
    };

    const schedule = () => {
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => void run(), 1800);
    };
    const online = () => void run();

    void run();
    window.addEventListener(CURRICULUM_PROGRESS_CHANGED_EVENT, schedule);
    window.addEventListener('online', online);
    return () => {
      window.removeEventListener(CURRICULUM_PROGRESS_CHANGED_EVENT, schedule);
      window.removeEventListener('online', online);
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, []);

  return null;
}
