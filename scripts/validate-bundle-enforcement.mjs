import assert from 'node:assert/strict';
import { appendFileSync, cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const sourceDist = fileURLToPath(new URL('../dist/', import.meta.url));
const validator = fileURLToPath(new URL('./validate-bundle.mjs', import.meta.url));
const scratch = mkdtempSync(join(tmpdir(), 'sql-academy-bundle-budget-'));
const fixtureDist = join(scratch, 'dist fixture with spaces');

try {
  cpSync(sourceDist, fixtureDist, { recursive: true });
  const html = readFileSync(join(fixtureDist, 'index.html'), 'utf8');
  const entryMatch = html.match(/<script[^>]+type="module"[^>]+src="([^"]+)"/i)
    || html.match(/<script[^>]+src="([^"]+)"[^>]+type="module"/i);
  assert.ok(entryMatch, 'negative fixture cannot locate the Vite entry script');

  const entryName = basename(entryMatch[1]);
  appendFileSync(join(fixtureDist, 'assets', entryName), `\n/* injected-over-budget:${'x'.repeat(64 * 1024)} */\n`);

  const result = spawnSync(process.execPath, [validator, '--dist', fixtureDist], {
    encoding: 'utf8',
    windowsHide: true
  });
  const output = `${result.stdout || ''}${result.stderr || ''}`;
  assert.notEqual(result.status, 0, 'over-budget fixture unexpectedly passed');
  assert.match(
    output,
    /Bundle budget failed: entry .* is [\d.]+ KiB raw; budget 460 KiB/,
    `negative fixture failed without the precise entry budget message:\n${output}`
  );
  assert.doesNotMatch(output, /ENOENT|Cannot locate the Vite entry script/, 'space-containing fixture path was not resolved correctly');

  const failureLine = output.split(/\r?\n/).find(line => line.includes('Bundle budget failed: entry'));
  process.stdout.write(`Bundle negative fixture passed on a space-containing path; observed: ${failureLine}\n`);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
