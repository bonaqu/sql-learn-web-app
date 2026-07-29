import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const backup = resolve(String(process.env.D1_BACKUP_FILE || process.argv[2] || '').trim());
const target = String(process.env.D1_RESTORE_TARGET || '').trim();
const source = String(process.env.D1_DATABASE_NAME || 'sql-academy').trim();
const config = String(process.env.D1_CONFIG || (existsSync('wrangler.deploy.jsonc') ? 'wrangler.deploy.jsonc' : 'wrangler.jsonc')).trim();
const confirmation = String(process.env.ALLOW_D1_RESTORE || '');

if (!backup || !existsSync(backup)) throw new Error('Provide D1_BACKUP_FILE or the backup path as the first argument');
if (!/^[a-zA-Z0-9_-]{2,80}$/.test(target)) throw new Error('D1_RESTORE_TARGET is required and invalid');
if (target === source) throw new Error('Refusing to restore into the source/production database name');
if (!/(?:rehearsal|restore|staging|test)/i.test(target)) throw new Error('D1_RESTORE_TARGET must visibly identify a non-production rehearsal/staging database');
if (confirmation !== 'RESTORE_TO_NON_PRODUCTION') throw new Error('Set ALLOW_D1_RESTORE=RESTORE_TO_NON_PRODUCTION after verifying the target database');

const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
execFileSync(process.execPath, ['scripts/verify-d1-backup.mjs', backup], { stdio: 'inherit' });
execFileSync(npx, ['wrangler', 'd1', 'execute', target, '--remote', '--config', config, '--file', backup, '--yes'], { stdio: 'inherit' });

const raw = execFileSync(npx, [
  'wrangler', 'd1', 'execute', target, '--remote', '--config', config,
  '--command', "SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name IN ('users','user_profiles','auth_sessions','progress')",
  '--yes', '--json'
], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
const match = JSON.stringify(JSON.parse(raw)).match(/"count"\s*:\s*(\d+)/);
if (!match || Number(match[1]) !== 4) throw new Error(`Restore integrity query failed: ${raw.slice(0, 500)}`);

console.log(JSON.stringify({
  ok: true,
  target,
  backup,
  requiredTables: 4,
  warning: 'Run the full application lifecycle smoke against the rehearsal Worker next.'
}));
