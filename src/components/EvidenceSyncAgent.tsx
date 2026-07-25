import { useEffect, useRef } from 'react';
import { clearAuthSession, loadAuthSession } from '../lib/auth';

export const EVIDENCE_SYNC_STATUS_EVENT = 'sql-academy-evidence-sync-status';
const ASSESSMENT_REPORTS_CHANGED_EVENT = 'sql-academy-assessment-reports-changed';
const CHECKPOINT_REPORTS_CHANGED_EVENT = 'sql-academy-checkpoint-reports-changed';

type EvidenceSyncState = 'syncing' | 'synced' | 'partial' | 'offline';

function emit(state: EvidenceSyncState, detail: Record<string, unknown> = {}) {
  window.dispatchEvent(new CustomEvent(EVIDENCE_SYNC_STATUS_EVENT, {
    detail: { state, ...detail }
  }));
}

export default function EvidenceSyncAgent() {
  const running = useRef(false);
  const queued = useRef(false);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    const run = async () => {
      if (!loadAuthSession()) return;
      if (!navigator.onLine) {
        emit('offline');
        return;
      }
      if (running.current) {
        queued.current = true;
        return;
      }

      running.current = true;
      emit('syncing');
      try {
        const { reconcileEvidenceReports } = await import('../lib/evidence-sync');
        const result = await reconcileEvidenceReports();
        const partial = result.assessment.remote === 0 && result.checkpoint.remote === 0
          && (result.assessment.local > 0 || result.checkpoint.local > 0);
        emit(partial ? 'partial' : 'synced', result);
      } catch (reason) {
        const status = (reason as Error & { status?: number }).status;
        if (status === 401) {
          clearAuthSession();
          return;
        }
        emit(navigator.onLine ? 'partial' : 'offline', {
          error: reason instanceof Error ? reason.message : String(reason)
        });
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
    const online = () => void run();
    const visible = () => { if (document.visibilityState === 'visible') schedule(); };

    void run();
    window.addEventListener(ASSESSMENT_REPORTS_CHANGED_EVENT, schedule);
    window.addEventListener(CHECKPOINT_REPORTS_CHANGED_EVENT, schedule);
    window.addEventListener('online', online);
    document.addEventListener('visibilitychange', visible);
    return () => {
      window.removeEventListener(ASSESSMENT_REPORTS_CHANGED_EVENT, schedule);
      window.removeEventListener(CHECKPOINT_REPORTS_CHANGED_EVENT, schedule);
      window.removeEventListener('online', online);
      document.removeEventListener('visibilitychange', visible);
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, []);

  return null;
}
