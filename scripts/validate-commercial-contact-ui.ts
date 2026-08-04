import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const client = readFileSync(new URL('../src/lib/commercial-identity.ts', import.meta.url), 'utf8');
const portal = readFileSync(new URL('../src/components/CommercialIdentityPortal.tsx', import.meta.url), 'utf8');
const main = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/commercial-identity.css', import.meta.url), 'utf8');
const launcherCss = readFileSync(new URL('../src/commercial-identity-v2.css', import.meta.url), 'utf8');

for (const marker of [
  "contract: 'commercial-capabilities-v1'",
  "fetch('/api/capabilities'",
  "fetch('/api/auth/contact/challenge'",
  "fetch('/api/auth/contact/confirm'",
  "fetch('/api/auth/contact/register'",
  "fetch('/api/auth/contact/password/reset'",
  "fetch('/api/auth/contacts'",
  "fetch('/api/auth/contact/attach'"
]) assert.ok(client.includes(marker), `Commercial contact client lost ${marker}`);

assert.ok(client.includes('disabledCapabilities()'), 'Capability fetch no longer fails closed');
assert.ok(client.includes("cache: 'no-store'"), 'Capability discovery can be served from stale browser cache');
assert.ok(client.includes('enabledContactChannels'), 'UI no longer derives channels from server capabilities');
assert.ok(client.includes('contactUiReady'), 'Client lacks a combined provider/Turnstile readiness gate');
assert.ok(client.includes('VITE_TURNSTILE_SITE_KEY'), 'Turnstile public site key is not explicit');
assert.ok(client.includes("data-sql-academy-turnstile") || client.includes('sqlAcademyTurnstile'), 'Turnstile script is not uniquely managed');
assert.ok(client.includes("action: TurnstileAction"), 'Turnstile action binding disappeared');
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
  'purposeForFlow(flow)',
  "sessionStorage.setItem(PENDING_REGISTRATION_KEY",
  "window.dispatchEvent(new CustomEvent('sql-academy-registration-pending'",
  'fetchVerifiedContacts()',
  'attachVerifiedContact(',
  'resetPasswordWithVerifiedContact(',
  'registerWithVerifiedContact(',
  'GuestContactLauncher',
  'ContactSecurityDrawer',
  'verified-contact-launcher',
  'verified-contact-drawer'
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

assert.ok(portal.includes('if (!capabilities || !ready) return null'), 'Disabled or incomplete contact capability is still rendered');
assert.ok(portal.includes("const PENDING_REGISTRATION_KEY = 'sql-academy-pending-registration-v1'"), 'Verified registration no longer enters the mandatory recovery-code gate');
assert.ok(portal.includes('sessionStorage.setItem'), 'Registration handoff no longer uses ephemeral session storage');
assert.ok(!portal.includes('localStorage.setItem'), 'Contact destination, code or ticket may be persisted in localStorage');
assert.ok(portal.includes('maskedDestination'), 'UI does not use masked contact values');
assert.ok(portal.includes('HMAC-отпечаток'), 'Privacy boundary is no longer explained to learners');
assert.ok(portal.includes('Recovery-коды всё равно останутся'), 'Verified contacts may be presented as replacing recovery codes');
assert.ok(portal.includes('Контакт необязателен'), 'Capability-aware guest copy does not explain that contacts remain optional');

const authGateEnd = main.indexOf('</AuthGate>');
const portalPosition = main.indexOf('<CommercialIdentityPortal />');
assert.ok(authGateEnd >= 0 && portalPosition > authGateEnd, 'React-owned contact launcher must stay mounted for both guest and authenticated AuthGate states');
assert.ok(main.includes("import CommercialIdentityPortal from './components/CommercialIdentityPortal'"), 'Application no longer mounts the contact portal');
assert.ok(main.includes("import './commercial-identity.css'"), 'Commercial contact modal CSS is not loaded');
assert.ok(main.includes("import './commercial-identity-v2.css'"), 'React-owned launcher CSS is not loaded');
assert.ok(css.includes('@media (max-width: 700px)'), 'Contact modal has no explicit mobile contract');
assert.ok(css.includes('max-height: 94dvh'), 'Mobile contact modal can escape the viewport');
assert.ok(css.includes('commercial-turnstile-host'), 'Turnstile interaction has no bounded viewport host');
assert.ok(launcherCss.includes('.commercial-auth-launcher'), 'Guest capability launcher has no owned layout');
assert.ok(launcherCss.includes('.commercial-contact-launcher'), 'Authenticated contact launcher has no owned layout');
assert.ok(launcherCss.includes('@media (max-width: 700px)'), 'React-owned launchers have no mobile contract');

console.log('Capability-gated contact UI validated: React-owned guest/security launchers, no DOM scraping, default-off discovery, optional registration/recovery/binding and privacy-safe masked state.');
