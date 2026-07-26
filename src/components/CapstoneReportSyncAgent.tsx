import { useEffect } from 'react';
import { AUTH_CHANGED_EVENT, loadAuthSession } from '../lib/auth';

export default function CapstoneReportSyncAgent() {
  useEffect(() => {
    let cancelled = false;
    let syncing = false;

    const sync = async () => {
      if (cancelled || syncing || !navigator.onLine || !loadAuthSession()) return;
      syncing = true;
      try {
        const module = await import('../lib/capstone-reports');
        if (!cancelled) await module.syncCapstoneReports();
      } catch {
        // Local reports remain authoritative offline; a later auth/online/visibility event retries.
      } finally {
        syncing = false;
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === 'visible') void sync();
    };

    void sync();
    window.addEventListener(AUTH_CHANGED_EVENT, sync);
    window.addEventListener('online', sync);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      cancelled = true;
      window.removeEventListener(AUTH_CHANGED_EVENT, sync);
      window.removeEventListener('online', sync);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  return null;
}
