import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Check,
  Cloud,
  CloudOff,
  Copy,
  Download,
  KeyRound,
  Link2,
  LoaderCircle,
  LogOut,
  MonitorSmartphone,
  RefreshCw,
  ShieldCheck,
  Trash2,
  Unplug,
  X
} from 'lucide-react';
import {
  AccountMetadata,
  AccountSession,
  clearAccountSession,
  connectAccount,
  deleteCloudAccount,
  fetchAccountMetadata,
  generateRecoveryCode,
  loadAccountSession,
  recoveryCodeDownload,
  registerAccount,
  revokeAccountDevice,
  syncAccountProgress,
  validateRecoveryCode
} from '../lib/account';

type Screen = 'overview' | 'create' | 'created' | 'connect' | 'account' | 'delete';
type BusyAction = 'create' | 'connect' | 'sync' | 'metadata' | 'delete' | 'revoke' | null;

function friendlyError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('not found')) return 'Аккаунт с таким recovery-кодом не найден.';
  if (message.includes('incorrect')) return 'Recovery-код не подошёл. Проверь символы и попробуй снова.';
  if (message.includes('revoked')) return 'Сессия этого устройства отозвана. Подключи аккаунт заново.';
  if (message.includes('Failed to fetch')) return 'Облачный API сейчас недоступен. Локальный прогресс не пострадал.';
  return message || 'Не удалось выполнить действие.';
}

function formatDate(value?: string | null) {
  if (!value) return 'ещё не синхронизировался';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date);
}

export default function SyncAccountPortal() {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const [open, setOpen] = useState(false);
  const [screen, setScreen] = useState<Screen>(() => loadAccountSession() ? 'account' : 'overview');
  const [session, setSession] = useState<AccountSession | null>(() => loadAccountSession());
  const [metadata, setMetadata] = useState<AccountMetadata | null>(null);
  const [recoveryCode, setRecoveryCode] = useState('');
  const [enteredCode, setEnteredCode] = useState('');
  const [deviceName, setDeviceName] = useState('Моё устройство');
  const [codeSaved, setCodeSaved] = useState(false);
  const [busy, setBusy] = useState<BusyAction>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const syncTimer = useRef<number | null>(null);

  const connected = Boolean(session);
  const statusLabel = connected ? 'Облачный аккаунт подключён' : 'Только это устройство';

  useEffect(() => {
    const mount = () => {
      const legacy = document.querySelector<HTMLButtonElement>('[aria-label="Синхронизировать прогресс"]');
      if (!legacy?.parentElement) return false;
      legacy.hidden = true;
      const target = document.createElement('span');
      target.className = 'sync-account-slot';
      legacy.insertAdjacentElement('afterend', target);
      setSlot(target);
      return () => {
        legacy.hidden = false;
        target.remove();
      };
    };

    const cleanup = mount();
    if (cleanup) return cleanup;
    const observer = new MutationObserver(() => {
      const result = mount();
      if (result) observer.disconnect();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const handler = (event: Event) => {
      const next = (event as CustomEvent<AccountSession | null>).detail;
      setSession(next);
      setScreen(next ? 'account' : 'overview');
    };
    window.addEventListener('sql-academy-account-session', handler);
    return () => window.removeEventListener('sql-academy-account-session', handler);
  }, []);

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) setOpen(false);
    };
    window.addEventListener('keydown', keydown);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener('keydown', keydown);
    };
  }, [busy, open]);

  const loadMetadata = useCallback(async (current = loadAccountSession()) => {
    if (!current) return;
    setBusy('metadata');
    try {
      setMetadata(await fetchAccountMetadata(current));
      setError('');
    } catch (reason) {
      setError(friendlyError(reason));
    } finally {
      setBusy(null);
    }
  }, []);

  const runSync = useCallback(async (silent = false) => {
    const current = loadAccountSession();
    if (!current) return;
    if (!silent) setBusy('sync');
    try {
      const result = await syncAccountProgress(current);
      setSession(result.session);
      setMessage(result.localChanged ? 'Облачный и локальный прогресс объединены.' : 'Прогресс синхронизирован.');
      setError('');
      await loadMetadata(result.session);
      if (result.localChanged) window.setTimeout(() => window.location.reload(), 350);
    } catch (reason) {
      setError(friendlyError(reason));
    } finally {
      if (!silent) setBusy(null);
    }
  }, [loadMetadata]);

  useEffect(() => {
    if (!session) return;
    void runSync(true);
    const progressChanged = () => {
      if (syncTimer.current) window.clearTimeout(syncTimer.current);
      syncTimer.current = window.setTimeout(() => void runSync(true), 1800);
    };
    window.addEventListener('sql-academy-progress-changed', progressChanged);
    return () => {
      window.removeEventListener('sql-academy-progress-changed', progressChanged);
      if (syncTimer.current) window.clearTimeout(syncTimer.current);
    };
  }, [runSync, session?.accountId, session?.deviceId]);

  const beginCreate = async () => {
    setError('');
    setMessage('');
    setCodeSaved(false);
    setBusy('create');
    try {
      setRecoveryCode(await generateRecoveryCode());
      setScreen('create');
    } finally {
      setBusy(null);
    }
  };

  const createAccount = async () => {
    if (!codeSaved || !recoveryCode) return;
    setBusy('create');
    setError('');
    try {
      const issued = await registerAccount(recoveryCode, deviceName);
      const synced = await syncAccountProgress(issued.session);
      setSession(synced.session);
      setScreen('created');
      setMessage('Аккаунт создан, а текущий прогресс загружен в облако.');
    } catch (reason) {
      setError(friendlyError(reason));
    } finally {
      setBusy(null);
    }
  };

  const connectExisting = async () => {
    setBusy('connect');
    setError('');
    try {
      if (!await validateRecoveryCode(enteredCode)) throw new Error('Recovery-код повреждён или введён с ошибкой');
      const issued = await connectAccount(enteredCode, deviceName);
      const synced = await syncAccountProgress(issued.session);
      setSession(synced.session);
      setMessage(synced.localChanged ? 'Прогресс устройств объединён.' : 'Устройство подключено.');
      setScreen('account');
      await loadMetadata(synced.session);
      if (synced.localChanged) window.setTimeout(() => window.location.reload(), 350);
    } catch (reason) {
      setError(friendlyError(reason));
    } finally {
      setBusy(null);
    }
  };

  const copyRecovery = async () => {
    await navigator.clipboard.writeText(recoveryCode);
    setMessage('Recovery-код скопирован.');
  };

  const revoke = async (id: string) => {
    setBusy('revoke');
    setError('');
    try {
      const result = await revokeAccountDevice(id);
      if (result.currentDeviceRevoked) {
        clearAccountSession();
        setMetadata(null);
        setOpen(false);
      } else {
        await loadMetadata();
      }
    } catch (reason) {
      setError(friendlyError(reason));
    } finally {
      setBusy(null);
    }
  };

  const disconnect = () => {
    clearAccountSession();
    setMetadata(null);
    setMessage('Аккаунт отключён только на этом устройстве. Локальный прогресс сохранён.');
  };

  const destroyAccount = async () => {
    if (deleteConfirm !== 'УДАЛИТЬ') return;
    setBusy('delete');
    setError('');
    try {
      await deleteCloudAccount();
      setMetadata(null);
      setDeleteConfirm('');
      setScreen('overview');
      setMessage('Облачный аккаунт и его данные удалены. Локальный прогресс остался на устройстве.');
    } catch (reason) {
      setError(friendlyError(reason));
    } finally {
      setBusy(null);
    }
  };

  const trigger = <button
    type="button"
    className={`account-trigger ${connected ? 'connected' : ''}`}
    aria-label={statusLabel}
    data-testid="account-trigger"
    onClick={() => {
      setScreen(loadAccountSession() ? 'account' : 'overview');
      setOpen(true);
      setError('');
      if (loadAccountSession()) void loadMetadata();
    }}
  >
    {connected ? <Cloud size={18} /> : <CloudOff size={18} />}
    <span>{connected ? 'Sync' : 'Аккаунт'}</span>
  </button>;

  const modal = open ? <div className="account-modal-backdrop" onMouseDown={event => {
    if (event.currentTarget === event.target && !busy) setOpen(false);
  }}>
    <section className="account-modal" role="dialog" aria-modal="true" aria-labelledby="account-modal-title" data-testid="account-modal">
      <header className="account-modal-header">
        <div>
          <span className="account-kicker">Privacy-first sync</span>
          <h2 id="account-modal-title">Облачный аккаунт</h2>
        </div>
        <button className="icon" onClick={() => setOpen(false)} disabled={Boolean(busy)} aria-label="Закрыть аккаунт"><X /></button>
      </header>

      {message && <div className="account-notice success"><Check size={18} />{message}</div>}
      {error && <div className="account-notice error"><ShieldCheck size={18} />{error}</div>}

      {screen === 'overview' && <div className="account-screen">
        <div className="account-hero-icon"><KeyRound /></div>
        <h3>Один прогресс на всех устройствах</h3>
        <p>Без email, SMS, имени и внешних аккаунтов. Доступ восстанавливается только по длинному recovery-коду.</p>
        <div className="account-choice-grid">
          <button className="account-choice primary" onClick={() => void beginCreate()} disabled={Boolean(busy)}>
            <ShieldCheck /><strong>Создать аккаунт</strong><span>Сгенерировать новый recovery-код</span>
          </button>
          <button className="account-choice" onClick={() => { setScreen('connect'); setEnteredCode(''); }}>
            <Link2 /><strong>Подключить существующий</strong><span>Ввести код с другого устройства</span>
          </button>
        </div>
        <div className="account-security-note"><ShieldCheck size={18} />Сервер хранит только криптографические проверочные значения и отдельные отзываемые токены устройств.</div>
      </div>}

      {screen === 'create' && <div className="account-screen">
        <button className="account-back" onClick={() => setScreen('overview')}>← Назад</button>
        <h3>Сохрани recovery-код</h3>
        <p>Он показывается для переноса аккаунта. Без него подключить новое устройство будет невозможно.</p>
        <div className="recovery-code" data-testid="recovery-code">{recoveryCode}</div>
        <div className="account-inline-actions">
          <button onClick={() => void copyRecovery()}><Copy />Копировать</button>
          <button onClick={() => recoveryCodeDownload(recoveryCode)}><Download />Скачать файл</button>
        </div>
        <label className="account-field">
          <span>Название этого устройства</span>
          <input value={deviceName} maxLength={48} onChange={event => setDeviceName(event.target.value)} />
        </label>
        <label className="account-checkbox">
          <input type="checkbox" checked={codeSaved} onChange={event => setCodeSaved(event.target.checked)} />
          <span>Я сохранил recovery-код в безопасном месте</span>
        </label>
        <button className="account-primary" data-testid="create-account-confirm" disabled={!codeSaved || busy === 'create'} onClick={() => void createAccount()}>
          {busy === 'create' ? <LoaderCircle className="spin" /> : <Cloud />}Создать и загрузить прогресс
        </button>
      </div>}

      {screen === 'created' && <div className="account-screen account-success-screen">
        <div className="account-hero-icon success"><Check /></div>
        <h3>Аккаунт готов</h3>
        <p>{message}</p>
        <div className="recovery-code compact">{recoveryCode}</div>
        <button className="account-primary" onClick={() => { setScreen('account'); void loadMetadata(); }}>Открыть центр синхронизации</button>
      </div>}

      {screen === 'connect' && <div className="account-screen">
        <button className="account-back" onClick={() => setScreen('overview')}>← Назад</button>
        <h3>Подключить это устройство</h3>
        <p>Введи recovery-код, созданный на другом устройстве. Прогресс будет объединён, а не заменён вслепую.</p>
        <label className="account-field">
          <span>Recovery-код</span>
          <textarea data-testid="recovery-input" rows={3} value={enteredCode} onChange={event => setEnteredCode(event.target.value.toUpperCase())} placeholder="SQLA-XXXX-XXXX-…" />
        </label>
        <label className="account-field">
          <span>Название этого устройства</span>
          <input value={deviceName} maxLength={48} onChange={event => setDeviceName(event.target.value)} />
        </label>
        <button className="account-primary" data-testid="connect-account-confirm" disabled={!enteredCode.trim() || busy === 'connect'} onClick={() => void connectExisting()}>
          {busy === 'connect' ? <LoaderCircle className="spin" /> : <Link2 />}Подключить и объединить прогресс
        </button>
      </div>}

      {screen === 'account' && <div className="account-screen">
        <div className="account-status-card">
          <div className="account-hero-icon success"><Cloud /></div>
          <div><strong>Синхронизация активна</strong><span>Аккаунт · {metadata?.account.idHint || session?.accountId.slice(0, 8)}</span></div>
          <span className="account-online-dot">online</span>
        </div>
        <div className="account-stats">
          <div><span>Revision</span><strong>{metadata?.account.revision ?? session?.revision ?? 0}</strong></div>
          <div><span>Последняя синхронизация</span><strong>{formatDate(session?.lastSyncAt)}</strong></div>
        </div>
        <button className="account-primary" disabled={busy === 'sync'} onClick={() => void runSync()}>
          {busy === 'sync' ? <LoaderCircle className="spin" /> : <RefreshCw />}Синхронизировать сейчас
        </button>

        <div className="account-section-heading"><div><h4>Подключённые устройства</h4><p>Каждое устройство имеет отдельный отзываемый токен.</p></div><button className="icon" onClick={() => void loadMetadata()} aria-label="Обновить устройства"><RefreshCw /></button></div>
        <div className="device-list">
          {(metadata?.devices || []).map(device => <div className="device-row" key={device.id}>
            <MonitorSmartphone />
            <div><strong>{device.name}{device.current ? ' · это устройство' : ''}</strong><span>Активность: {formatDate(device.lastSeenAt)}</span></div>
            <button className="icon danger" disabled={busy === 'revoke'} onClick={() => void revoke(device.id)} aria-label={`Отключить ${device.name}`}><Unplug /></button>
          </div>)}
          {!metadata && <div className="account-loading"><LoaderCircle className="spin" />Загружаю список устройств…</div>}
        </div>

        <div className="account-danger-zone">
          <button onClick={disconnect}><LogOut />Отключить только это устройство</button>
          <button className="danger" onClick={() => setScreen('delete')}><Trash2 />Удалить облачный аккаунт</button>
        </div>
      </div>}

      {screen === 'delete' && <div className="account-screen">
        <button className="account-back" onClick={() => setScreen('account')}>← Назад</button>
        <div className="account-hero-icon danger"><Trash2 /></div>
        <h3>Удалить облачный аккаунт?</h3>
        <p>Будут удалены серверный прогресс и все токены устройств. Локальный прогресс на этом устройстве останется.</p>
        <label className="account-field">
          <span>Для подтверждения введи УДАЛИТЬ</span>
          <input value={deleteConfirm} onChange={event => setDeleteConfirm(event.target.value.toUpperCase())} />
        </label>
        <button className="account-primary danger" disabled={deleteConfirm !== 'УДАЛИТЬ' || busy === 'delete'} onClick={() => void destroyAccount()}>
          {busy === 'delete' ? <LoaderCircle className="spin" /> : <Trash2 />}Удалить аккаунт навсегда
        </button>
      </div>}
    </section>
  </div> : null;

  return <>
    {slot ? createPortal(trigger, slot) : <div className="account-trigger-floating">{trigger}</div>}
    {modal && createPortal(modal, document.body)}
  </>;
}
