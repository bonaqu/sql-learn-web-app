import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  Cloud,
  Eye,
  EyeOff,
  KeyRound,
  LoaderCircle,
  Lock,
  LogIn,
  Mail,
  Phone,
  ShieldCheck,
  User
} from 'lucide-react';
import {
  type AuthResponse,
  type AuthSession,
  loginUser,
  registerUser,
  resetPassword,
  saveAuthSession,
  sessionFromResponse
} from '../lib/auth';
import {
  type CommercialCapabilities,
  type VerificationChannel,
  type VerificationChallenge,
  confirmContactChallenge,
  contactLoginUiReady,
  contactUiReady,
  enabledContactChannels,
  enabledContactLoginChannels,
  loadCommercialCapabilities,
  loginWithVerifiedContact,
  requestContactChallenge,
  resetPasswordWithVerifiedContact
} from '../lib/commercial-identity';
import { useDialogFocus } from '../lib/dialog-focus';

const PENDING_REGISTRATION_KEY = 'sql-academy-pending-registration-v1';
const OPEN_CONTACT_REGISTRATION_EVENT = 'sql-academy-open-contact-registration';

type AuthMode = 'login' | 'register' | 'reset';
type IdentifierMode = 'username' | VerificationChannel;
type RecoveryStep = 'destination' | 'code' | 'password' | 'success';

type PendingRegistration = {
  response: AuthResponse;
  recoveryCodes: string[];
};

function friendlyError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('Failed to fetch')) return 'Cloudflare API сейчас недоступен. Проверь подключение и попробуй снова.';
  if (message.includes('Authentication is required') || message.includes('Session expired')) return 'Сессия завершена. Войди снова.';
  return message || 'Не удалось выполнить действие.';
}

function passwordValid(password: string) {
  const length = Array.from(password).length;
  return length >= 15 && length <= 128 && new TextEncoder().encode(password).byteLength <= 512;
}

function deviceName() {
  const platform = navigator.userAgentData?.platform || navigator.platform || 'Браузер';
  const mobile = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
  return `${mobile ? 'Телефон' : 'ПК'} · ${platform}`.slice(0, 64);
}

function channelLabel(channel: VerificationChannel) {
  return channel === 'email' ? 'Email' : 'Телефон';
}

function channelIcon(channel: VerificationChannel) {
  return channel === 'email' ? <Mail /> : <Phone />;
}

function channelPlaceholder(channel: VerificationChannel) {
  return channel === 'email' ? 'name@example.com' : '+79991234567';
}

function ContactRecoveryDialog({
  capabilities,
  channels,
  onClose
}: {
  capabilities: CommercialCapabilities;
  channels: VerificationChannel[];
  onClose: () => void;
}) {
  const [step, setStep] = useState<RecoveryStep>('destination');
  const [channel, setChannel] = useState<VerificationChannel>(channels[0] || 'email');
  const [destination, setDestination] = useState('');
  const [challenge, setChallenge] = useState<VerificationChallenge | null>(null);
  const [code, setCode] = useState('');
  const [ticket, setTicket] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const modalRef = useRef<HTMLElement>(null);

  useDialogFocus(true, modalRef, () => { if (!busy) onClose(); });
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, []);

  const sendCode = async () => {
    setBusy(true); setError(''); setMessage('');
    try {
      const next = await requestContactChallenge(capabilities, {
        channel,
        purpose: 'password-reset',
        destination
      });
      setChallenge(next);
      setCode('');
      setStep('code');
      setMessage(`Код отправлен на ${next.maskedDestination}.`);
    } catch (reason) {
      setError(friendlyError(reason));
    } finally {
      setBusy(false);
    }
  };

  const confirmCode = async () => {
    if (!challenge) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const result = await confirmContactChallenge(challenge.challengeId, code);
      setTicket(result.ticket);
      setStep('password');
      setMessage(`${channelLabel(result.channel)} подтверждён. Задай новый пароль.`);
    } catch (reason) {
      setError(friendlyError(reason));
    } finally {
      setBusy(false);
    }
  };

  const finish = async () => {
    if (password !== confirmPassword) { setError('Пароли не совпадают.'); return; }
    if (!passwordValid(password)) { setError('Пароль должен содержать от 15 до 128 символов.'); return; }
    setBusy(true); setError(''); setMessage('');
    try {
      const result = await resetPasswordWithVerifiedContact(capabilities, ticket, password);
      setMessage(result.message);
      setStep('success');
    } catch (reason) {
      setError(friendlyError(reason));
    } finally {
      setBusy(false);
    }
  };

  return <div className="commercial-identity-backdrop" onMouseDown={event => {
    if (event.currentTarget === event.target && !busy) onClose();
  }}>
    <section ref={modalRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="primary-contact-recovery-title" className="commercial-identity-modal" data-testid="primary-contact-recovery-modal">
      <header>
        <div><span className="auth-kicker">Подтверждённый контакт</span><h2 id="primary-contact-recovery-title">Восстановить доступ</h2></div>
        <button type="button" className="icon" data-autofocus onClick={onClose} disabled={busy} aria-label="Закрыть">×</button>
      </header>
      <div className="commercial-identity-body">
        {error && <div className="auth-notice error" role="alert"><ShieldCheck />{error}</div>}
        {message && <div className="auth-notice success" role="status"><Check />{message}</div>}

        {step === 'destination' && <>
          <p>Одноразовый код нужен только для восстановления. После смены пароля все старые сессии будут отключены.</p>
          {channels.length > 1 && <div className="commercial-channel-tabs" role="group" aria-label="Канал восстановления">
            {channels.map(item => <button key={item} type="button" aria-pressed={channel === item} className={channel === item ? 'active' : ''} onClick={() => { setChannel(item); setDestination(''); }}>{channelIcon(item)}{channelLabel(item)}</button>)}
          </div>}
          <label className="auth-field"><span>{channelLabel(channel)}</span><input data-testid="primary-recovery-destination" type={channel === 'email' ? 'email' : 'tel'} autoComplete={channel === 'email' ? 'email' : 'tel'} value={destination} onChange={event => setDestination(event.target.value)} placeholder={channelPlaceholder(channel)} required /></label>
          <button type="button" className="auth-primary" data-testid="primary-recovery-send" disabled={busy || destination.trim().length < 3} onClick={() => void sendCode()}>{busy ? <LoaderCircle className="spin" /> : channelIcon(channel)}Отправить код</button>
        </>}

        {step === 'code' && challenge && <>
          <p>Введи шестизначный код для {challenge.maskedDestination}.</p>
          <label className="auth-field"><span>Код подтверждения</span><input data-testid="primary-recovery-code" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={event => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))} maxLength={6} placeholder="000000" /></label>
          <button type="button" className="auth-primary" data-testid="primary-recovery-confirm" disabled={busy || code.length !== 6} onClick={() => void confirmCode()}>{busy ? <LoaderCircle className="spin" /> : <ShieldCheck />}Подтвердить код</button>
        </>}

        {step === 'password' && <>
          <label className="auth-field"><span>Новый пароль</span><input data-testid="primary-recovery-password" type="password" autoComplete="new-password" minLength={15} maxLength={128} value={password} onChange={event => setPassword(event.target.value)} /></label>
          <label className="auth-field"><span>Повтори пароль</span><input data-testid="primary-recovery-password-confirm" type="password" autoComplete="new-password" minLength={15} maxLength={128} value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} /></label>
          <button type="button" className="auth-primary" data-testid="primary-recovery-finish" disabled={busy || !passwordValid(password) || password !== confirmPassword} onClick={() => void finish()}>{busy ? <LoaderCircle className="spin" /> : <KeyRound />}Изменить пароль</button>
        </>}

        {step === 'success' && <div className="commercial-identity-success"><div><Check /></div><h3>Пароль изменён</h3><p>Закрой окно и войди с новым паролем.</p><button type="button" className="auth-primary" onClick={onClose}>Готово</button></div>}
      </div>
    </section>
  </div>;
}

export default function CapabilityAuthScreen({ onAuthenticated }: { onAuthenticated: (session: AuthSession) => void }) {
  const [mode, setMode] = useState<AuthMode>('login');
  const [identifierMode, setIdentifierMode] = useState<IdentifierMode>('username');
  const [username, setUsername] = useState('');
  const [contactIdentifier, setContactIdentifier] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [capabilities, setCapabilities] = useState<CommercialCapabilities | null>(null);
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => { void loadCommercialCapabilities().then(setCapabilities); }, []);

  const contactLoginChannels = useMemo(() => capabilities ? enabledContactLoginChannels(capabilities) : [], [capabilities]);
  const recoveryChannels = useMemo(() => capabilities ? enabledContactChannels(capabilities) : [], [capabilities]);
  const contactLoginReady = Boolean(capabilities && contactLoginUiReady(capabilities));
  const contactRecoveryReady = Boolean(capabilities && contactUiReady(capabilities));
  const requiredPolicy = capabilities?.registration.contactPolicy === 'required-for-new-registration';
  const requiredReady = Boolean(requiredPolicy && capabilities?.registration.policyReady && !capabilities.registration.contactlessAllowed && contactRecoveryReady);
  const requiredUnavailable = Boolean(requiredPolicy && !requiredReady);

  useEffect(() => {
    if (identifierMode !== 'username' && !contactLoginChannels.includes(identifierMode)) setIdentifierMode('username');
  }, [contactLoginChannels, identifierMode]);

  const clearFeedback = () => { setError(''); setMessage(''); };
  const switchMode = (next: AuthMode) => {
    setMode(next);
    setIdentifierMode('username');
    setPassword(''); setConfirmPassword(''); setRecoveryCode(''); setContactIdentifier('');
    clearFeedback();
  };

  const openVerifiedRegistration = () => {
    window.dispatchEvent(new CustomEvent(OPEN_CONTACT_REGISTRATION_EVENT));
  };

  const completeContactLogin = async () => {
    if (!capabilities || identifierMode === 'username') throw new Error('Вход через контакт сейчас недоступен.');
    const response = await loginWithVerifiedContact(capabilities, {
      channel: identifierMode,
      identifier: contactIdentifier,
      password,
      deviceName: deviceName()
    });
    const session = sessionFromResponse(response);
    saveAuthSession(session);
    onAuthenticated(session);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true); clearFeedback();
    try {
      if (mode === 'login') {
        if (identifierMode === 'username') {
          const { session } = await loginUser(username, password);
          onAuthenticated(session);
        } else {
          await completeContactLogin();
        }
        return;
      }
      if (mode === 'register' && requiredPolicy) {
        if (requiredReady) openVerifiedRegistration();
        else throw new Error('Регистрация временно недоступна: оператор ещё не завершил настройку подтверждённого контакта.');
        return;
      }
      if (password !== confirmPassword) throw new Error('Пароли не совпадают.');
      if (!passwordValid(password)) throw new Error('Пароль должен содержать от 15 до 128 символов.');
      if (mode === 'register') {
        const response = await registerUser({ username, password, displayName });
        if (!response.recoveryCodes || response.recoveryCodes.length !== 8) throw new Error('Сервер не вернул полный комплект recovery-кодов.');
        const pending: PendingRegistration = { response, recoveryCodes: response.recoveryCodes };
        sessionStorage.setItem(PENDING_REGISTRATION_KEY, JSON.stringify(pending));
        window.dispatchEvent(new CustomEvent('sql-academy-registration-pending', { detail: pending }));
        return;
      }
      await resetPassword(username, recoveryCode, password);
      setMessage('Пароль изменён. Все старые сессии отключены — теперь войди с новым паролем.');
      setMode('login'); setPassword(''); setConfirmPassword(''); setRecoveryCode('');
    } catch (reason) {
      setError(friendlyError(reason));
    } finally {
      setBusy(false);
    }
  };

  const identifierOptions: IdentifierMode[] = ['username', ...(contactLoginReady ? contactLoginChannels : [])];
  const showStandardRegistration = mode === 'register' && !requiredPolicy;
  const showCredentialFields = mode !== 'register' || showStandardRegistration;

  return <main className="auth-shell primary-contact-auth-screen">
    <section className="auth-brand-panel">
      <div className="auth-brand"><img src={`${import.meta.env.BASE_URL}logo.svg`} alt="" /><strong>SQL Academy</strong></div>
      <div className="auth-brand-copy">
        <span className="auth-kicker">Support Engineering Track</span>
        <h1>Твой SQL-прогресс — только после входа.</h1>
        <p>Логин и пароль синхронизируют задачи, освоение тем, учебный путь и будущие экзамены между всеми устройствами.</p>
        <div className="auth-proof"><span><ShieldCheck />контакты только при готовом провайдере</span><span><Cloud />Cloudflare D1 sync</span><span><KeyRound />8 recovery-кодов</span></div>
      </div>
      <small>Пароль не хранится в открытом виде. Email или телефон никогда не заменяют пароль и recovery-коды.</small>
    </section>

    <section className="auth-form-panel">
      <div className="auth-tabs" role="group" aria-label="Режим авторизации">
        <button type="button" aria-pressed={mode === 'login'} className={mode === 'login' ? 'active' : ''} onClick={() => switchMode('login')}>Вход</button>
        <button type="button" aria-pressed={mode === 'register'} className={mode === 'register' ? 'active' : ''} onClick={() => switchMode('register')}>Регистрация</button>
      </div>
      <form className="auth-form" onSubmit={event => void submit(event)}>
        <div className="auth-hero-icon">{mode === 'register' ? <User /> : mode === 'reset' ? <KeyRound /> : <Lock />}</div>
        <span className="auth-kicker">{mode === 'register' ? requiredPolicy ? 'Подтверждённый контакт' : 'Новый профиль' : mode === 'reset' ? 'Одноразовый recovery-код' : 'Защищённая сессия'}</span>
        <h2>{mode === 'register' ? 'Создать аккаунт' : mode === 'reset' ? 'Сбросить пароль' : 'Войти в академию'}</h2>
        <p>{mode === 'register'
          ? requiredReady
            ? 'Для нового аккаунта оператор требует подтверждённый email или телефон. Существующие пользователи продолжают входить по логину.'
            : requiredUnavailable
              ? 'Регистрация временно закрыта до завершения безопасной настройки провайдера и Turnstile.'
              : 'Контакт необязателен. Логин и recovery-коды остаются основой доступа.'
          : mode === 'reset'
            ? 'Используй recovery-код или подтверждённый контакт, если этот канал доступен.'
            : identifierMode === 'username'
              ? 'Продолжи обучение с синхронизированным прогрессом.'
              : 'Подтверждённый контакт используется только как идентификатор. Пароль обязателен, код не отправляется.'}</p>

        {mode === 'login' && identifierOptions.length > 1 && <div className="auth-identifier-tabs" role="group" aria-label="Способ входа">
          {identifierOptions.map(item => <button key={item} type="button" data-testid={`auth-identifier-${item}`} aria-pressed={identifierMode === item} className={identifierMode === item ? 'active' : ''} onClick={() => { setIdentifierMode(item); setContactIdentifier(''); clearFeedback(); }}>
            {item === 'username' ? <User /> : channelIcon(item)}{item === 'username' ? 'Логин' : channelLabel(item)}
          </button>)}
        </div>}

        {mode === 'register' && requiredPolicy && <div className={`auth-policy-card ${requiredReady ? 'ready' : 'blocked'}`} data-testid="required-contact-registration">
          <ShieldCheck />
          <span><strong>{requiredReady ? 'Подтверди контакт до создания аккаунта' : 'Регистрация безопасно отключена'}</strong><small>{requiredReady ? 'После кода ты задашь логин и пароль, затем обязательно сохранишь 8 recovery-кодов.' : 'Неполная конфигурация не откроет обычную регистрацию и не ослабит проверку.'}</small></span>
          {requiredReady && <button type="button" className="auth-primary" data-testid="primary-contact-register" onClick={openVerifiedRegistration}><Mail />Подтвердить контакт и зарегистрироваться</button>}
        </div>}

        {showCredentialFields && <>
          {(mode !== 'login' || identifierMode === 'username') && <label className="auth-field">
            <span>Логин</span>
            <input data-testid="auth-username" autoCapitalize="none" autoCorrect="off" spellCheck={false} autoComplete="username" value={username} onChange={event => setUsername(event.target.value.toLowerCase())} placeholder="например, sql_engineer" required />
            {mode === 'register' && <small>3–32 символа: латинские буквы, цифры, точка, дефис или _</small>}
          </label>}

          {mode === 'login' && identifierMode !== 'username' && <label className="auth-field">
            <span>{channelLabel(identifierMode)}</span>
            <input data-testid="auth-contact-identifier" type={identifierMode === 'email' ? 'email' : 'tel'} autoComplete={identifierMode === 'email' ? 'email' : 'tel'} value={contactIdentifier} onChange={event => setContactIdentifier(event.target.value)} placeholder={channelPlaceholder(identifierMode)} required />
          </label>}

          {showStandardRegistration && <label className="auth-field"><span>Отображаемое имя <em>необязательно</em></span><input value={displayName} maxLength={48} onChange={event => setDisplayName(event.target.value)} autoComplete="name" placeholder="Как обращаться внутри приложения" /></label>}

          {mode === 'reset' && <label className="auth-field"><span>Неиспользованный recovery-код</span><input data-testid="auth-recovery" value={recoveryCode} onChange={event => setRecoveryCode(event.target.value.toUpperCase())} autoComplete="off" placeholder="SQLR-XXXX-XXXX-…" required /></label>}

          <label className="auth-field">
            <span>{mode === 'reset' ? 'Новый пароль' : 'Пароль'}</span>
            <div className="password-field"><input data-testid="auth-password" type={showPassword ? 'text' : 'password'} value={password} onChange={event => setPassword(event.target.value)} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} minLength={mode === 'login' ? undefined : 15} maxLength={128} required /><button type="button" onClick={() => setShowPassword(value => !value)} aria-label={showPassword ? 'Скрыть пароль' : 'Показать пароль'}>{showPassword ? <EyeOff /> : <Eye />}</button></div>
            {mode !== 'login' && <small className={password && !passwordValid(password) ? 'invalid' : ''}>15–128 символов. Разрешены пробелы, Unicode и любые печатные символы.</small>}
          </label>

          {mode !== 'login' && <label className="auth-field"><span>Повтори пароль</span><input data-testid="auth-password-confirm" type={showPassword ? 'text' : 'password'} value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} autoComplete="new-password" minLength={15} maxLength={128} required /></label>}
        </>}

        {error && <div className="auth-notice error" role="alert"><ShieldCheck />{error}</div>}
        {message && <div className="auth-notice success" role="status"><Check />{message}</div>}

        {(mode !== 'register' || !requiredPolicy) && <button data-testid="auth-submit" className="auth-primary" disabled={busy || (mode === 'login' && identifierMode !== 'username' && contactIdentifier.trim().length < 3) || (mode !== 'login' && (!passwordValid(password) || password !== confirmPassword))}>
          {busy ? <LoaderCircle className="spin" /> : mode === 'register' ? <User /> : mode === 'reset' ? <KeyRound /> : <LogIn />}
          {mode === 'register' ? 'Создать аккаунт' : mode === 'reset' ? 'Изменить пароль' : 'Войти'}
        </button>}

        {showStandardRegistration && contactRecoveryReady && <button type="button" className="auth-link auth-contact-option" onClick={openVerifiedRegistration}><Mail />Создать аккаунт с подтверждённым контактом</button>}
        {mode === 'login' && <button type="button" className="auth-link" onClick={() => switchMode('reset')}>Забыл пароль или хочу его сменить</button>}
        {mode === 'reset' && contactRecoveryReady && <button type="button" className="auth-link auth-contact-option" data-testid="primary-contact-recovery" onClick={() => setRecoveryOpen(true)}><ShieldCheck />Восстановить через подтверждённый контакт</button>}
        {mode === 'reset' && <button type="button" className="auth-link" onClick={() => switchMode('login')}>← Вернуться ко входу</button>}
      </form>
    </section>
    {recoveryOpen && capabilities && <ContactRecoveryDialog capabilities={capabilities} channels={recoveryChannels} onClose={() => setRecoveryOpen(false)} />}
  </main>;
}
