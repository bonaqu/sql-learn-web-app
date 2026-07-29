import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const database = String(process.env.D1_DATABASE_NAME || 'sql-academy').trim();
const config = String(process.env.D1_CONFIG || (existsSync('wrangler.deploy.jsonc') ? 'wrangler.deploy.jsonc' : 'wrangler.jsonc')).trim();
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const output = resolve(String(process.env.D1_BACKUP_OUTPUT || `backups/d1/${database}-${timestamp}.sql`));
const manifestPath = `${output}.manifest.json`;

if (!/^[a-zA-Z0-9_-]{2,80}$/.test(database)) throw new Error('D1_DATABASE_NAME is invalid');
if (existsSync(output) || existsSync(manifestPath)) throw new Error(`Backup output already exists: ${output}`);
mkdirSync(dirname(output), { recursive: true });

const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
execFileSync(npx, ['wrangler', 'd1', 'export', database, '--remote', '--config', config, '--output', output], { stdio: 'inherit' });

const bytes = readFileSync(output);
const sql = bytes.toString('utf8');
const tablePattern = table => new RegExp('CREATE TABLE\\s+(?:IF NOT EXISTS\\s+)?[`"]?' + table + '[`"]?', 'i');
if (bytes.byteLength < 256 || !tablePattern('users').test(sql) || !tablePattern('progress').test(sql)) {
  throw new Error('Export does not look like a complete SQL Academy D1 backup');
}
const sha256 = createHash('sha256').update(bytes).digest('hex');
const manifest = {
  format: 'sql-academy-d1-backup-v1',
  createdAt: new Date().toISOString(),
  database,
  config,
  file: output,
  bytes: statSync(output).size,
  sha256,
  sourceCommit: process.env.GITHUB_SHA || null,
  requiredSchemaMarkers: ['users', 'user_profiles', 'auth_sessions', 'progress']
};
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
console.log(JSON.stringify({ ok: true, output, manifest: manifestPath, bytes: manifest.bytes, sha256 }));
