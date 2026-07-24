import { useEffect, useRef, useState } from 'react';
import { CloudOff, DownloadCloud, RefreshCw, ShieldAlert, Wifi, X } from 'lucide-react';
import { registerSW } from 'virtual:pwa-register';

export const PWA_UPDATE_AVAILABLE_EVENT = 'sql-academy-pwa-update-available';
export const APP_DIRTY_STATE_EVENT = 'sql-academy-dirty-state';

function hasActiveAssessment() {
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (key?.startsWith('sql-academy-assessment-session-v1:')) return true;
  }
  return false;
}

function isChunkLoadError(reason: unknown) {
  const message = reason instanceof Error ? `${reason.name}: ${reason.message}` : String(reason);
  return /ChunkLoadError|dynamically imported module|Loading chunk|Importing a module script failed/i.test(message);
}

export default function PwaStatus() {
  const [online, setOnline] = useState(() => navigator.onLine);
  const [needRefresh, setNeedRefresh] = useState(false);
  const [offlineReady, setOfflineReady] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [confirmUnsafe, setConfirmUnsafe] = useState(false);
  const [chunkError, setChunkError] = useState(false);
  const [registrationError, setRegistrationError] = useState('');
  const updateRef = useRef<(reloadPage?: boolean) => Promise<void>>(async () => undefined);

  useEffect(() => {
    let updateTimer = 0;
    updateRef.current = registerSW({
      immediate: true,
      onNeedRefresh: () => setNeedRefresh(true),
      onOfflineReady: () => setOfflineReady(true),
      onRegisteredSW: (_url, registration) => {
        if (!registration) return;
        updateTimer = window.setInterval(() => {
          if (navigator.onLine) void registration.update();
        }, 60 * 60 * 1000);
      },
      onRegisterError: error => setRegistrationError(error instanceof Error ? error.message : 'Service Worker недоступен')
    });
    return () => window.clearInterval(updateTimer);
  }, []);

  useEffect(() => {
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    const onUpdate = () => setNeedRefresh(true);
    const onDirty = (event: Event) => setDirty(Boolean((event as CustomEvent<{ dirty?: boolean }>).detail?.dirty));
    const onRejection = (event: PromiseRejectionEvent) => {
      if (isChunkLoadError(event.reason)) setChunkError(true);
    };
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    window.addEventListener(PWA_UPDATE_AVAILABLE_EVENT, onUpdate);
    window.addEventListener(APP_DIRTY_STATE_EVENT, onDirty);
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      window.removeEventListener(PWA_UPDATE_AVAILABLE_EVENT, onUpdate);
      window.removeEventListener(APP_DIRTY_STATE_EVENT, onDirty);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, []);

  const unsafeToReload = dirty || hasActiveAssessment();
  const applyUpdate = async () => {
    if (unsafeToReload && !confirmUnsafe) {
      setConfirmUnsafe(true);
      return;
    }
    await updateRef.current(true);
  };

  return <>
    <div className={`network-pill ${online ? 'online' : 'offline'}`} role="status" aria-live="polite" data-testid="network-status">
      {online ? <Wifi /> : <CloudOff />}
      <span>{online ? 'Онлайн' : 'Офлайн'}</span>
    </div>

    <div className="pwa-live-region" aria-live="polite" aria-atomic="true">
      {!online && <section className="pwa-toast" data-testid="offline-notice">
        <CloudOff />
        <div><strong>Офлайн-режим</strong><p>Статические материалы и локальный SQLite доступны. Вход, синхронизация и AI требуют сеть.</p></div>
      </section>}

      {offlineReady && online && <section className="pwa-toast" data-testid="offline-ready">
        <DownloadCloud />
        <div><strong>Приложение готово к офлайн-работе</strong><p>Основные статические ресурсы сохранены в этом браузере.</p></div>
        <button type="button" className="pwa-icon" onClick={() => setOfflineReady(false)} aria-label="Закрыть уведомление"><X /></button>
      </section>}

      {needRefresh && <section className="pwa-toast update" role="dialog" aria-labelledby="pwa-update-title" data-testid="pwa-update-notice">
        <RefreshCw />
        <div>
          <strong id="pwa-update-title">Доступна новая версия</strong>
          <p>{confirmUnsafe
            ? 'Сейчас есть активная или изменённая работа. Повторное подтверждение перезагрузит приложение; assessment-сессия сохранена локально.'
            : 'Обновление будет установлено только после твоего подтверждения.'}</p>
          <div className="pwa-actions">
            <button type="button" onClick={() => void applyUpdate()}>{confirmUnsafe ? 'Всё равно обновить' : 'Обновить сейчас'}</button>
            <button type="button" onClick={() => { setNeedRefresh(false); setConfirmUnsafe(false); }}>Позже</button>
          </div>
        </div>
      </section>}

      {chunkError && <section className="pwa-toast danger" role="alert" data-testid="chunk-recovery">
        <ShieldAlert />
        <div><strong>Версия приложения изменилась</strong><p>Один из модулей больше недоступен в старой сборке. Локальный прогресс сохранён.</p><button type="button" onClick={() => window.location.reload()}>Перезагрузить безопасно</button></div>
        <button type="button" className="pwa-icon" onClick={() => setChunkError(false)} aria-label="Закрыть уведомление"><X /></button>
      </section>}

      {registrationError && <section className="pwa-toast danger" role="alert"><ShieldAlert /><div><strong>PWA временно недоступна</strong><p>{registrationError}</p></div></section>}
    </div>
  </>;
}
