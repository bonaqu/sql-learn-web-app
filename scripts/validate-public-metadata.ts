import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tasks } from '../src/data/course-catalog';
import { curriculumLessons } from '../src/data/complete-curriculum';

const root = new URL('../', import.meta.url);
const indexHtml = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const viteConfig = readFileSync(new URL('../vite.config.ts', import.meta.url), 'utf8');
const taskCount = tasks.length;
const lessonCount = curriculumLessons.length;
const taskClaim = `${taskCount} проверяемых`;
const lessonClaim = `${lessonCount} связанных урока`;

assert.equal(taskCount, 240, 'Public task count changed; update the intentional course scope before metadata');
assert.equal(lessonCount, 44, 'Public lesson count changed; update the intentional course scope before metadata');
assert.ok(indexHtml.includes('<html lang="ru">'), 'HTML document locale must stay Russian');
assert.ok(indexHtml.includes(taskClaim), `HTML metadata must claim the real ${taskCount} tasks`);
assert.ok(indexHtml.includes(lessonClaim), `HTML metadata must claim the real ${lessonCount} lessons`);
assert.ok(indexHtml.includes('property="og:type" content="website"'), 'OpenGraph type is missing');
assert.ok(indexHtml.includes('property="og:locale" content="ru_RU"'), 'OpenGraph locale is missing');
assert.ok(indexHtml.includes('property="og:title"'), 'OpenGraph title is missing');
assert.ok(indexHtml.includes('property="og:description"'), 'OpenGraph description is missing');
assert.ok(indexHtml.includes('name="twitter:card" content="summary"'), 'Twitter summary card is missing');
assert.ok(!indexHtml.includes('120 проверяемых'), 'Stale 120-task public claim returned');

assert.ok(viteConfig.includes("lang: 'ru'"), 'PWA manifest source locale must stay Russian');
assert.ok(viteConfig.includes(taskClaim), `PWA manifest source must claim the real ${taskCount} tasks`);
assert.ok(viteConfig.includes(lessonClaim), `PWA manifest source must claim the real ${lessonCount} lessons`);
assert.ok(viteConfig.includes("start_url: '.'"), 'PWA start URL must remain deployment-relative');
assert.ok(viteConfig.includes("scope: '.'"), 'PWA scope must remain deployment-relative');

if (process.argv.includes('--dist')) {
  const dist = new URL('../dist/', import.meta.url);
  assert.ok(existsSync(dist), 'Production dist directory is missing');
  const builtHtml = readFileSync(new URL('../dist/index.html', import.meta.url), 'utf8');
  assert.ok(builtHtml.includes(taskClaim), 'Built HTML lost the current task count');
  assert.ok(builtHtml.includes(lessonClaim), 'Built HTML lost the current lesson count');
  assert.ok(builtHtml.includes('property="og:locale" content="ru_RU"'), 'Built HTML lost OpenGraph locale');

  const distPath = join(root.pathname, 'dist');
  const manifestName = readdirSync(distPath).find(name => name === 'manifest.webmanifest' || /^manifest-.*\.webmanifest$/.test(name));
  assert.ok(manifestName, 'Built PWA manifest is missing');
  const manifest = JSON.parse(readFileSync(join(distPath, manifestName!), 'utf8')) as {
    lang?: string;
    description?: string;
    start_url?: string;
    scope?: string;
  };
  assert.equal(manifest.lang, 'ru', 'Built PWA manifest locale is not Russian');
  assert.ok(manifest.description?.includes(taskClaim), 'Built PWA manifest lost the current task count');
  assert.ok(manifest.description?.includes(lessonClaim), 'Built PWA manifest lost the current lesson count');
  assert.equal(manifest.start_url, '.', 'Built PWA start URL is not deployment-relative');
  assert.equal(manifest.scope, '.', 'Built PWA scope is not deployment-relative');
}

console.log(`Public metadata validated: ${taskCount} tasks, ${lessonCount} lessons, Russian HTML/PWA locale and deployment-relative manifest scope.`);
