import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function option(name) {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : '';
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a JSON path`);
  return resolve(process.cwd(), value);
}

function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    throw new Error(`${label} must be valid JSON`);
  }
}

const metadata = readJson(option('--metadata'), 'Staging render metadata');
const secretList = readJson(option('--secret-list'), 'Wrangler secret list');

if (metadata?.contract !== 'cloudflare-staging-environment-v1'
  || typeof metadata.workerName !== 'string'
  || !Array.isArray(metadata.requiredSecretNames)
  || metadata.requiredSecretNames.length > 20
  || metadata.requiredSecretNames.some(name => typeof name !== 'string' || !/^[A-Z0-9_]{3,120}$/.test(name))) {
  throw new Error('Staging render metadata has an invalid required-secret contract');
}
if (!Array.isArray(secretList)
  || secretList.some(item => !item || typeof item !== 'object' || typeof item.name !== 'string')) {
  throw new Error('Wrangler secret list has an invalid response shape');
}

const required = [...new Set(metadata.requiredSecretNames)].sort();
const present = new Set(secretList.map(item => item.name));
const missing = required.filter(name => !present.has(name));
if (missing.length) {
  throw new Error(`Missing required staging Worker secrets: ${missing.join(', ')}`);
}

console.log(JSON.stringify({
  contract: 'cloudflare-staging-secret-presence-v1',
  workerName: metadata.workerName,
  requiredCount: required.length,
  ready: true
}));
