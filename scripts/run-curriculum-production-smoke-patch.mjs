import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const source = readFileSync('scripts/apply-curriculum-production-smoke.mjs', 'utf8')
  .replaceAll('${GITHUB_RUN_ATTEMPT}', '\\${GITHUB_RUN_ATTEMPT}');
const temporaryPath = '/tmp/apply-curriculum-production-smoke-fixed.mjs';
writeFileSync(temporaryPath, source);
await import(pathToFileURL(temporaryPath).href);
