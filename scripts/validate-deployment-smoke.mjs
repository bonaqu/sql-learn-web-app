import { readFileSync } from 'node:fs';

const workflow = readFileSync('.github/workflows/cloudflare.yml', 'utf8');
const smoke = readFileSync('scripts/cloudflare-production-smoke.mjs', 'utf8');
const conceptSmoke = readFileSync('scripts/concept-progress-production-smoke.mjs', 'utf8');
const checkpointSmoke = readFileSync('scripts/checkpoint-production-smoke.mjs', 'utf8');
const core = readFileSync('worker/core.ts', 'utf8');
const curriculumWorker = readFileSync('worker/curriculum.ts', 'utf8');
const errors = [];
const requireText = (source, text, label) => {
  if (!source.includes(text)) errors.push(`Missing ${label}: ${text}`);
};
const forbidText = (source, text, label) => {
  if (source.includes(text)) errors.push(`Forbidden ${label}: ${text}`);
};

requireText(core, 'curriculumVersion: 1', 'health curriculum version');
requireText(workflow, 'node scripts/cloudflare-production-smoke.mjs', 'production smoke entrypoint');
requireText(workflow, 'node scripts/concept-progress-production-smoke.mjs', 'concept history smoke entrypoint');
requireText(workflow, 'node scripts/checkpoint-production-smoke.mjs', 'checkpoint smoke entrypoint');
requireText(workflow, 'cloudflare-smoke-stage.txt', 'curriculum stage diagnostics');
requireText(workflow, 'cloudflare-concepts-stage.txt', 'concept stage diagnostics');
requireText(workflow, 'cloudflare-checkpoint-stage.txt', 'checkpoint stage diagnostics');
requireText(smoke, 'expected: [409]', 'stale-write conflict check');
requireText(smoke, 'expected: [401]', 'revoked session check');
requireText(smoke, "'--yes'", 'non-interactive D1 execution');
requireText(smoke, 'verifyCascade()', 'curriculum D1 cascade verification');
requireText(smoke, 'redactRegistration', 'registration redaction');
requireText(smoke, 'tokenPresent', 'non-secret token evidence');
requireText(smoke, 'curriculumVersion === 1', 'deployed schema propagation check');

requireText(curriculumWorker, 'MAX_ANSWERS = 220', 'bounded curriculum answer history');
requireText(conceptSmoke, 'curriculumProgress(144', 'full concept answer round-trip');
requireText(conceptSmoke, 'curriculumProgress(221', 'answer ceiling rejection');
requireText(conceptSmoke, "expectStatus(rejected, 400", 'invalid concept payload status');
requireText(conceptSmoke, 'verify-valid-state-preserved', 'rejected payload state preservation');
requireText(conceptSmoke, "expectStatus(revoked, 401", 'concept revoked session check');
requireText(conceptSmoke, "confirm: 'DELETE'", 'concept smoke account cleanup');

requireText(checkpointSmoke, "'/api/checkpoints/reports'", 'checkpoint report endpoint lifecycle');
requireText(checkpointSmoke, 'expected: [403]', 'checkpoint owner mismatch check');
requireText(checkpointSmoke, 'expected: [401]', 'checkpoint revoked session check');
requireText(checkpointSmoke, 'verifyCheckpointCascade()', 'checkpoint D1 cascade verification');
requireText(checkpointSmoke, 'FROM checkpoint_reports', 'checkpoint report cleanup query');
requireText(checkpointSmoke, "'--yes'", 'checkpoint non-interactive D1 execution');
requireText(checkpointSmoke, 'tokenPresent', 'checkpoint registration redaction');
requireText(checkpointSmoke, 'checkpointRoundTripVerified', 'checkpoint round-trip summary');

forbidText(workflow, 'cloudflare-register-payload.json', 'password-bearing diagnostic');
forbidText(workflow, 'cloudflare-delete-payload.json', 'recovery-bearing diagnostic');
forbidText(workflow, 'cloudflare-register.json', 'token-bearing diagnostic');
forbidText(smoke, "writeJson('cloudflare-register.json'", 'raw registration response write');
forbidText(smoke, "writeJson('cloudflare-delete-payload.json'", 'raw delete payload write');
forbidText(conceptSmoke, 'fs.writeFile(token', 'concept token diagnostic write');
forbidText(conceptSmoke, 'fs.writeFile(recoveryCode', 'concept recovery diagnostic write');
forbidText(checkpointSmoke, "writeJson('cloudflare-checkpoint-register.json'", 'raw checkpoint registration response write');
forbidText(checkpointSmoke, "writeJson('cloudflare-checkpoint-delete-payload.json'", 'raw checkpoint delete payload write');
forbidText(checkpointSmoke, "writeJson('cloudflare-checkpoint-auth.json'", 'raw checkpoint auth response write');

if (errors.length) {
  console.error(`Deployment smoke validation failed with ${errors.length} issue(s):`);
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log('Deployment smoke validation passed: curriculum, full concept history and checkpoint lifecycles include bounded payloads, state preservation, revoked-session, cascade and redaction contracts.');
