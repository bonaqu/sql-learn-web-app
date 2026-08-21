import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const directory = mkdtempSync(join(tmpdir(), 'sql-academy-operations-'));
const backup = join(directory, 'fixture.sql');
const manifest = `${backup}.manifest.json`;
const sql = [
  'CREATE TABLE IF NOT EXISTS "users" (user_id TEXT PRIMARY KEY);',
  'CREATE TABLE "user_profiles" (user_id TEXT PRIMARY KEY);',
  'CREATE TABLE `auth_sessions` (session_id TEXT PRIMARY KEY);',
  'CREATE TABLE progress (profile_id TEXT PRIMARY KEY);',
  "INSERT INTO users(user_id) VALUES ('fixture-user');"
].join('\n');

try {
  writeFileSync(backup, sql);
  const bytes = readFileSync(backup);
  writeFileSync(manifest, `${JSON.stringify({
    format: 'sql-academy-d1-backup-v1',
    bytes: bytes.byteLength,
    sha256: createHash('sha256').update(bytes).digest('hex')
  }, null, 2)}\n`);

  execFileSync(process.execPath, ['scripts/verify-d1-backup.mjs', backup], { cwd: process.cwd(), stdio: 'pipe' });
  writeFileSync(backup, `${sql}\n-- tampered after manifest`);
  const tampered = spawnSync(process.execPath, ['scripts/verify-d1-backup.mjs', backup], { cwd: process.cwd(), encoding: 'utf8' });
  if (tampered.status === 0 || !`${tampered.stderr}\n${tampered.stdout}`.includes('checksum')) {
    throw new Error('Tampered backup was not rejected by checksum validation');
  }

  const backupSource = readFileSync('scripts/d1-backup.mjs', 'utf8');
  const restoreSource = readFileSync('scripts/d1-restore-rehearsal.mjs', 'utf8');
  for (const [name, source] of [['backup', backupSource], ['restore', restoreSource]]) {
    for (const contract of ["createRequire(import.meta.url)", "require.resolve('wrangler')", 'execFileSync(process.execPath']) {
      if (!source.includes(contract)) throw new Error(`${name} must launch project-local Wrangler through Node: ${contract}`);
    }
  }
  for (const guard of ['RESTORE_TO_NON_PRODUCTION', 'Refusing to restore into the source/production database name', 'rehearsal|restore|staging|test', 'verify-d1-backup.mjs']) {
    if (!restoreSource.includes(guard)) throw new Error(`Restore rehearsal guard is missing: ${guard}`);
  }
  console.log('Operations validation passed: valid backup accepted, tampering rejected and restore rehearsal guards preserved.');
} finally {
  rmSync(directory, { recursive: true, force: true });
}
