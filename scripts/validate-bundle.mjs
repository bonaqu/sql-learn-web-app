import { readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const distFlag = process.argv.indexOf('--dist');
if (distFlag >= 0 && !process.argv[distFlag + 1]) throw new Error('--dist requires a directory path');
const DIST_PATH = distFlag >= 0
  ? resolve(process.argv[distFlag + 1])
  : fileURLToPath(new URL('../dist/', import.meta.url));
const ASSETS_PATH = join(DIST_PATH, 'assets');
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

const indexPath = join(DIST_PATH, 'index.html');
const html = readFileSync(indexPath, 'utf8');
const entryMatch = html.match(/<script[^>]+type="module"[^>]+src="([^"]+)"/i)
  || html.match(/<script[^>]+src="([^"]+)"[^>]+type="module"/i);
if (!entryMatch) throw new Error('Cannot locate the Vite entry script in dist/index.html');

const entryName = basename(entryMatch[1]);
const allAssets = readdirSync(ASSETS_PATH);
const files = allAssets.filter(name => /\.(?:js|css)$/.test(name));
const js = files.filter(name => name.endsWith('.js'));
const css = files.filter(name => name.endsWith('.css'));
const entryPath = join(ASSETS_PATH, entryName);
const entrySource = readFileSync(entryPath, 'utf8');
const entry = fileInfo(entryPath);
const monacoCss = css.filter(name => name.startsWith('monaco-'));
const productCss = css.filter(name => !monacoCss.includes(name));
const totalFor = (names, field) => names.reduce(
  (total, name) => total + fileInfo(join(ASSETS_PATH, name))[field],
  0
);
const cssTotal = totalFor(productCss, 'bytes');
const cssGzip = totalFor(productCss, 'gzip');
const monacoCssTotal = totalFor(monacoCss, 'bytes');
const monacoCssGzip = totalFor(monacoCss, 'gzip');

const ENTRY_RAW_BUDGET = 460 * 1024;
const ENTRY_GZIP_BUDGET = 155 * 1024;
const CSS_RAW_BUDGET = 280 * 1024;
const CSS_GZIP_BUDGET = 64 * 1024;
const MONACO_CSS_RAW_BUDGET = 96 * 1024;
const MONACO_CSS_GZIP_BUDGET = 24 * 1024;
const CHUNK_RAW_BUDGET = 950 * 1024;
const CHUNK_GZIP_BUDGET = 320 * 1024;

if (entry.bytes > ENTRY_RAW_BUDGET) fail(`entry ${entryName} is ${kib(entry.bytes)} KiB raw; budget ${kib(ENTRY_RAW_BUDGET)} KiB`);
if (entry.gzip > ENTRY_GZIP_BUDGET) fail(`entry ${entryName} is ${kib(entry.gzip)} KiB gzip; budget ${kib(ENTRY_GZIP_BUDGET)} KiB`);
if (cssTotal > CSS_RAW_BUDGET) fail(`CSS total is ${kib(cssTotal)} KiB raw; budget ${kib(CSS_RAW_BUDGET)} KiB`);
if (cssGzip > CSS_GZIP_BUDGET) fail(`CSS total is ${kib(cssGzip)} KiB gzip; budget ${kib(CSS_GZIP_BUDGET)} KiB`);
if (monacoCssTotal > MONACO_CSS_RAW_BUDGET) fail(`lazy Monaco CSS is ${kib(monacoCssTotal)} KiB raw; budget ${kib(MONACO_CSS_RAW_BUDGET)} KiB`);
if (monacoCssGzip > MONACO_CSS_GZIP_BUDGET) fail(`lazy Monaco CSS is ${kib(monacoCssGzip)} KiB gzip; budget ${kib(MONACO_CSS_GZIP_BUDGET)} KiB`);

for (const name of js) {
  const info = fileInfo(join(ASSETS_PATH, name));
  if (info.bytes > CHUNK_RAW_BUDGET) fail(`${name} is ${kib(info.bytes)} KiB raw; chunk budget ${kib(CHUNK_RAW_BUDGET)} KiB`);
  if (info.gzip > CHUNK_GZIP_BUDGET) fail(`${name} is ${kib(info.gzip)} KiB gzip; chunk budget ${kib(CHUNK_GZIP_BUDGET)} KiB`);
}

const boundaries = ['assessment', 'learning-path', 'CurriculumPortal', 'SyllabusPortal', 'DialectLabWorkbench', 'sqlite', 'SqlEditor'];
for (const boundary of boundaries) {
  if (!chunkFor(js, boundary)) fail(`expected a separate ${boundary} chunk`);
}

for (const heavy of ['assessment-', 'learning-path-', 'CurriculumPortal-', 'SyllabusPortal-', 'DialectLabWorkbench-', 'sqlite-', 'SqlEditor-']) {
  if (html.includes(heavy)) fail(`dist/index.html eagerly references heavy chunk ${heavy}`);
}

for (const marker of ['dialect-null-ordering', 'dialect-isolation-lost-update', 'support-operations-v1']) {
  if (entrySource.includes(marker)) fail(`entry eagerly contains Dialect Lab marker ${marker}`);
}

const syllabusChunk = chunkFor(js, 'SyllabusPortal');
if (syllabusChunk) {
  const syllabusSource = readFileSync(join(ASSETS_PATH, syllabusChunk), 'utf8');
  if (syllabusSource.includes('dialect-null-ordering')) fail('SyllabusPortal chunk eagerly contains executable dialect cases');
  if (!syllabusSource.includes('DialectLabWorkbench')) fail('SyllabusPortal does not preserve the lazy DialectLabWorkbench import');
}

const dialectChunk = chunkFor(js, 'DialectLabWorkbench');
if (dialectChunk) {
  const dialectSource = readFileSync(join(ASSETS_PATH, dialectChunk), 'utf8');
  if (!dialectSource.includes('dialect-null-ordering')) fail('DialectLabWorkbench chunk is missing its manifest/case payload');
}

if (!allAssets.some(name => /^sql-wasm.*\.wasm$/.test(name))) fail('bundled sql.js WASM asset is missing');
if (!allAssets.some(name => /^editor\.worker-.*\.js$/.test(name))) fail('local Monaco editor worker asset is missing');
if (!js.some(name => name.startsWith('monaco-'))) fail('local Monaco chunks are missing');

const sqlEditorSource = readFileSync(fileURLToPath(new URL('../src/components/SqlEditor.tsx', import.meta.url)), 'utf8');
if (/https?:\/\/|cdn\.jsdelivr\.net/i.test(sqlEditorSource)) fail('SqlEditor source still declares an external runtime dependency');
if (!/loader\.config\(\{\s*monaco\s*\}\)/.test(sqlEditorSource)) fail('SqlEditor does not configure the bundled Monaco runtime');
if (!/editor\.worker\?worker/.test(sqlEditorSource)) fail('SqlEditor does not configure the bundled Monaco worker');

process.stdout.write(`Bundle validation passed: dist ${DIST_PATH}; entry ${kib(entry.bytes)} KiB raw / ${kib(entry.gzip)} KiB gzip; product CSS ${kib(cssTotal)} KiB raw / ${kib(cssGzip)} KiB gzip; lazy Monaco CSS ${kib(monacoCssTotal)} KiB raw / ${kib(monacoCssGzip)} KiB gzip; ${js.length} JS chunks with lazy Dialect Lab, local Monaco, and bundled WASM.\n`);
