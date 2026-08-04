import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Check,
  KeyRound,
  Link,
  LoaderCircle,
  Mail,
  Phone,
  ShieldCheck,
  UserPlus,
  X
} from 'lucide-react';
import type { AuthResponse } from '../lib/auth';
import { AUTH_CHANGED_EVENT, loadAuthSession } from '../lib/auth';
import {
  attachVerifiedContact,
  type CommercialCapabilities,
  confirmContactChallenge,
  contactUiReady,
  enabledContactChannels,
  fetchVerifiedContacts,
  loadCommercialCapabilities,
  registerWithVerifiedContact,
  requestContactChallenge,
  resetPasswordWithVerifiedContact,
  type VerificationChannel,
  type VerificationChallenge,
  type VerificationConfirmation,
  type VerificationPurpose,
  type VerifiedContact
} from '../lib/commercial-identity';
import { useDialogFocus } from '../lib/dialog-focus';

const PENDING_REGISTRATION_KEY = 'sql-academy-pending-registration-v1';
type Flow = 'register' | 'reset' | 'attach';
type WizardStep = 'destination' | 'code' | 'account' | 'success';

type PendingRegistration = {
  response: AuthResponse;
  recoveryCodes: string[];
};

function passwordValid(password: string) {
  const length = Array.from(password).length;
  return length >= 15 && length <= 128 && new TextEncoder().encode(password).byteLength <= 512;
}

function friendlyError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('Failed to fetch')) return 'Сервис подтверждения сейчас недоступен. Проверь подключение и повтори действие.';
  if (message.includes('recently')) return 'Код уже отправлялся недавно. Подожди минуту перед повтором.';
  if (message.includes('Too many')) return 'Слишком много запросов кода. Сделай паузу и попробуй позже.';
  return message || 'Не удалось выполнить действие.';
}

function channelLabel(channel: VerificationChannel) {
  return channel === 'email' ? 'Email' : 'Телефон';
}

function channelPlaceholder(channel: VerificationChannel) {
  return channel === 'email' ? 'name@example.com' : '+79991234567';
}

function channelIcon(channel: VerificationChannel) {
  return channel === 'email' ? <Mail /> : <Phone />;
}

function purposeForFlow(flow: Flow): VerificationPurpose {
  return flow === 'register' ? 'register' : flow === 'reset' ? 'password-reset' : 'sensitive-action';
}

function ContactWizard({
  flow,
  capabilities,
  channels,
  initialChannel,
  onClose,
  onAttached
}: {
  flow: Flow;
  capabilities: CommercialCapabilities;
  channels: VerificationChannel[];
  initialChannel?: VerificationChannel;
  onClose: () => void;
  onAttached?: (contacts: VerifiedContact[]) => void;
}) {
  const [step, setStep] = useState<WizardStep>('destination');
  const [channel, setChannel] = useState<VerificationChannel>(initialChannel || channels[0] || 'email');
  const [destination, setDestination] = useState('');
  const [challenge, setChallenge] = useState<VerificationChallenge | null>(null);
  const [confirmation, setConfirmation] = useState<VerificationConfirmation | null>(null);
  const [code, setCode] = useState('');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
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

  const begin = async () => {
    setBusy(true); setError(''); setMessage('');
    try {
      const next = await requestContactChallenge(capabilities, {
        channel,
        purpose: purposeForFlow(flow),
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

  const verify = async () => {
    if (!challenge) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const next = await confirmContactChallenge(challenge.challengeId, code);
      setConfirmation(next);
      setStep('account');
      setMessage(`${channelLabel(next.channel)} подтверждён. Заверши действие в течение десяти минут.`);
    } catch (reason) {
      setError(friendlyError(reason));
    } finally {
      setBusy(false);
    }
  };

  const finish = async () => {
    if (!confirmation) return;
    if (flow !== 'attach' && password !== confirmPassword) {
      setError('Пароли не совпадают.');
      return;
    }
    if (flow !== 'attach' && !passwordValid(password)) {
      setError('Пароль должен содержать от 15 до 128 символов.');
      return;
    }
    setBusy(true); setError(''); setMessage('');
    try {
      if (flow === 'register') {
        const response = await registerWithVerifiedContact(capabilities, {
          username,
          password,
          displayName,
          contactTicket: confirmation.ticket
        });
        if (!response.recoveryCodes || response.recoveryCodes.length !== 8) {
          throw new Error('Сервер не вернул полный комплект recovery-кодов.');
        }
        const pending: PendingRegistration = { response, recoveryCodes: response.recoveryCodes };
        sessionStorage.setItem(PENDING_REGISTRATION_KEY, JSON.stringify(pending));
        window.dispatchEvent(new CustomEvent('sql-academy-registration-pending', { detail: pending }));
        onClose();
        return;
      }
      if (flow === 'reset') {
        const result = await resetPasswordWithVerifiedContact(capabilities, confirmation.ticket, password);
        setMessage(result.message);
        setStep('success');
        return;
      }
      const result = await attachVerifiedContact(confirmation.ticket, currentPassword);
      onAttached?.(result.contacts);
      setMessage(`${channelLabel(channel)} привязан к аккаунту. В интерфейсе хранится только маска контакта.`);
      setStep('success');
    } catch (reason) {
      setError(friendlyError(reason));
    } finally {
      setBusy(false);
    }
  };

  const title = flow === 'register'
    ? 'Регистрация с подтверждённым контактом'
    : flow === 'reset'
      ? 'Восстановление через контакт'
      : 'Привязать контакт';

  return <div className="commercial-identity-backdrop" onMouseDown={event => {
    if (event.currentTarget === event.target && !busy) onClose();
  }}>
    <section ref={modalRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="commercial-identity-title" className="commercial-identity-modal" data-testid={`contact-${flow}-modal`}>
      <header>
        <div><span className="auth-kicker">Опциональная защита аккаунта</span><h2 id="commercial-identity-title">{title}</h2></div>
        <button type="button" className="icon" data-autofocus onClick={onClose} disabled={busy} aria-label="Закрыть"><X /></button>
      </header>

      <ol className="commercial-identity-steps" aria-label="Шаги подтверждения">
        {['Контакт', 'Код', flow === 'attach' ? 'Пароль' : 'Аккаунт'].map((label, index) => {
          const current = step === 'destination' ? 0 : step === 'code' ? 1 : 2;
          return <li key={label} className={index <= current ? 'active' : ''}><span>{index + 1}</span>{label}</li>;
        })}
      </ol>

      {error && <div className="auth-notice error" role="alert"><ShieldCheck />{error}</div>}
      {message && <div className="auth-notice success" role="status" aria-live="polite"><Check />{message}</div>}

      {step === 'destination' && <div className="commercial-identity-body">
        <p>Контакт используется только для подтверждения, восстановления и чувствительных действий. SQL Academy сохраняет HMAC-отпечаток и маску, а не полный адрес или номер.</p>
        {channels.length > 1 && <div className="commercial-channel-tabs" role="group" aria-label="Канал подтверждения">
          {channels.map(item => <button key={item} type="button" aria-pressed={channel === item} className={channel === item ? 'active' : ''} onClick={() => { setChannel(item); setDestination(''); }}>
            {channelIcon(item)}{channelLabel(item)}
          </button>)}
        </div>}
        <label className="auth-field">
          <span>{channelLabel(channel)}</span>
          <input data-testid="contact-destination" type={channel === 'email' ? 'email' : 'tel'} autoComplete={channel === 'email' ? 'email' : 'tel'} value={destination} onChange={event => setDestination(event.target.value)} placeholder={channelPlaceholder(channel)} required />
          <small>{channel === 'email' ? 'Адрес нормализуется без учёта регистра.' : 'Международный формат E.164, например +79991234567.'}</small>
        </label>
        <button type="button" className="auth-primary" data-testid="contact-send-code" disabled={busy || destination.trim().length < 3} onClick={() => void begin()}>
          {busy ? <LoaderCircle className="spin" /> : channelIcon(channel)}Отправить одноразовый код
        </button>
      </div>}

      {step === 'code' && challenge && <div className="commercial-identity-body">
        <p>Введи шестизначный код для {challenge.maskedDestination}. Он действует десять минут; доступно до {challenge.attempts} попыток.</p>
        <label className="auth-field">
          <span>Код подтверждения</span>
          <input data-testid="contact-code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} onChange={event => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="000000" required />
        </label>
        <div className="commercial-inline-actions">
          <button type="button" className="auth-link" disabled={busy} onClick={() => { setStep('destination'); setCode(''); setMessage(''); }}>Изменить контакт</button>
          <button type="button" className="auth-primary" data-testid="contact-confirm-code" disabled={busy || code.length !== 6} onClick={() => void verify()}>
            {busy ? <LoaderCircle className="spin" /> : <ShieldCheck />}Подтвердить код
          </button>
        </div>
      </div>}

      {step === 'account' && confirmation && <div className="commercial-identity-body">
        {flow === 'register' && <>
          <label className="auth-field"><span>Логин</span><input data-testid="contact-register-username" autoCapitalize="none" autoCorrect="off" spellCheck={false} autoComplete="username" value={username} onChange={event => setUsername(event.target.value.toLowerCase())} placeholder="sql_engineer" required /></label>
          <label className="auth-field"><span>Отображаемое имя <em>необязательно</em></span><input value={displayName} maxLength={48} autoComplete="name" onChange={event => setDisplayName(event.target.value)} /></label>
        </>}
        {flow === 'attach' && <label className="auth-field"><span>Текущий пароль</span><input data-testid="contact-current-password" type="password" autoComplete="current-password" value={currentPassword} onChange={event => setCurrentPassword(event.target.value)} required /></label>}
        {flow !== 'attach' && <>
          <label className="auth-field"><span>{flow === 'reset' ? 'Новый пароль' : 'Пароль'}</span><input data-testid="contact-new-password" type="password" minLength={15} maxLength={128} autoComplete="new-password" value={password} onChange={event => setPassword(event.target.value)} required /><small>15–128 символов. Recovery-коды всё равно останутся независимым резервным способом.</small></label>
          <label className="auth-field"><span>Повтори пароль</span><input data-testid="contact-new-password-confirm" type="password" minLength={15} maxLength={128} autoComplete="new-password" value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} required /></label>
        </>}
        <button type="button" className="auth-primary" data-testid="contact-finish" disabled={busy || (flow === 'attach' ? !currentPassword : !passwordValid(password) || password !== confirmPassword || (flow === 'register' && username.length < 3))} onClick={() => void finish()}>
          {busy ? <LoaderCircle className="spin" /> : flow === 'register' ? <UserPlus /> : flow === 'reset' ? <KeyRound /> : <Link />}
          {flow === 'register' ? 'Создать аккаунт' : flow === 'reset' ? 'Изменить пароль и отключить сессии' : 'Привязать контакт'}
        </button>
      </div>}

      {step === 'success' && <div className="commercial-identity-success">
        <div><Check /></div>
        <h3>{flow === 'reset' ? 'Пароль изменён' : 'Контакт привязан'}</h3>
        <p>{flow === 'reset' ? 'Все старые сессии отозваны. Закрой окно и войди с новым паролем.' : 'Теперь этот контакт можно использовать для восстановления доступа.'}</p>
        <button type="button" className="auth-primary" onClick={onClose}>Готово</button>
      </div>}
    </section>
  </div>;
}

function GuestContactLauncher({ onOpen }: { onOpen: (flow: Flow) => void }) {
  return <aside className="commercial-auth-launcher" data-testid="commercial-contact-entry" aria-label="Дополнительные способы входа">
    <div className="commercial-auth-launcher-copy"><ShieldCheck /><span><strong>Контакт необязателен</strong><small>Логин и recovery-коды работают без него. Email или телефон добавляют ещё один защищённый путь.</small></span></div>
    <div className="commercial-auth-launcher-actions">
      <button type="button" onClick={() => onOpen('register')}><UserPlus />Регистрация с контактом</button>
      <button type="button" onClick={() => onOpen('reset')}><KeyRound />Восстановить через контакт</button>
    </div>
  </aside>;
}

function ContactSecurityCard({
  channels,
  contacts,
  loading,
  error,
  onAttach,
  onRefresh
}: {
  channels: VerificationChannel[];
  contacts: VerifiedContact[];
  loading: boolean;
  error: string;
  onAttach: (channel: VerificationChannel) => void;
  onRefresh: () => void;
}) {
  const attached = new Set(contacts.map(contact => contact.channel));
  return <article className="security-card commercial-security-card" data-testid="verified-contact-card">
    <div><ShieldCheck /><span><h3>Подтверждённые контакты</h3><p>Дополнительное восстановление доступа без замены одноразовых recovery-кодов.</p></span></div>
    {loading && <div className="auth-loading"><LoaderCircle className="spin" />Загружаю контакты…</div>}
    {error && <div className="auth-notice error" role="alert"><ShieldCheck />{error}<button type="button" onClick={onRefresh}>Повторить</button></div>}
    {!loading && !error && <div className="verified-contact-list">
      {contacts.map(contact => <div key={`${contact.channel}:${contact.id || contact.maskedDestination}`}>
        {channelIcon(contact.channel)}<span><strong>{channelLabel(contact.channel)}</strong><small>{contact.maskedDestination}</small></span><b>Подтверждён</b>
      </div>)}
      {!contacts.length && <p>Контакты пока не привязаны. Полный адрес или номер не хранится в профиле.</p>}
    </div>}
    <div className="commercial-inline-actions">
      {channels.filter(channel => !attached.has(channel)).map(channel => <button key={channel} type="button" className="profile-sync" onClick={() => onAttach(channel)}>{channelIcon(channel)}Привязать {channel === 'email' ? 'email' : 'телефон'}</button>)}
    </div>
  </article>;
}

function ContactSecurityDrawer({
  open,
  onClose,
  children
}: {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const drawerRef = useRef<HTMLElement>(null);
  useDialogFocus(open, drawerRef, onClose);
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, [open]);
  if (!open) return null;
  return <div className="commercial-identity-backdrop" onMouseDown={event => {
    if (event.currentTarget === event.target) onClose();
  }}>
    <section ref={drawerRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="contact-security-title" className="commercial-identity-modal commercial-contact-drawer" data-testid="verified-contact-drawer">
      <header><div><span className="auth-kicker">Безопасность аккаунта</span><h2 id="contact-security-title">Контакты аккаунта</h2></div><button type="button" className="icon" data-autofocus onClick={onClose} aria-label="Закрыть"><X /></button></header>
      <div className="commercial-identity-body">{children}</div>
    </section>
  </div>;
}

export default function CommercialIdentityPortal() {
  const [capabilities, setCapabilities] = useState<CommercialCapabilities | null>(null);
  const [flow, setFlow] = useState<Flow | null>(null);
  const [initialChannel, setInitialChannel] = useState<VerificationChannel | undefined>();
  const [contacts, setContacts] = useState<VerifiedContact[]>([]);
  const [contactsLoading, setContactsLoading] = useState(false);
  const [contactsError, setContactsError] = useState('');
  const [authenticated, setAuthenticated] = useState(() => Boolean(loadAuthSession()));
  const [securityOpen, setSecurityOpen] = useState(false);

  useEffect(() => {
    void loadCommercialCapabilities().then(setCapabilities);
  }, []);

  const channels = useMemo(() => capabilities ? enabledContactChannels(capabilities) : [], [capabilities]);
  const ready = Boolean(capabilities && contactUiReady(capabilities));

  const refreshContacts = useCallback(async () => {
    if (!authenticated || !ready) return;
    setContactsLoading(true); setContactsError('');
    try {
      setContacts((await fetchVerifiedContacts()).contacts);
    } catch (reason) {
      setContactsError(friendlyError(reason));
    } finally {
      setContactsLoading(false);
    }
  }, [authenticated, ready]);

  useEffect(() => {
    const handler = () => {
      const next = Boolean(loadAuthSession());
      setAuthenticated(next);
      if (!next) setSecurityOpen(false);
    };
    window.addEventListener(AUTH_CHANGED_EVENT, handler);
    return () => window.removeEventListener(AUTH_CHANGED_EVENT, handler);
  }, []);

  useEffect(() => {
    if (securityOpen && authenticated && ready) void refreshContacts();
  }, [authenticated, ready, refreshContacts, securityOpen]);

  if (!capabilities || !ready) return null;

  const open = (nextFlow: Flow, channel?: VerificationChannel) => {
    setInitialChannel(channel);
    setFlow(nextFlow);
  };
  const closeWizard = () => {
    setFlow(null);
    setInitialChannel(undefined);
  };

  return <>
    {!authenticated && <GuestContactLauncher onOpen={open} />}
    {authenticated && <button type="button" className="commercial-contact-launcher" data-testid="verified-contact-launcher" onClick={() => setSecurityOpen(true)}><ShieldCheck />Контакты аккаунта</button>}
    {authenticated && createPortal(<ContactSecurityDrawer open={securityOpen} onClose={() => setSecurityOpen(false)}>
      <ContactSecurityCard
        channels={channels}
        contacts={contacts}
        loading={contactsLoading}
        error={contactsError}
        onAttach={channel => { setSecurityOpen(false); open('attach', channel); }}
        onRefresh={() => void refreshContacts()}
      />
    </ContactSecurityDrawer>, document.body)}
    {flow && createPortal(<ContactWizard
      flow={flow}
      capabilities={capabilities}
      channels={initialChannel ? [initialChannel] : channels}
      initialChannel={initialChannel}
      onClose={closeWizard}
      onAttached={next => { setContacts(next); setContactsError(''); }}
    />, document.body)}
  </>;
}
