import { readFileSync, writeFileSync } from 'node:fs';

function patch(path, before, after, label) {
  const source = readFileSync(path, 'utf8');
  const count = source.split(before).length - 1;
  if (count !== 1) throw new Error(`${label}: expected one match, found ${count}`);
  writeFileSync(path, source.replace(before, after));
}

patch(
  'src/App.tsx',
  '    return () => notify(false);',
  '    return () => { notify(false); };',
  'React effect cleanup'
);

patch(
  'src/lib/dialog-focus.ts',
  "    const previousAriaHidden = applicationRoot?.getAttribute('aria-hidden');",
  "    const previousAriaHidden = applicationRoot ? applicationRoot.getAttribute('aria-hidden') : null;",
  'dialog aria-hidden snapshot'
);

patch(
  'src/components/AuthGate.tsx',
  '      {error && <div className="auth-notice error profile-notice"><ShieldCheck />{error}</div>}\n      {message && <div className="auth-notice success profile-notice"><Check />{message}</div>}',
  '      {error && <div className="auth-notice error profile-notice" role="alert"><ShieldCheck />{error}</div>}\n      {message && <div className="auth-notice success profile-notice" role="status" aria-live="polite"><Check />{message}</div>}',
  'profile live regions'
);

console.log('Applied TypeScript cleanup and profile live-region fixes.');
