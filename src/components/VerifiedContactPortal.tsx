import { createPortal } from 'react-dom';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CheckCircle2,
  KeyRound,
  Link2,
  LoaderCircle,
  Mail,
  Phone,
  RefreshCw,
  ShieldCheck,
  UserPlus,
  X
} from 'lucide-react';
import { AUTH_CHANGED_EVENT, loadAuthSession } from '../lib/auth';
import {
  attachVerifiedContact,
  confirmContactChallenge,
  ContactApiError,
  createContactChallenge,
  fetchCommercialCapabilities,
  listVerifiedContacts,
  registerWithVerifiedContact,
  resetPasswordWithVerifiedContact,
  type CommercialCapabilities,
  type ContactChallenge,
  type VerificationChannel,
  type VerificationPurpose,
  type VerifiedContact
} from '../lib/contact-auth';
import { useDialogFocus } from '../lib/dialog-focus';

type Operation = 'register' | 'password-reset' | 'attach';
type Stage = 'details' | 'code' | 'verified' | 'done';

const PENDING_REGISTRATION_KEY = 'sql-academy-pending-registration-v1';

function passwordValid(password: string) {
  const length = Array.from(password).length;
  return length >= 15 && length <= 128 && new TextEncoder().encode(password).byteLength <= 512;
}

function purposeFor(operation: Operation): VerificationPurpose {
  return operation === 'register'
    ? 'register'
    : operation === 'password-reset'
      ? 'password-reset'
      : 'sensitive-action';
}

function operationTitle(operation: Operation) {
  if (operation === 'register') return 'Создать аккаунт с подтверждённым контактом';
  if (operation === 'password-reset') return 'Восстановить пароль по контакту';
  return 'Привязать подтверждённый контакт';
}

function operationDescription(operation: Operation) {
  if (operation === 'register') return 'Получишь код, подтвердить его и только затем создать аккаунт. Recovery-коды всё равно останутся обязательными.';
  if (operation === 'password-reset') return 'Код можно отправить только на контакт, который уже привязан к аккаунту. После смены пароля все сессии будут закрыты.';
  return 'После кода понадобится текущий пароль. Подтверждение одноразовое и действует десять минут.';
}

function friendlyError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const known: Record<string, string> = {
    'Invalid verification destination': 'Проверь формат email или телефона в международном формате.',
    'Verification challenge was requested recently': 'Код уже отправлялся недавно. Дождись окончания таймера.',
    'Too many verification challenges': 'Слишком много кодов за короткое время. Попробуй позже.',
    'Verification delivery is temporarily unavailable': 'Провайдер не принял отправку. Повтори через минуту или выбери другой способ.',
    'Verification code is invalid': 'Код не подошёл.',
    'Verification challenge expired': 'Код истёк. Запроси новый.',
    'Verification challenge is locked': 'Попытки закончились. Запроси новый код позже.',
    'Verification ticket was already used': 'Это подтверждение уже использовано.',
    'Not found': 'Этот способ подтверждения сейчас выключен.'
  };
  if (known[message]) return known[message];
  if (message.includes('Failed to fetch')) return 'Сервис подтверждения сейчас недоступен. Проверь сеть и повтори.';
  return message || 'Не удалось выполнить действие.';
}

function formatDate(value: string) {
  const normalized = value.includes('T') ? value : `${value.replace(' ', 'T')}Z`;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit'
  }).format(date);
}

function channelLabel(channel: VerificationChannel) {
  return channel === 'email' ? 'Email' : 'SMS';
}

function channelPlaceholder(channel: VerificationChannel) {
  return channel === 'email' ? 'name@example.com' : '+79991234567';
}

function enabledChannels(capabilities: CommercialCapabilities | null) {
  const channels: VerificationChannel[] = [];
  if (capabilities?.integrations.emailVerification.enabled) channels.push('email');
  if (capabilities?.integrations.smsVerification.enabled) channels.push('sms');
  return channels;
}

function ContactIcon({ channel }: { channel: VerificationChannel }) {
  return channel === 'email' ? <Mail /> : <Phone />;
}

export default function VerifiedContactPortal() {
  const [capabilities, setCapabilities] = useState<CommercialCapabilities | null>(null);
  const [authenticated, setAuthenticated] = useState(() => Boolean(loadAuthSession()));
  const [guestSlot, setGuestSlot] = useState<HTMLElement | null>(null);
  const [securitySlot, setSecuritySlot] = useState<HTMLElement | null>(null);
  const [contacts, setContacts] = useState<VerifiedContact[]>([]);
  const [open, setOpen] = useState(false);
  const [operation, setOperation] = useState<Operation>('register');
  const [stage, setStage] = useState<Stage>('details');
  const [channel, setChannel] = useState<VerificationChannel>('email');
  const [destination, setDestination] = useState('');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [code, setCode] = useState('');
  const [challenge, setChallenge] = useState<ContactChallenge | null>(null);
  const [ticket, setTicket] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [clock, setClock] = useState(Date.now());
  const modalRef = useRef<HTMLElement>(null);

  const channels = useMemo(() => enabledChannels(capabilities), [capabilities]);
  const availableAttachChannels = useMemo(
    () => channels.filter(item => !contacts.some(contact => contact.channel === item)),
    [channels, contacts]
  );
  const anyEnabled = channels.length > 0;

  const refreshCapabilities = useCallback(() => {
    void fetchCommercialCapabilities()
      .then(setCapabilities)
      .catch(() => setCapabilities(null));
  }, []);

  const refreshContacts = useCallback(() => {
    if (!authenticated || !anyEnabled) {
      setContacts([]);
      return;
    }
    void listVerifiedContacts()
      .then(result => setContacts(result.contacts))
      .catch(reason => {
        if ((reason as ContactApiError).status === 404) setCapabilities(null);
      });
  }, [anyEnabled, authenticated]);

  useEffect(() => {
    refreshCapabilities();
    window.addEventListener('online', refreshCapabilities);
    return () => window.removeEventListener('online', refreshCapabilities);
  }, [refreshCapabilities]);

  useEffect(() => refreshContacts(), [refreshContacts]);

  useEffect(() => {
    const syncSurface = () => {
      const hasSession = Boolean(loadAuthSession());
      setAuthenticated(hasSession);

      const authForm = document.querySelector<HTMLElement>('.auth-form');
      let guestTarget = document.getElementById('verified-contact-guest-slot');
      if (!hasSession && anyEnabled && authForm) {
        if (!guestTarget) {
          guestTarget = document.createElement('div');
          guestTarget.id = 'verified-contact-guest-slot';
          guestTarget.className = 'verified-contact-guest-slot';
          authForm.appendChild(guestTarget);
        }
        setGuestSlot(guestTarget);
      } else {
        guestTarget?.remove();
        setGuestSlot(null);
      }

      const securityStack = document.querySelector<HTMLElement>('.profile-body.security-stack');
      let securityTarget = document.getElementById('verified-contact-security-slot');
      if (hasSession && anyEnabled && securityStack) {
        if (!securityTarget) {
          securityTarget = document.createElement('div');
          securityTarget.id = 'verified-contact-security-slot';
          securityTarget.className = 'verified-contact-security-slot';
          securityStack.insertBefore(securityTarget, securityStack.firstChild);
        }
        setSecuritySlot(securityTarget);
      } else {
        securityTarget?.remove();
        setSecuritySlot(null);
      }
    };

    syncSurface();
    const observer = new MutationObserver(syncSurface);
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener(AUTH_CHANGED_EVENT, syncSurface);
    return () => {
      observer.disconnect();
      window.removeEventListener(AUTH_CHANGED_EVENT, syncSurface);
      document.getElementById('verified-contact-guest-slot')?.remove();
      document.getElementById('verified-contact-security-slot')?.remove();
    };
  }, [anyEnabled]);

  useEffect(() => {
    if (!open || !challenge) return;
    const timer = window.setInterval(() => setClock(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [challenge, open]);

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, [open]);

  const close = useCallback(() => {
    if (busy) return;
    setOpen(false);
  }, [busy]);
  useDialogFocus(open, modalRef, close);

  const resetFlow = useCallback((nextOperation: Operation) => {
    const candidates = nextOperation === 'attach' ? availableAttachChannels : channels;
    setOperation(nextOperation);
    setChannel(candidates[0] || channels[0] || 'email');
    setDestination('');
    setUsername('');
    setDisplayName('');
    setPassword('');
    setConfirmPassword('');
    setCurrentPassword('');
    setCode('');
    setChallenge(null);
    setTicket('');
    setStage('details');
    setBusy('');
    setError('');
    setMessage('');
    setClock(Date.now());
    setOpen(true);
  }, [availableAttachChannels, channels]);

  const validateDetails = () => {
    if (!destination.trim()) return 'Укажи контакт для отправки кода.';
    if (operation === 'register' && !/^[a-z0-9](?:[a-z0-9._-]{1,30}[a-z0-9])?$/.test(username)) {
      return 'Логин: 3–32 символа, латиница, цифры, точка, дефис или _.';
    }
    if (operation !== 'attach') {
      if (!passwordValid(password)) return 'Пароль должен содержать 15–128 символов.';
      if (password !== confirmPassword) return 'Пароли не совпадают.';
    }
    if (operation === 'attach' && !currentPassword) return 'Введи текущий пароль аккаунта.';
    return '';
  };

  const sendChallenge = async () => {
    const validation = validateDetails();
    if (validation) { setError(validation); return; }
    setBusy('challenge'); setError(''); setMessage('');
    try {
      const next = await createContactChallenge({
        channel,
        purpose: purposeFor(operation),
        destination: destination.trim()
      });
      setChallenge(next);
      setCode('');
      setTicket('');
      setClock(Date.now());
      setStage('code');
      setMessage(`Код отправлен на ${next.maskedDestination}.`);
    } catch (reason) {
      const apiError = reason as ContactApiError;
      setError(`${friendlyError(reason)}${apiError.retryAfter ? ` Повтори через ${apiError.retryAfter} сек.` : ''}`);
    } finally {
      setBusy('');
    }
  };

  const confirmChallenge = async () => {
    if (!challenge || !/^\d{6}$/.test(code)) { setError('Введи шестизначный код.'); return; }
    setBusy('confirm'); setError(''); setMessage('');
    try {
      const confirmation = await confirmContactChallenge(challenge.challengeId, code);
      setTicket(confirmation.ticket);
      setStage('verified');
      setMessage(`${channelLabel(confirmation.channel)} подтверждён до ${formatDate(confirmation.expiresAt)}.`);
    } catch (reason) {
      const apiError = reason as ContactApiError;
      const attempts = apiError.attemptsRemaining === undefined ? '' : ` Осталось попыток: ${apiError.attemptsRemaining}.`;
      setError(`${friendlyError(reason)}${attempts}`);
    } finally {
      setBusy('');
    }
  };

  const complete = async () => {
    if (!ticket) return;
    const validation = validateDetails();
    if (validation) { setError(validation); return; }
    setBusy('complete'); setError(''); setMessage('');
    try {
      if (operation === 'register') {
        const response = await registerWithVerifiedContact({
          username,
          password,
          displayName,
          contactTicket: ticket
        });
        if (!response.recoveryCodes || response.recoveryCodes.length !== 8) {
          throw new Error('Сервер не вернул полный комплект recovery-кодов.');
        }
        const pending = { response, recoveryCodes: response.recoveryCodes };
        sessionStorage.setItem(PENDING_REGISTRATION_KEY, JSON.stringify(pending));
        window.dispatchEvent(new CustomEvent('sql-academy-registration-pending', { detail: pending }));
        setOpen(false);
        return;
      }
      if (operation === 'password-reset') {
        const result = await resetPasswordWithVerifiedContact(ticket, password);
        setStage('done');
        setMessage(result.message || 'Пароль изменён. Теперь войди с новым паролем.');
        return;
      }
      const result = await attachVerifiedContact(ticket, currentPassword);
      setContacts(result.contacts);
      setStage('done');
      setMessage('Подтверждённый контакт привязан к аккаунту.');
    } catch (reason) {
      setError(friendlyError(reason));
    } finally {
      setBusy('');
    }
  };

  const restart = () => {
    setChallenge(null);
    setTicket('');
    setCode('');
    setStage('details');
    setError('');
    setMessage('');
  };

  const resendSeconds = challenge
    ? Math.max(0, Math.ceil((Date.parse(challenge.resendAt.includes('T') ? challenge.resendAt : `${challenge.resendAt.replace(' ', 'T')}Z`) - clock) / 1_000))
    : 0;

  if (!anyEnabled) return null;

  const guestActions = guestSlot ? createPortal(
    <section className="verified-contact-entry" data-testid="verified-contact-guest-actions">
      <div><ShieldCheck /><span><strong>Подтверждённый контакт</strong><small>Необязательный дополнительный способ регистрации и восстановления.</small></span></div>
      <div className="verified-contact-entry-actions">
        <button type="button" onClick={() => resetFlow('register')}><UserPlus />Создать с контактом</button>
        <button type="button" onClick={() => resetFlow('password-reset')}><KeyRound />Восстановить по контакту</button>
      </div>
    </section>,
    guestSlot
  ) : null;

  const securityCard = securitySlot ? createPortal(
    <article className="security-card verified-contact-card" data-testid="verified-contact-security-card">
      <div><Link2 /><span><h3>Подтверждённые контакты</h3><p>Используются только для восстановления доступа. В интерфейсе и API отображаются маскированными.</p></span></div>
      <div className="verified-contact-list">
        {contacts.map(contact => <div key={contact.id}>
          <ContactIcon channel={contact.channel} />
          <span><strong>{contact.maskedDestination}</strong><small>{channelLabel(contact.channel)} · подтверждён {formatDate(contact.verifiedAt)}</small></span>
          <CheckCircle2 aria-label="Подтверждён" />
        </div>)}
        {!contacts.length && <p className="security-muted">К аккаунту пока не привязан email или телефон.</p>}
      </div>
      {availableAttachChannels.length > 0
        ? <button className="profile-sync" onClick={() => resetFlow('attach')}><Link2 />Привязать контакт</button>
        : <p className="security-muted">Все доступные типы контактов уже привязаны.</p>}
    </article>,
    securitySlot
  ) : null;

  const modal = open ? createPortal(
    <div className="verified-contact-backdrop" onMouseDown={event => {
      if (event.currentTarget === event.target) close();
    }}>
      <section ref={modalRef} tabIndex={-1} className="verified-contact-modal" role="dialog" aria-modal="true" aria-labelledby="verified-contact-title" data-testid="verified-contact-modal">
        <header>
          <div><span className="auth-kicker">Capability-gated security</span><h2 id="verified-contact-title">{operationTitle(operation)}</h2></div>
          <button type="button" className="icon" data-autofocus onClick={close} disabled={Boolean(busy)} aria-label="Закрыть"><X /></button>
        </header>
        <p>{operationDescription(operation)}</p>

        {stage !== 'done' && <>
          <div className="verified-contact-channel" role="group" aria-label="Способ подтверждения">
            {(operation === 'attach' ? availableAttachChannels : channels).map(item => <button
              type="button"
              key={item}
              aria-pressed={channel === item}
              className={channel === item ? 'active' : ''}
              disabled={stage !== 'details'}
              onClick={() => setChannel(item)}
            ><ContactIcon channel={item} />{channelLabel(item)}</button>)}
          </div>

          <label className="auth-field">
            <span>{channel === 'email' ? 'Email' : 'Телефон в международном формате'}</span>
            <input
              data-testid="verified-contact-destination"
              type={channel === 'email' ? 'email' : 'tel'}
              autoComplete={channel === 'email' ? 'email' : 'tel'}
              value={destination}
              disabled={stage !== 'details'}
              placeholder={channelPlaceholder(channel)}
              onChange={event => setDestination(event.target.value)}
            />
          </label>

          {operation === 'register' && <>
            <label className="auth-field"><span>Логин</span><input data-testid="verified-contact-username" autoComplete="username" value={username} onChange={event => setUsername(event.target.value.toLowerCase())} disabled={stage === 'code'} /></label>
            <label className="auth-field"><span>Отображаемое имя <em>необязательно</em></span><input value={displayName} maxLength={48} autoComplete="name" onChange={event => setDisplayName(event.target.value)} disabled={stage === 'code'} /></label>
          </>}

          {operation !== 'attach' && <div className="verified-contact-password-grid">
            <label className="auth-field"><span>{operation === 'password-reset' ? 'Новый пароль' : 'Пароль'}</span><input data-testid="verified-contact-password" type="password" minLength={15} maxLength={128} autoComplete="new-password" value={password} onChange={event => setPassword(event.target.value)} disabled={stage === 'code'} /></label>
            <label className="auth-field"><span>Повтори пароль</span><input type="password" minLength={15} maxLength={128} autoComplete="new-password" value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} disabled={stage === 'code'} /></label>
          </div>}

          {operation === 'attach' && <label className="auth-field"><span>Текущий пароль</span><input data-testid="verified-contact-current-password" type="password" autoComplete="current-password" value={currentPassword} onChange={event => setCurrentPassword(event.target.value)} disabled={stage === 'code'} /></label>}
        </>}

        {stage === 'code' && challenge && <section className="verified-contact-code-step">
          <div className="verified-contact-delivery"><ContactIcon channel={channel} /><span><strong>Код отправлен</strong><small>{challenge.maskedDestination} · действует до {formatDate(challenge.expiresAt)}</small></span></div>
          <label className="auth-field"><span>Шестизначный код</span><input data-testid="verified-contact-code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} onChange={event => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))} /></label>
          <div className="verified-contact-inline-actions">
            <button type="button" className="auth-primary" data-testid="verified-contact-confirm" onClick={() => void confirmChallenge()} disabled={busy === 'confirm' || code.length !== 6}>{busy === 'confirm' ? <LoaderCircle className="spin" /> : <ShieldCheck />}Подтвердить код</button>
            <button type="button" className="auth-link" onClick={() => void sendChallenge()} disabled={Boolean(busy) || resendSeconds > 0}><RefreshCw />{resendSeconds > 0 ? `Новый код через ${resendSeconds} сек.` : 'Отправить новый код'}</button>
          </div>
        </section>}

        {stage === 'verified' && <section className="verified-contact-verified">
          <CheckCircle2 />
          <div><strong>Контакт подтверждён</strong><p>Ticket хранится только в памяти этой формы и будет атомарно израсходован следующим действием.</p></div>
          <button type="button" className="auth-primary" data-testid="verified-contact-complete" onClick={() => void complete()} disabled={busy === 'complete'}>{busy === 'complete' ? <LoaderCircle className="spin" /> : operation === 'register' ? <UserPlus /> : operation === 'attach' ? <Link2 /> : <KeyRound />}{operation === 'register' ? 'Создать аккаунт' : operation === 'attach' ? 'Привязать контакт' : 'Изменить пароль'}</button>
          <button type="button" className="auth-link" onClick={restart} disabled={Boolean(busy)}>Начать подтверждение заново</button>
        </section>}

        {stage === 'done' && <section className="verified-contact-done"><CheckCircle2 /><h3>Готово</h3><p>{message}</p><button type="button" className="auth-primary" onClick={() => setOpen(false)}>Закрыть</button></section>}

        {stage === 'details' && <button type="button" className="auth-primary" data-testid="verified-contact-send" onClick={() => void sendChallenge()} disabled={busy === 'challenge'}>{busy === 'challenge' ? <LoaderCircle className="spin" /> : <ShieldCheck />}Отправить код</button>}
        {error && <div className="auth-notice error" role="alert"><ShieldCheck />{error}</div>}
        {message && stage !== 'done' && <div className="auth-notice success" role="status" aria-live="polite"><CheckCircle2 />{message}</div>}
      </section>
    </div>,
    document.body
  ) : null;

  return <>{guestActions}{securityCard}{modal}</>;
}
