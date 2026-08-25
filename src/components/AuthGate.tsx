import { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Check,
  Cloud,
  Copy,
  Download,
  Eye,
  EyeOff,
  KeyRound,
  LoaderCircle,
  Lock,
  LogIn,
  LogOut,
  MonitorSmartphone,
  RefreshCw,
  Save,
  ShieldCheck,
  Trash2,
  Unplug,
  User,
  X
} from 'lucide-react';
import {
  AUTH_CHANGED_EVENT,
  AuthResponse,
  AuthSession,
  changePassword,
  clearAuthSession,
  deleteUserAccount,
  fetchUserSessions,
  loadAuthSession,
  loginUser,
  logoutUser,
  recoveryCodesDownload,
  RecoverySummary,
  regenerateRecoveryCodes,
  registerUser,
  resetPassword,
  revokeUserSession,
  saveAuthSession,
  sessionFromResponse,
  syncUserProgress,
  updateUserProfile,
  UserDeviceSession,
  validateSession
} from '../lib/auth';
import { useDialogFocus } from '../lib/dialog-focus';

const PENDING_REGISTRATION_KEY = 'sql-academy-pending-registration-v1';
const PENDING_RECOVERY_KEY = 'sql-academy-pending-recovery-v1';
const PROGRESS_CHANGED_EVENT = 'sql-academy-progress-changed';

type AuthMode = 'login' | 'register' | 'reset';
type GateState = 'loading' | 'guest' | 'recovery' | 'authenticated' | 'local-unverified';
type ProfileTab = 'profile' | 'security' | 'sessions';

type PendingRegistration = {
  response: AuthResponse;
  recoveryCodes: string[];
};

function pendingRegistration(): PendingRegistration | null {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(PENDING_REGISTRATION_KEY) || 'null') as PendingRegistration | null;
    return parsed?.response?.session?.token && parsed.recoveryCodes?.length === 8 ? parsed : null;
  } catch {
    return null;
  }
}

function friendlyError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('Failed to fetch')) return 'Cloudflare API сейчас недоступен. Проверь подключение и попробуй снова.';
  if (message.includes('Authentication is required') || message.includes('Session expired')) return 'Сессия завершена. Войди снова.';
  return message || 'Не удалось выполнить действие.';
}

function formatDate(value?: string | null) {
  if (!value) return '—';
  const normalized = value.includes('T') ? value : `${value.replace(' ', 'T')}Z`;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
  }).format(date);
}

function passwordValid(password: string) {
  const length = Array.from(password).length;
  return length >= 15 && length <= 128 && new TextEncoder().encode(password).byteLength <= 512;
}

function RecoveryCodesPanel({
  codes,
  title,
  onConfirmed
}: {
  codes: string[];
  title: string;
  onConfirmed: () => void;
}) {
  const [saved, setSaved] = useState(false);
  const [message, setMessage] = useState('');

  const copyAll = async () => {
    await navigator.clipboard.writeText(codes.join('\n'));
    setMessage('Все recovery-коды скопированы.');
  };

  return <section className="recovery-screen" data-testid="recovery-codes-screen">
    <div className="auth-hero-icon success"><ShieldCheck /></div>
    <span className="auth-kicker">Показываются один раз</span>
    <h1>{title}</h1>
    <p>Каждый код одноразовый. Он потребуется, если ты забудешь пароль или решишь его изменить. Без оставшегося кода восстановить доступ невозможно.</p>
    <div className="recovery-grid" data-testid="recovery-codes">
      {codes.map((code, index) => <code key={code}><span>{index + 1}</span>{code}</code>)}
    </div>
    <div className="recovery-actions">
      <button type="button" onClick={() => void copyAll()}><Copy />Копировать все</button>
      <button type="button" onClick={() => recoveryCodesDownload(codes)}><Download />Скачать .txt</button>
    </div>
    {message && <div className="auth-notice success" role="status"><Check />{message}</div>}
    <label className="auth-checkbox">
      <input type="checkbox" checked={saved} onChange={event => setSaved(event.target.checked)} />
      <span>Я сохранил все 8 кодов в безопасном месте и понимаю, что они больше не будут показаны</span>
    </label>
    <button type="button" className="auth-primary" data-testid="recovery-confirm" disabled={!saved} onClick={onConfirmed}>
      <Check />Подтвердить и продолжить
    </button>
  </section>;
}

function AuthScreen({ onAuthenticated }: { onAuthenticated: (session: AuthSession) => void }) {
  const [mode, setMode] = useState<AuthMode>('login');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const clearFeedback = () => {
    setError('');
    setMessage('');
  };

  const switchMode = (next: AuthMode) => {
    setMode(next);
    setPassword('');
    setConfirmPassword('');
    setRecoveryCode('');
    clearFeedback();
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    clearFeedback();
    try {
      if (mode === 'login') {
        const { session } = await loginUser(username, password);
        onAuthenticated(session);
        return;
      }
      if (password !== confirmPassword) throw new Error('Пароли не совпадают.');
      if (!passwordValid(password)) throw new Error('Пароль должен содержать от 15 до 128 символов.');
      if (mode === 'register') {
        const response = await registerUser({ username, password, displayName });
        if (!response.recoveryCodes || response.recoveryCodes.length !== 8) throw new Error('Сервер не вернул полный комплект recovery-кодов.');
        const pending = { response, recoveryCodes: response.recoveryCodes };
        sessionStorage.setItem(PENDING_REGISTRATION_KEY, JSON.stringify(pending));
        window.dispatchEvent(new CustomEvent('sql-academy-registration-pending', { detail: pending }));
        return;
      }
      await resetPassword(username, recoveryCode, password);
      setMessage('Пароль изменён. Все старые сессии отключены — теперь войди с новым паролем.');
      setMode('login');
      setPassword('');
      setConfirmPassword('');
      setRecoveryCode('');
    } catch (reason) {
      setError(friendlyError(reason));
    } finally {
      setBusy(false);
    }
  };

  return <main className="auth-shell">
    <section className="auth-brand-panel">
      <div className="auth-brand"><img src={`${import.meta.env.BASE_URL}logo.svg`} alt="" /><strong>SQL Academy</strong></div>
      <div className="auth-brand-copy">
        <span className="auth-kicker">Бесплатная SQL-платформа</span>
        <h1>Учись решать рабочие SQL-задачи.</h1>
        <p>240 проверяемых задач, 44 связанных урока, адаптивное повторение и локальный SQLite прямо в браузере.</p>
        <div className="auth-account-reason" data-testid="account-reason">
          <ShieldCheck />
          <span><strong>Зачем вход до первой задачи</strong><small>Аккаунт сохраняет попытки и результаты проверок без потери или смешивания прогресса между устройствами. Платформа бесплатна, карта не нужна.</small></span>
        </div>
        <div className="auth-proof"><span><ShieldCheck />без рекламы и оплаты</span><span><Cloud />прогресс между устройствами</span><span><KeyRound />без обязательного email</span></div>
      </div>
      <small>Пароль не передаётся и не хранится в открытом виде. Recovery-коды одноразовые.</small>
    </section>

    <section className="auth-form-panel">
      <div className="auth-tabs" role="group" aria-label="Режим авторизации">
        <button type="button" aria-pressed={mode === 'login'} className={mode === 'login' ? 'active' : ''} onClick={() => switchMode('login')}>Вход</button>
        <button type="button" aria-pressed={mode === 'register'} className={mode === 'register' ? 'active' : ''} onClick={() => switchMode('register')}>Регистрация</button>
      </div>
      <form className="auth-form" onSubmit={event => void submit(event)}>
        <div className="auth-hero-icon">{mode === 'register' ? <User /> : mode === 'reset' ? <KeyRound /> : <Lock />}</div>
        <span className="auth-kicker">{mode === 'register' ? 'Новый профиль' : mode === 'reset' ? 'Одноразовый recovery-код' : 'Защищённая сессия'}</span>
        <h2>{mode === 'register' ? 'Создать аккаунт' : mode === 'reset' ? 'Сбросить пароль' : 'Войти в академию'}</h2>
        <p>{mode === 'register'
          ? 'Email и SMS не нужны. Придумай логин и длинный пароль.'
          : mode === 'reset'
            ? 'Один сохранённый код будет навсегда помечен использованным.'
            : 'Продолжи обучение с синхронизированным прогрессом.'}</p>

        <label className="auth-field">
          <span>Логин</span>
          <input data-testid="auth-username" autoCapitalize="none" autoCorrect="off" spellCheck={false} autoComplete="username" value={username} onChange={event => setUsername(event.target.value.toLowerCase())} placeholder="например, sql_engineer" required />
          {mode === 'register' && <small>3–32 символа: латинские буквы, цифры, точка, дефис или _</small>}
        </label>

        {mode === 'register' && <label className="auth-field">
          <span>Отображаемое имя <em>необязательно</em></span>
          <input value={displayName} maxLength={48} onChange={event => setDisplayName(event.target.value)} autoComplete="name" placeholder="Как обращаться внутри приложения" />
        </label>}

        {mode === 'reset' && <label className="auth-field">
          <span>Неиспользованный recovery-код</span>
          <input data-testid="auth-recovery" value={recoveryCode} onChange={event => setRecoveryCode(event.target.value.toUpperCase())} autoComplete="off" placeholder="SQLR-XXXX-XXXX-…" required />
        </label>}

        <label className="auth-field">
          <span>{mode === 'reset' ? 'Новый пароль' : 'Пароль'}</span>
          <div className="password-field">
            <input data-testid="auth-password" type={showPassword ? 'text' : 'password'} value={password} onChange={event => setPassword(event.target.value)} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} minLength={mode === 'login' ? undefined : 15} maxLength={128} required />
            <button type="button" onClick={() => setShowPassword(value => !value)} aria-label={showPassword ? 'Скрыть пароль' : 'Показать пароль'}>{showPassword ? <EyeOff /> : <Eye />}</button>
          </div>
          {mode !== 'login' && <small className={password && !passwordValid(password) ? 'invalid' : ''}>15–128 символов. Разрешены пробелы, Unicode и любые печатные символы.</small>}
        </label>

        {mode !== 'login' && <label className="auth-field">
          <span>Повтори пароль</span>
          <input data-testid="auth-password-confirm" type={showPassword ? 'text' : 'password'} value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} autoComplete="new-password" minLength={15} maxLength={128} required />
        </label>}

        {error && <div className="auth-notice error" role="alert"><ShieldCheck />{error}</div>}
        {message && <div className="auth-notice success" role="status"><Check />{message}</div>}

        <button data-testid="auth-submit" className="auth-primary" disabled={busy || (mode !== 'login' && (!passwordValid(password) || password !== confirmPassword))}>
          {busy ? <LoaderCircle className="spin" /> : mode === 'register' ? <User /> : mode === 'reset' ? <KeyRound /> : <LogIn />}
          {mode === 'register' ? 'Создать аккаунт' : mode === 'reset' ? 'Изменить пароль' : 'Войти'}
        </button>

        {mode === 'login' && <button type="button" className="auth-link" onClick={() => switchMode('reset')}>Забыл пароль или хочу его сменить</button>}
        {mode === 'reset' && <button type="button" className="auth-link" onClick={() => switchMode('login')}>← Вернуться ко входу</button>}
      </form>
    </section>
  </main>;
}

function ProfilePortal({ session, onSessionChange }: { session: AuthSession; onSessionChange: (session: AuthSession | null) => void }) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<ProfileTab>('profile');
  const [displayName, setDisplayName] = useState(session.displayName);
  const [dailyMinutes, setDailyMinutes] = useState<15 | 25 | 40>(session.dailyMinutes);
  const [locale, setLocale] = useState<'ru-RU' | 'en-US'>(session.locale);
  const [theme, setTheme] = useState<'dark' | 'light' | 'system'>(session.theme);
  const [sessions, setSessions] = useState<UserDeviceSession[]>([]);
  const [recovery, setRecovery] = useState<RecoverySummary>({ remaining: 0, generatedAt: null, canRegenerateAt: null });
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [generatedCodes, setGeneratedCodes] = useState<string[]>(() => {
    try { return JSON.parse(sessionStorage.getItem(PENDING_RECOVERY_KEY) || '[]') as string[]; } catch { return []; }
  });
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const modalRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const mount = () => {
      const legacy = document.querySelector<HTMLButtonElement>('[aria-label="Синхронизировать прогресс"]');
      if (!legacy?.parentElement) return null;
      legacy.hidden = true;
      const target = document.createElement('span');
      target.className = 'profile-portal-slot';
      legacy.insertAdjacentElement('afterend', target);
      setSlot(target);
      return () => { legacy.hidden = false; target.remove(); };
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

  const refresh = useCallback(async () => {
    setBusy('refresh');
    try {
      const [{ info, session: next }, deviceResult] = await Promise.all([validateSession(), fetchUserSessions()]);
      setRecovery(info.recovery);
      setSessions(deviceResult.sessions);
      setDisplayName(next.displayName);
      setDailyMinutes(next.dailyMinutes);
      setLocale(next.locale);
      setTheme(next.theme);
      onSessionChange(next);
      setError('');
    } catch (reason) {
      setError(friendlyError(reason));
    } finally {
      setBusy('');
    }
  }, [onSessionChange]);

  useEffect(() => {
    if (open) void refresh();
  }, [open, refresh]);

  useDialogFocus(open, modalRef, () => setOpen(false));

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, [open]);

  const saveProfile = async () => {
    setBusy('profile'); setError(''); setMessage('');
    try {
      await updateUserProfile({ displayName, dailyMinutes, locale, theme });
      if (theme === 'dark' || theme === 'light') {
        localStorage.setItem('sql-theme', theme);
        document.documentElement.dataset.theme = theme;
      }
      const next = loadAuthSession();
      if (next) onSessionChange(next);
      setMessage('Настройки профиля сохранены.');
    } catch (reason) { setError(friendlyError(reason)); }
    finally { setBusy(''); }
  };

  const runSync = async () => {
    setBusy('sync'); setError(''); setMessage('');
    try {
      const result = await syncUserProgress();
      onSessionChange(result.session);
      setMessage(result.localChanged ? 'Локальный и облачный прогресс объединены.' : 'Прогресс синхронизирован.');
      if (result.localChanged) window.setTimeout(() => window.location.reload(), 300);
    } catch (reason) { setError(friendlyError(reason)); }
    finally { setBusy(''); }
  };

  const submitPasswordChange = async () => {
    setError(''); setMessage('');
    if (newPassword !== confirmPassword) { setError('Новые пароли не совпадают.'); return; }
    if (!passwordValid(newPassword)) { setError('Новый пароль должен содержать 15–128 символов.'); return; }
    setBusy('password');
    try {
      await changePassword(currentPassword, recoveryCode, newPassword);
      onSessionChange(null);
    } catch (reason) { setError(friendlyError(reason)); }
    finally { setBusy(''); }
  };

  const regenerate = async () => {
    setBusy('recovery'); setError(''); setMessage('');
    try {
      const result = await regenerateRecoveryCodes(currentPassword);
      sessionStorage.setItem(PENDING_RECOVERY_KEY, JSON.stringify(result.recoveryCodes));
      setGeneratedCodes(result.recoveryCodes);
      setRecovery(result.recovery);
      setCurrentPassword('');
    } catch (reason) { setError(friendlyError(reason)); }
    finally { setBusy(''); }
  };

  const revoke = async (id: string) => {
    setBusy('revoke'); setError('');
    try {
      const result = await revokeUserSession(id);
      if (result.currentSessionRevoked) onSessionChange(null);
      else await refresh();
    } catch (reason) { setError(friendlyError(reason)); }
    finally { setBusy(''); }
  };

  const destroy = async () => {
    if (deleteConfirm !== 'DELETE') return;
    setBusy('delete'); setError('');
    try {
      await deleteUserAccount(currentPassword, recoveryCode);
      onSessionChange(null);
    } catch (reason) { setError(friendlyError(reason)); }
    finally { setBusy(''); }
  };

  const trigger = <button type="button" className="profile-trigger" data-testid="profile-trigger" onClick={() => setOpen(true)} aria-label="Открыть профиль">
    <span>{(session.displayName || session.username).slice(0, 1).toUpperCase()}</span>
    <b>{session.displayName || session.username}</b>
  </button>;

  const modal = open ? <div className="profile-backdrop" onMouseDown={event => {
    if (event.currentTarget === event.target && !busy) setOpen(false);
  }}>
    <section ref={modalRef} tabIndex={-1} className="profile-modal" role="dialog" aria-modal="true" aria-labelledby="profile-title" data-testid="profile-modal">
      <header className="profile-header">
        <div><span className="auth-kicker">Аккаунт · @{session.username}</span><h2 id="profile-title">Настройки профиля</h2></div>
        <button type="button" className="icon" data-autofocus onClick={() => setOpen(false)} aria-label="Закрыть профиль"><X /></button>
      </header>
      <nav className="profile-tabs" aria-label="Разделы профиля">
        <button aria-pressed={tab === 'profile'} className={tab === 'profile' ? 'active' : ''} onClick={() => setTab('profile')}><User />Профиль</button>
        <button aria-pressed={tab === 'security'} className={tab === 'security' ? 'active' : ''} onClick={() => setTab('security')}><ShieldCheck />Безопасность</button>
        <button aria-pressed={tab === 'sessions'} className={tab === 'sessions' ? 'active' : ''} onClick={() => setTab('sessions')}><MonitorSmartphone />Сессии</button>
      </nav>
      {error && <div className="auth-notice error profile-notice" role="alert"><ShieldCheck />{error}</div>}
      {message && <div className="auth-notice success profile-notice" role="status" aria-live="polite"><Check />{message}</div>}

      {tab === 'profile' && <div className="profile-body">
        <div className="profile-summary"><div>{(session.displayName || session.username).slice(0, 1).toUpperCase()}</div><span><strong>{session.displayName || session.username}</strong><small>@{session.username}</small></span></div>
        <label className="auth-field"><span>Отображаемое имя</span><input value={displayName} maxLength={48} onChange={event => setDisplayName(event.target.value)} /></label>
        <div className="profile-grid">
          <label className="auth-field"><span>Длительность учебной сессии</span><select value={dailyMinutes} onChange={event => setDailyMinutes(Number(event.target.value) as 15 | 25 | 40)}><option value={15}>15 минут</option><option value={25}>25 минут</option><option value={40}>40 минут</option></select></label>
          <label className="auth-field"><span>Язык профиля</span><select value={locale} onChange={event => setLocale(event.target.value as 'ru-RU' | 'en-US')}><option value="ru-RU">Русский</option><option value="en-US">English</option></select></label>
          <label className="auth-field"><span>Тема</span><select value={theme} onChange={event => setTheme(event.target.value as 'dark' | 'light' | 'system')}><option value="dark">Тёмная</option><option value="light">Светлая</option><option value="system">Системная</option></select></label>
        </div>
        <button className="auth-primary" onClick={() => void saveProfile()} disabled={busy === 'profile'}>{busy === 'profile' ? <LoaderCircle className="spin" /> : <Save />}Сохранить профиль</button>
        <button className="profile-sync" onClick={() => void runSync()} disabled={busy === 'sync'}>{busy === 'sync' ? <LoaderCircle className="spin" /> : <Cloud />}Синхронизировать прогресс сейчас</button>
      </div>}

      {tab === 'security' && <div className="profile-body security-stack">
        <article className="security-card">
          <div><Lock /><span><h3>Изменить пароль</h3><p>Нужны текущий пароль и один неиспользованный recovery-код. Код будет израсходован, все устройства — отключены.</p></span></div>
          <label className="auth-field"><span>Текущий пароль</span><input type="password" value={currentPassword} onChange={event => setCurrentPassword(event.target.value)} autoComplete="current-password" /></label>
          <label className="auth-field"><span>Recovery-код</span><input value={recoveryCode} onChange={event => setRecoveryCode(event.target.value.toUpperCase())} placeholder="SQLR-XXXX-…" /></label>
          <label className="auth-field"><span>Новый пароль</span><input type="password" minLength={15} maxLength={128} value={newPassword} onChange={event => setNewPassword(event.target.value)} autoComplete="new-password" /></label>
          <label className="auth-field"><span>Повтори новый пароль</span><input type="password" minLength={15} maxLength={128} value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} autoComplete="new-password" /></label>
          <button className="auth-primary" onClick={() => void submitPasswordChange()} disabled={busy === 'password'}>{busy === 'password' ? <LoaderCircle className="spin" /> : <KeyRound />}Изменить пароль и выйти везде</button>
        </article>

        <article className="security-card">
          <div><ShieldCheck /><span><h3>Recovery-коды</h3><p>Осталось активных: <strong>{recovery.remaining}</strong>. Последний комплект: {formatDate(recovery.generatedAt)}.</p></span></div>
          <p className="security-muted">Новый комплект аннулирует все старые коды. Генерация доступна не чаще одного раза в 24 часа. Следующая дата: {formatDate(recovery.canRegenerateAt)}.</p>
          <label className="auth-field"><span>Текущий пароль для подтверждения</span><input type="password" value={currentPassword} onChange={event => setCurrentPassword(event.target.value)} autoComplete="current-password" /></label>
          <button className="profile-sync" onClick={() => void regenerate()} disabled={busy === 'recovery'}>{busy === 'recovery' ? <LoaderCircle className="spin" /> : <RefreshCw />}Создать 8 новых кодов</button>
        </article>

        <article className="security-card danger-card">
          <div><Trash2 /><span><h3>Удалить аккаунт</h3><p>Облачный прогресс, профиль, recovery-коды и все сессии будут удалены. Локальный прогресс останется в браузере.</p></span></div>
          <label className="auth-field"><span>Текущий пароль</span><input type="password" value={currentPassword} onChange={event => setCurrentPassword(event.target.value)} /></label>
          <label className="auth-field"><span>Recovery-код</span><input value={recoveryCode} onChange={event => setRecoveryCode(event.target.value.toUpperCase())} /></label>
          <label className="auth-field"><span>Введи DELETE</span><input value={deleteConfirm} onChange={event => setDeleteConfirm(event.target.value.toUpperCase())} /></label>
          <button className="auth-danger" onClick={() => void destroy()} disabled={deleteConfirm !== 'DELETE' || busy === 'delete'}><Trash2 />Удалить аккаунт</button>
        </article>
      </div>}

      {tab === 'sessions' && <div className="profile-body">
        <div className="session-heading"><div><h3>Активные устройства</h3><p>Каждый вход получает отдельный отзываемый токен.</p></div><button className="icon" onClick={() => void refresh()} aria-label="Обновить список сессий"><RefreshCw /></button></div>
        <div className="session-list">
          {sessions.map(item => <article key={item.id}>
            <MonitorSmartphone /><span><strong>{item.deviceName}{item.current ? ' · это устройство' : ''}</strong><small>Активность: {formatDate(item.lastSeenAt)} · до {formatDate(item.expiresAt)}</small></span>
            <button className="icon danger" onClick={() => void revoke(item.id)} disabled={busy === 'revoke'} aria-label={`Отключить ${item.deviceName}`}><Unplug /></button>
          </article>)}
          {!sessions.length && <div className="auth-loading"><LoaderCircle className="spin" />Загружаю сессии…</div>}
        </div>
        <button className="profile-logout" onClick={() => void logoutUser().then(() => onSessionChange(null))}><LogOut />Выйти на этом устройстве</button>
      </div>}
    </section>
  </div> : null;

  const recoveryModal = generatedCodes.length === 8 ? <div className="profile-backdrop recovery-overlay">
    <div className="profile-modal recovery-modal"><RecoveryCodesPanel codes={generatedCodes} title="Новый комплект recovery-кодов" onConfirmed={() => {
      sessionStorage.removeItem(PENDING_RECOVERY_KEY);
      setGeneratedCodes([]);
      setMessage('Новый комплект сохранён. Все прежние коды недействительны.');
    }} /></div>
  </div> : null;

  return <>
    {slot ? createPortal(trigger, slot) : <div className="profile-trigger-floating">{trigger}</div>}
    {modal && createPortal(modal, document.body)}
    {recoveryModal && createPortal(recoveryModal, document.body)}
  </>;
}

export default function AuthGate({ children }: { children: ReactNode }) {
  const initialPending = useMemo(() => pendingRegistration(), []);
  const [state, setState] = useState<GateState>(initialPending ? 'recovery' : 'loading');
  const [session, setSession] = useState<AuthSession | null>(() => loadAuthSession());
  const [pending, setPending] = useState<PendingRegistration | null>(initialPending);
  const syncTimer = useRef<number | null>(null);
  const verificationRunning = useRef(false);
  const verificationQueued = useRef(false);

  const setAuthenticated = useCallback((next: AuthSession | null) => {
    setSession(next);
    setState(next ? 'authenticated' : 'guest');
  }, []);

  const useLocalSession = useCallback((next: AuthSession) => {
    setSession(next);
    setState('local-unverified');
  }, []);

  const verifyStoredSession = useCallback(async function verify() {
    if (verificationRunning.current) {
      verificationQueued.current = true;
      return;
    }
    const stored = loadAuthSession();
    if (!stored) {
      setAuthenticated(null);
      return;
    }

    verificationRunning.current = true;
    try {
      const { session: validated } = await validateSession();
      try {
        const synced = await syncUserProgress(validated);
        setAuthenticated(synced.session);
      } catch (error) {
        if ((error as Error & { status?: number }).status === 401) throw error;
        setAuthenticated(validated);
      }
    } catch (error) {
      if ((error as Error & { status?: number }).status === 401) {
        clearAuthSession();
        setAuthenticated(null);
        return;
      }
      const cached = loadAuthSession();
      if (cached) useLocalSession(cached);
      else setAuthenticated(null);
    } finally {
      verificationRunning.current = false;
      if (verificationQueued.current) {
        verificationQueued.current = false;
        window.setTimeout(() => void verify(), 0);
      }
    }
  }, [setAuthenticated, useLocalSession]);

  useEffect(() => {
    const registrationHandler = (event: Event) => {
      const next = (event as CustomEvent<PendingRegistration>).detail;
      setPending(next);
      setState('recovery');
    };
    const authHandler = (event: Event) => {
      const next = (event as CustomEvent<AuthSession | null>).detail;
      if (!next) setAuthenticated(null);
      else { setSession(next); setState('authenticated'); }
    };
    window.addEventListener('sql-academy-registration-pending', registrationHandler);
    window.addEventListener(AUTH_CHANGED_EVENT, authHandler);
    return () => {
      window.removeEventListener('sql-academy-registration-pending', registrationHandler);
      window.removeEventListener(AUTH_CHANGED_EVENT, authHandler);
    };
  }, [setAuthenticated]);

  useEffect(() => {
    if (pending) return;
    void verifyStoredSession();
  }, [pending, verifyStoredSession]);

  useEffect(() => {
    if (pending) return;
    const verifyIfReachable = () => {
      if (navigator.onLine && loadAuthSession()) void verifyStoredSession();
    };
    window.addEventListener('online', verifyIfReachable);
    return () => window.removeEventListener('online', verifyIfReachable);
  }, [pending, verifyStoredSession]);

  useEffect(() => {
    if (pending || state !== 'local-unverified') return;
    let retries = 0;
    const verifyIfReachable = () => {
      if (navigator.onLine) void verifyStoredSession();
    };
    const verifyVisible = () => {
      if (document.visibilityState === 'visible') verifyIfReachable();
    };
    const retryTimer = window.setInterval(() => {
      retries += 1;
      verifyIfReachable();
      if (retries >= 6) window.clearInterval(retryTimer);
    }, 3_000);
    window.addEventListener('focus', verifyIfReachable);
    document.addEventListener('visibilitychange', verifyVisible);
    return () => {
      window.clearInterval(retryTimer);
      window.removeEventListener('focus', verifyIfReachable);
      document.removeEventListener('visibilitychange', verifyVisible);
    };
  }, [pending, state, verifyStoredSession]);

  useEffect(() => {
    if (state !== 'authenticated' || !session) return;
    const run = async () => {
      try {
        const result = await syncUserProgress(loadAuthSession());
        setSession(result.session);
        if (result.localChanged) {
          window.dispatchEvent(new CustomEvent(PROGRESS_CHANGED_EVENT, { detail: result.progress }));
        }
      } catch (error) {
        if ((error as Error & { status?: number }).status === 401) setAuthenticated(null);
      }
    };
    void run();
    const progressChanged = () => {
      if (syncTimer.current) window.clearTimeout(syncTimer.current);
      syncTimer.current = window.setTimeout(() => void run(), 1600);
    };
    window.addEventListener(PROGRESS_CHANGED_EVENT, progressChanged);
    return () => {
      window.removeEventListener(PROGRESS_CHANGED_EVENT, progressChanged);
      if (syncTimer.current) window.clearTimeout(syncTimer.current);
    };
  }, [session?.userId, session?.token, setAuthenticated, state]);

  if (state === 'loading') return <div className="auth-loading-screen"><img src={`${import.meta.env.BASE_URL}logo.svg`} alt="" /><LoaderCircle className="spin" /><span>Проверяю защищённую сессию…</span></div>;
  if (state === 'guest') return <AuthScreen onAuthenticated={setAuthenticated} />;
  if (state === 'recovery' && pending) return <main className="auth-shell recovery-shell"><RecoveryCodesPanel codes={pending.recoveryCodes} title="Сохрани 8 recovery-кодов" onConfirmed={() => {
    const next = sessionFromResponse(pending.response);
    sessionStorage.removeItem(PENDING_REGISTRATION_KEY);
    setPending(null);
    saveAuthSession(next);
    setAuthenticated(next);
  }} /></main>;
  if (!session) return <AuthScreen onAuthenticated={setAuthenticated} />;

  return <>
    {state === 'local-unverified' && <section className="auth-local-session-notice" role="status" aria-live="polite" data-testid="auth-local-session-notice">
      <Unplug aria-hidden="true" />
      <div>
        <strong>Локальная сессия — без подтверждения сервера</strong>
        <p>Задания и локальный SQLite доступны. Изменения сохраняются на этом устройстве и пока не синхронизированы; профиль и облачные функции вернутся после проверки подключения.</p>
      </div>
    </section>}
    {children}
    {state === 'authenticated' && <ProfilePortal session={session} onSessionChange={setAuthenticated} />}
  </>;
}
