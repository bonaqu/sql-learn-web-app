import { readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { gzipSync } from 'node:zlib';

const DIST = new URL('../dist/', import.meta.url);
const ASSETS = new URL('../dist/assets/', import.meta.url);
const kib = value => Math.round(value / 1024 * 10) / 10;

function fail(message) {
  console.error(`Bundle budget failed: ${message}`);
  process.exitCode = 1;
}

function fileInfo(path) {
  const bytes = statSync(path).size;
  const gzip = gzipSync(readFileSync(path)).byteLength;
  return { bytes, gzip };
}

function chunkFor(files, boundary) {
  return files.find(name => name.startsWith(`${boundary}-`) || name.includes(`-${boundary}-`));
}

const indexPath = new URL('index.html', DIST);
const html = readFileSync(indexPath, 'utf8');
const entryMatch = html.match(/<script[^>]+type="module"[^>]+src="([^"]+)"/i)
  || html.match(/<script[^>]+src="([^"]+)"[^>]+type="module"/i);
if (!entryMatch) throw new Error('Cannot locate the Vite entry script in dist/index.html');

const entryName = basename(entryMatch[1]);
const allAssets = readdirSync(ASSETS);
const files = allAssets.filter(name => /\.(?:js|css)$/.test(name));
const js = files.filter(name => name.endsWith('.js'));
const css = files.filter(name => name.endsWith('.css'));
const entryPath = join(ASSETS.pathname, entryName);
const entrySource = readFileSync(entryPath, 'utf8');
const entry = fileInfo(entryPath);
const cssTotal = css.reduce((total, name) => total + fileInfo(join(ASSETS.pathname, name)).bytes, 0);
const cssGzip = css.reduce((total, name) => total + fileInfo(join(ASSETS.pathname, name)).gzip, 0);

const ENTRY_RAW_BUDGET = 460 * 1024;
const ENTRY_GZIP_BUDGET = 155 * 1024;
const CSS_RAW_BUDGET = 280 * 1024;
const CSS_GZIP_BUDGET = 64 * 1024;
const CHUNK_RAW_BUDGET = 950 * 1024;
const CHUNK_GZIP_BUDGET = 320 * 1024;

if (entry.bytes > ENTRY_RAW_BUDGET) fail(`entry ${entryName} is ${kib(entry.bytes)} KiB raw; budget ${kib(ENTRY_RAW_BUDGET)} KiB`);
if (entry.gzip > ENTRY_GZIP_BUDGET) fail(`entry ${entryName} is ${kib(entry.gzip)} KiB gzip; budget ${kib(ENTRY_GZIP_BUDGET)} KiB`);
if (cssTotal > CSS_RAW_BUDGET) fail(`CSS total is ${kib(cssTotal)} KiB raw; budget ${kib(CSS_RAW_BUDGET)} KiB`);
if (cssGzip > CSS_GZIP_BUDGET) fail(`CSS total is ${kib(cssGzip)} KiB gzip; budget ${kib(CSS_GZIP_BUDGET)} KiB`);

for (const name of js) {
  const info = fileInfo(join(ASSETS.pathname, name));
  if (info.bytes > CHUNK_RAW_BUDGET) fail(`${name} is ${kib(info.bytes)} KiB raw; chunk budget ${kib(CHUNK_RAW_BUDGET)} KiB`);
  if (info.gzip > CHUNK_GZIP_BUDGET) fail(`${name} is ${kib(info.gzip)} KiB gzip; chunk budget ${kib(CHUNK_GZIP_BUDGET)} KiB`);
}

const boundaries = ['assessment', 'learning-path', 'CurriculumPortal', 'SyllabusPortal', 'DialectLabWorkbench', 'sqlite', 'ActivityChart', 'SqlEditor'];
for (const boundary of boundaries) {
  if (!chunkFor(js, boundary)) fail(`expected a separate ${boundary} chunk`);
}

for (const heavy of ['assessment-', 'learning-path-', 'CurriculumPortal-', 'SyllabusPortal-', 'DialectLabWorkbench-', 'sqlite-', 'ActivityChart-', 'SqlEditor-']) {
  if (html.includes(heavy)) fail(`dist/index.html eagerly references heavy chunk ${heavy}`);
}

for (const marker of ['dialect-null-ordering', 'dialect-isolation-lost-update', 'support-operations-v1']) {
  if (entrySource.includes(marker)) fail(`entry eagerly contains Dialect Lab marker ${marker}`);
}

const syllabusChunk = chunkFor(js, 'SyllabusPortal');
if (syllabusChunk) {
  const syllabusSource = readFileSync(join(ASSETS.pathname, syllabusChunk), 'utf8');
  if (syllabusSource.includes('dialect-null-ordering')) fail('SyllabusPortal chunk eagerly contains executable dialect cases');
  if (!syllabusSource.includes('DialectLabWorkbench')) fail('SyllabusPortal does not preserve the lazy DialectLabWorkbench import');
}

const dialectChunk = chunkFor(js, 'DialectLabWorkbench');
if (dialectChunk) {
  const dialectSource = readFileSync(join(ASSETS.pathname, dialectChunk), 'utf8');
  if (!dialectSource.includes('dialect-null-ordering')) fail('DialectLabWorkbench chunk is missing its manifest/case payload');
}

if (!allAssets.some(name => /^sql-wasm.*\.wasm$/.test(name))) fail('bundled sql.js WASM asset is missing');

console.log(`Bundle validation passed: entry ${kib(entry.bytes)} KiB raw / ${kib(entry.gzip)} KiB gzip; CSS ${kib(cssTotal)} KiB raw / ${kib(cssGzip)} KiB gzip; ${js.length} JS chunks with lazy Dialect Lab and bundled WASM.`);
