import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const backup = resolve(String(process.env.D1_BACKUP_FILE || process.argv[2] || '').trim());
if (!backup || !existsSync(backup)) throw new Error('Provide D1_BACKUP_FILE or the backup path as the first argument');
const manifestPath = resolve(String(process.env.D1_BACKUP_MANIFEST || `${backup}.manifest.json`));
if (!existsSync(manifestPath)) throw new Error(`Manifest not found: ${manifestPath}`);

const bytes = readFileSync(backup);
const sql = bytes.toString('utf8');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const sha256 = createHash('sha256').update(bytes).digest('hex');
if (manifest.format !== 'sql-academy-d1-backup-v1') throw new Error('Unsupported backup manifest format');
if (manifest.sha256 !== sha256) throw new Error('Backup checksum does not match the manifest');
if (Number(manifest.bytes) !== bytes.byteLength) throw new Error('Backup byte count does not match the manifest');

const required = ['users', 'user_profiles', 'auth_sessions', 'progress'];
const missing = required.filter(table => !new RegExp(`CREATE TABLE\\s+[`\"]?${table}[`\"]?`, 'i').test(sql));
if (missing.length) throw new Error(`Backup is missing required schema markers: ${missing.join(', ')}`);
if (/\b(?:DROP|DELETE)\s+(?:DATABASE|ACCOUNT)\b/i.test(sql)) throw new Error('Backup contains an unexpected destructive database/account statement');

console.log(JSON.stringify({
  ok: true,
  backup,
  manifest: manifestPath,
  bytes: bytes.byteLength,
  sha256,
  requiredSchemaMarkers: required
}));
