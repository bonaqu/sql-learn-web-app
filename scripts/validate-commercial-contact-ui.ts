import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const client = readFileSync(new URL('../src/lib/commercial-identity.ts', import.meta.url), 'utf8');
const portal = readFileSync(new URL('../src/components/CommercialIdentityPortal.tsx', import.meta.url), 'utf8');
const primary = readFileSync(new URL('../src/components/CapabilityAuthScreen.tsx', import.meta.url), 'utf8');
const boundary = readFileSync(new URL('../src/components/IntegratedAuthGate.tsx', import.meta.url), 'utf8');
const main = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/commercial-identity.css', import.meta.url), 'utf8');
const launcherCss = readFileSync(new URL('../src/commercial-identity-v2.css', import.meta.url), 'utf8');
const integrationCss = readFileSync(new URL('../src/auth-contact-integration.css', import.meta.url), 'utf8');

for (const marker of [
  "contract: 'commercial-capabilities-v1'",
  "fetch('/api/capabilities'",
  "fetch('/api/auth/login'",
  "fetch('/api/auth/contact/challenge'",
  "fetch('/api/auth/contact/confirm'",
  "fetch('/api/auth/contact/register'",
  "fetch('/api/auth/contact/password/reset'",
  "fetch('/api/auth/contacts'",
  "fetch('/api/auth/contact/attach'"
]) assert.ok(client.includes(marker), `Commercial contact client lost ${marker}`);

assert.ok(client.includes('disabledCapabilities()'), 'Capability fetch no longer fails closed');
assert.ok(client.includes("cache: 'no-store'"), 'Capability discovery can be served from stale browser cache');
assert.ok(client.includes('enabledContactChannels'), 'UI no longer derives verification channels from server capabilities');
assert.ok(client.includes('enabledContactLoginChannels'), 'UI no longer derives login channels from explicit server capabilities');
assert.ok(client.includes('contactUiReady'), 'Client lacks a combined provider/Turnstile readiness gate');
assert.ok(client.includes('contactLoginUiReady'), 'Client lacks a combined contact-login/Turnstile readiness gate');
assert.ok(client.includes('passwordRequired'), 'Client can no longer distinguish password-based contact login');
assert.ok(client.includes("contactPolicy: 'optional'"), 'Missing capabilities no longer fail back to optional registration');
assert.ok(client.includes("identifierType: input.channel"), 'Contact login no longer sends an explicit identifier type');
assert.ok(client.includes('identifier: input.identifier'), 'Contact login identifier disappeared');
assert.ok(!client.includes('code: input.code'), 'Contact login incorrectly depends on a verification code');
assert.ok(client.includes('VITE_TURNSTILE_SITE_KEY'), 'Turnstile public site key is not explicit');
assert.ok(client.includes("data-sql-academy-turnstile") || client.includes('sqlAcademyTurnstile'), 'Turnstile script is not uniquely managed');
assert.ok(client.includes("action: TurnstileAction"), 'Turnstile action binding disappeared');
assert.ok(client.includes("'login'"), 'Login Turnstile action disappeared');
assert.ok(client.includes("'contact-challenge'"), 'Challenge action disappeared');
assert.ok(client.includes("'contact-register'"), 'Registration action disappeared');
assert.ok(client.includes("'contact-password-reset'"), 'Password reset action disappeared');
assert.ok(client.includes("appearance: 'interaction-only'"), 'Turnstile interaction-only UX disappeared');
assert.ok(client.includes("execution: 'execute'"), 'Turnstile is no longer explicitly executed per action');
assert.ok(client.includes("'refresh-expired': 'never'"), 'Expired Turnstile tokens may be silently reused');
assert.ok(client.includes('api.remove(widgetId)'), 'Turnstile widget is not removed after one action');
assert.ok(!main.includes('challenges.cloudflare.com'), 'Turnstile script became an unconditional application dependency');

for (const marker of [
  "type Flow = 'register' | 'reset' | 'attach'",
  'ContactLoginDialog',
  'loginWithVerifiedContact(',
  'sessionFromResponse(response)',
  'saveAuthSession(session)',
  'new CustomEvent(AUTH_CHANGED_EVENT, { detail: session })',
  'purposeForFlow(flow)',
  "sessionStorage.setItem(PENDING_REGISTRATION_KEY",
  "window.dispatchEvent(new CustomEvent('sql-academy-registration-pending'",
  'fetchVerifiedContacts()',
  'attachVerifiedContact(',
  'resetPasswordWithVerifiedContact(',
  'registerWithVerifiedContact(',
  'GuestContactLauncher',
  'ContactSecurityDrawer',
  'contact-login-launcher',
  'contact-login-modal',
  'verified-contact-launcher',
  'verified-contact-drawer',
  'Контакт обязателен для новых аккаунтов',
  'Существующие пользователи сохраняют вход по логину'
]) assert.ok(portal.includes(marker), `Commercial identity portal lost ${marker}`);

for (const forbidden of [
  'MutationObserver',
  'document.querySelector',
  'document.createElement',
  'data-commercial-auth-slot',
  'data-commercial-security-slot',
  '.auth-form',
  '.profile-body.security-stack',
  "textContent?.includes('Регистрация')"
]) assert.ok(!portal.includes(forbidden), `Contact UI returned to DOM scraping: ${forbidden}`);

assert.ok(portal.includes('if (!capabilities || (!ready && !loginReady)) return null'), 'Disabled contact capabilities are still rendered');
assert.ok(portal.includes("const PENDING_REGISTRATION_KEY = 'sql-academy-pending-registration-v1'"), 'Verified registration no longer enters the mandatory recovery-code gate');
assert.ok(portal.includes('sessionStorage.setItem'), 'Registration handoff no longer uses ephemeral session storage');
assert.ok(!portal.includes('localStorage.setItem'), 'Contact destination, code or ticket may be persisted in localStorage');
assert.ok(portal.includes('maskedDestination'), 'UI does not use masked contact values');
assert.ok(portal.includes('HMAC-отпечаток'), 'Privacy boundary is no longer explained to learners');
assert.ok(portal.includes('Recovery-коды всё равно останутся'), 'Verified contacts may be presented as replacing recovery codes');
assert.ok(portal.includes('Контакт необязателен'), 'Optional-policy copy disappeared');
assert.ok(portal.includes('Одноразовый код не отправляется'), 'Password login is not clearly distinguished from verification');

for (const marker of [
  'loadCommercialCapabilities().then(setCapabilities)',
  'enabledContactLoginChannels(capabilities)',
  'enabledContactChannels(capabilities)',
  'contactLoginUiReady(capabilities)',
  'contactUiReady(capabilities)',
  "type IdentifierMode = 'username' | VerificationChannel",
  "const identifierOptions: IdentifierMode[] = ['username'",
  'data-testid={`auth-identifier-${item}`}',
  'loginWithVerifiedContact(capabilities',
  'identifier: contactIdentifier',
  'password,',
  'sessionFromResponse(response)',
  'saveAuthSession(session)',
  'onAuthenticated(session)',
  "capabilities?.registration.contactPolicy === 'required-for-new-registration'",
  'capabilities?.registration.policyReady',
  '!capabilities.registration.contactlessAllowed',
  'data-testid="required-contact-registration"',
  'data-testid="primary-contact-register"',
  'Регистрация безопасно отключена',
  'оператор ещё не завершил настройку подтверждённого контакта',
  'requestContactChallenge(capabilities',
  "purpose: 'password-reset'",
  'confirmContactChallenge(challenge.challengeId, code)',
  'resetPasswordWithVerifiedContact(capabilities, ticket, password)',
  'data-testid="primary-contact-recovery"',
  "sessionStorage.setItem(PENDING_REGISTRATION_KEY",
  "window.dispatchEvent(new CustomEvent('sql-academy-registration-pending'"
]) assert.ok(primary.includes(marker), `Primary capability auth screen lost ${marker}`);

assert.ok(primary.includes("identifierMode === 'username'"), 'Primary login no longer preserves username authentication');
assert.ok(primary.includes('const { session } = await loginUser(username, password)'), 'Username login bypasses the canonical auth client');
assert.ok(primary.includes('Подтверждённый контакт используется только как идентификатор. Пароль обязателен, код не отправляется.'), 'Primary login no longer explains the password-only contact contract');
assert.ok(primary.includes("if (mode === 'register' && requiredPolicy)"), 'Required registration policy can fall through to contactless registration');
assert.ok(primary.includes("if (requiredReady) openVerifiedRegistration()"), 'Ready required policy no longer enters verified registration');
assert.ok(primary.includes('else throw new Error'), 'Unavailable required policy no longer fails closed');
assert.ok(!primary.includes('localStorage.setItem'), 'Primary contact destination, challenge or ticket may be persisted in localStorage');
assert.ok(!primary.includes('code: input.code'), 'Primary password login may have regressed to OTP login');
assert.ok(primary.includes('maskedDestination'), 'Primary recovery no longer displays only masked destinations');

for (const marker of [
  "const AuthGate = lazy(() => import('./AuthGate'))",
  "const CapabilityAuthScreen = lazy(() => import('./CapabilityAuthScreen'))",
  "const PENDING_REGISTRATION_KEY = 'sql-academy-pending-registration-v1'",
  'Boolean(loadAuthSession()) || hasPendingRegistration()',
  'window.addEventListener(AUTH_CHANGED_EVENT, authChanged)',
  'window.addEventListener(REGISTRATION_PENDING_EVENT, registrationPending)',
  'document.documentElement.classList.toggle(PRIMARY_CONTACT_AUTH_CLASS, !delegateToExistingGate)',
  'if (delegateToExistingGate) return (',
  '<Suspense fallback={<AuthLoadingState />}>',
  '<AuthGate>{children}</AuthGate>',
  '<CapabilityAuthScreen onAuthenticated={session =>',
  'saveAuthSession(session)',
  'setDelegateToExistingGate(true)'
]) assert.ok(boundary.includes(marker), `Integrated auth boundary lost ${marker}`);

assert.ok(!boundary.includes('clearAuthSession('), 'Integrated boundary must not revoke an authenticated session during handoff');
assert.ok(!boundary.includes('fetch('), 'Integrated boundary must not create a parallel network auth layer');

const gateEnd = main.indexOf('</IntegratedAuthGate>');
const portalPosition = main.indexOf('<CommercialIdentityPortal />');
assert.ok(gateEnd >= 0 && portalPosition > gateEnd, 'React-owned contact portal must stay mounted outside the integrated auth boundary');
assert.ok(main.includes("import IntegratedAuthGate from './components/IntegratedAuthGate'"), 'Application no longer mounts the integrated auth boundary');
assert.ok(!main.includes("import AuthGate from './components/AuthGate'"), 'Application mounted both old and integrated auth gates at the root');
assert.ok(main.includes("import CommercialIdentityPortal from './components/CommercialIdentityPortal'"), 'Application no longer mounts the contact portal');
assert.ok(main.includes("import './auth-contact-integration.css'"), 'Primary auth integration CSS is not loaded');
assert.ok(main.includes("import './commercial-identity.css'"), 'Commercial contact modal CSS is not loaded');
assert.ok(main.includes("import './commercial-identity-v2.css'"), 'React-owned launcher CSS is not loaded');
assert.ok(css.includes('@media (max-width: 700px)'), 'Contact modal has no explicit mobile contract');
assert.ok(css.includes('max-height: 94dvh'), 'Mobile contact modal can escape the viewport');
assert.ok(css.includes('commercial-turnstile-host'), 'Turnstile interaction has no bounded viewport host');
assert.ok(launcherCss.includes('.commercial-auth-launcher'), 'Guest capability launcher has no owned layout');
assert.ok(launcherCss.includes('.commercial-contact-launcher'), 'Authenticated contact launcher has no owned layout');
assert.ok(launcherCss.includes('@media (max-width: 700px)'), 'React-owned launchers have no mobile contract');
assert.ok(integrationCss.includes('.primary-contact-auth-active .commercial-auth-launcher'), 'Floating guest launcher is not suppressed while the primary screen owns guest auth');
assert.ok(integrationCss.includes('.auth-identifier-tabs'), 'Primary identifier selector has no owned layout');
assert.ok(integrationCss.includes('repeat(auto-fit, minmax(110px, 1fr))'), 'Primary identifier selector is not adaptive');
assert.ok(integrationCss.includes('.auth-policy-card.ready'), 'Ready registration policy has no visual state');
assert.ok(integrationCss.includes('.auth-policy-card.blocked'), 'Blocked registration policy has no visual state');
assert.ok(integrationCss.includes('@media (max-width: 700px)'), 'Primary auth integration has no mobile contract');

process.stdout.write('Capability-gated auth UI validated: one primary login screen, password-only contact identifiers, fail-closed registration policy, canonical recovery handoff and no parallel auth state.\n');
