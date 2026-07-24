import { useEffect, useState } from 'react';
import { CheckCircle2, Cloud, CloudOff, LoaderCircle, RefreshCw } from 'lucide-react';
import { CurriculumProgressV1 } from '../lib/curriculum-progress';
import {
  CURRICULUM_SYNC_STATUS_EVENT,
  CurriculumSyncStatus,
  syncCurriculumWithStatus
} from '../lib/curriculum-sync';

export default function CurriculumSyncButton({ onProgress }: { onProgress: (progress: CurriculumProgressV1) => void }) {
  const [status, setStatus] = useState<CurriculumSyncStatus>(navigator.onLine ? 'idle' : 'offline');
  const [message, setMessage] = useState('Curriculum сохранён локально');

  useEffect(() => {
    const update = (event: Event) => {
      const detail = (event as CustomEvent<{ status?: CurriculumSyncStatus; message?: string }>).detail;
      if (detail?.status) setStatus(detail.status);
      if (detail?.message) setMessage(detail.message);
    };
    window.addEventListener(CURRICULUM_SYNC_STATUS_EVENT, update);
    return () => window.removeEventListener(CURRICULUM_SYNC_STATUS_EVENT, update);
  }, []);

  const sync = async () => {
    try {
      const result = await syncCurriculumWithStatus();
      onProgress(result.progress);
    } catch {
      // Status and message are emitted by the sync layer.
    }
  };

  const icon = status === 'syncing'
    ? <LoaderCircle className="spin" />
    : status === 'synced'
      ? <CheckCircle2 />
      : status === 'offline'
        ? <CloudOff />
        : status === 'error'
          ? <RefreshCw />
          : <Cloud />;

  return <button
    type="button"
    className={`curriculum-sync-button ${status}`}
    data-testid="curriculum-sync"
    onClick={() => void sync()}
    disabled={status === 'syncing'}
    aria-label={message}
    title={message}
  >{icon}<span>{status === 'syncing' ? 'Синхронизация' : status === 'synced' ? 'В облаке' : status === 'offline' ? 'Локально' : status === 'error' ? 'Повторить' : 'Синхронизировать'}</span></button>;
}
