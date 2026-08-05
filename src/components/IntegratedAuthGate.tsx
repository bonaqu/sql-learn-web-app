import { type ReactNode, useEffect, useState } from 'react';
import AuthGate from './AuthGate';
import CapabilityAuthScreen from './CapabilityAuthScreen';
import {
  AUTH_CHANGED_EVENT,
  type AuthSession,
  loadAuthSession,
  saveAuthSession
} from '../lib/auth';

const PENDING_REGISTRATION_KEY = 'sql-academy-pending-registration-v1';
const REGISTRATION_PENDING_EVENT = 'sql-academy-registration-pending';
const PRIMARY_CONTACT_AUTH_CLASS = 'primary-contact-auth-active';

function hasPendingRegistration() {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(PENDING_REGISTRATION_KEY) || 'null') as {
      response?: { session?: { token?: unknown } };
      recoveryCodes?: unknown[];
    } | null;
    return Boolean(parsed?.response?.session?.token && parsed.recoveryCodes?.length === 8);
  } catch {
    return false;
  }
}

export default function IntegratedAuthGate({ children }: { children: ReactNode }) {
  const [delegateToExistingGate, setDelegateToExistingGate] = useState(() => Boolean(loadAuthSession()) || hasPendingRegistration());

  useEffect(() => {
    const authChanged = (event: Event) => {
      const session = (event as CustomEvent<AuthSession | null>).detail;
      setDelegateToExistingGate(Boolean(session));
    };
    const registrationPending = () => setDelegateToExistingGate(true);
    window.addEventListener(AUTH_CHANGED_EVENT, authChanged);
    window.addEventListener(REGISTRATION_PENDING_EVENT, registrationPending);
    return () => {
      window.removeEventListener(AUTH_CHANGED_EVENT, authChanged);
      window.removeEventListener(REGISTRATION_PENDING_EVENT, registrationPending);
    };
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle(PRIMARY_CONTACT_AUTH_CLASS, !delegateToExistingGate);
    return () => document.documentElement.classList.remove(PRIMARY_CONTACT_AUTH_CLASS);
  }, [delegateToExistingGate]);

  if (delegateToExistingGate) return <AuthGate>{children}</AuthGate>;

  return <CapabilityAuthScreen onAuthenticated={session => {
    saveAuthSession(session);
    setDelegateToExistingGate(true);
  }} />;
}
