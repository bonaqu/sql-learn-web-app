import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tasks } from '../src/data/course-catalog';
import { curriculumLessons } from '../src/data/complete-curriculum';
import { loadProductIdentity, productFullTitle } from './product-identity';

const root = fileURLToPath(new URL('..', import.meta.url));
const identity = loadProductIdentity(root);
const indexHtml = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const viteConfig = readFileSync(new URL('../vite.config.ts', import.meta.url), 'utf8');
const taskCount = tasks.length;
const lessonCount = curriculumLessons.length;
const taskClaim = `${taskCount} проверяемых`;
const lessonClaim = `${lessonCount} связанных урока`;

assert.equal(taskCount, 240, 'Public task count changed; update the intentional course scope before metadata');
assert.equal(lessonCount, 44, 'Public lesson count changed; update the intentional course scope before metadata');
assert.equal(identity.locale, 'ru', 'The current buyer identity must keep the Russian product locale');
assert.ok(identity.description.includes(taskClaim), `Identity description must claim the real ${taskCount} tasks`);
assert.ok(identity.description.includes(lessonClaim), `Identity description must claim the real ${lessonCount} lessons`);
assert.ok(indexHtml.includes('<html lang="__PRODUCT_LOCALE__">'), 'HTML locale must come from product identity');
assert.ok(indexHtml.includes('__PRODUCT_DESCRIPTION__'), 'HTML description must come from product identity');
assert.ok(indexHtml.includes('__PRODUCT_FULL_TITLE__'), 'HTML title must come from product identity');
assert.ok(indexHtml.includes('__PRODUCT_LICENSE_NAME__'), 'HTML license metadata must come from product identity');
assert.ok(indexHtml.includes('__PRODUCT_PRIVACY_SUMMARY__'), 'HTML privacy metadata must come from product identity');
assert.ok(indexHtml.includes('property="og:type" content="website"'), 'OpenGraph type is missing');
assert.ok(indexHtml.includes('property="og:locale" content="__PRODUCT_OG_LOCALE__"'), 'OpenGraph locale token is missing');
assert.ok(indexHtml.includes('property="og:title"'), 'OpenGraph title is missing');
assert.ok(indexHtml.includes('property="og:description"'), 'OpenGraph description is missing');
assert.ok(indexHtml.includes('name="twitter:card" content="summary"'), 'Twitter summary card is missing');
assert.ok(!indexHtml.includes('120 проверяемых'), 'Stale 120-task public claim returned');
assert.doesNotMatch(indexHtml, /Open-source|This project contains no personal data/i);

assert.ok(viteConfig.includes('loadProductIdentity(process.cwd())'), 'Vite must load the buyer identity contract');
assert.ok(viteConfig.includes('name: fullTitle'), 'PWA name must use the full identity title');
assert.ok(viteConfig.includes('short_name: identity.shortName'), 'PWA short name must use identity');
assert.ok(viteConfig.includes('description: identity.description'), 'PWA description must use identity');
assert.ok(viteConfig.includes('lang: identity.locale'), 'PWA locale must use identity');
assert.ok(viteConfig.includes("start_url: '.'"), 'PWA start URL must remain deployment-relative');
assert.ok(viteConfig.includes("scope: '.'"), 'PWA scope must remain deployment-relative');

if (process.argv.includes('--dist')) {
  const distUrl = new URL('../dist/', import.meta.url);
  const distPath = fileURLToPath(distUrl);
  assert.ok(existsSync(distPath), 'Production dist directory is missing');
  const builtHtml = readFileSync(new URL('../dist/index.html', import.meta.url), 'utf8');
  assert.ok(builtHtml.includes(taskClaim), 'Built HTML lost the current task count');
  assert.ok(builtHtml.includes(lessonClaim), 'Built HTML lost the current lesson count');
  assert.ok(builtHtml.includes(`<title>${productFullTitle(identity)}</title>`), 'Built HTML lost the buyer title');
  assert.ok(builtHtml.includes(`content="${identity.licenseName}"`), 'Built HTML lost the commercial license statement');
  assert.ok(builtHtml.includes(`href="${identity.homepageUrl}"`), 'Built HTML lost the canonical homepage');
  assert.ok(builtHtml.includes('property="og:locale" content="ru_RU"'), 'Built HTML lost OpenGraph locale');
  assert.doesNotMatch(builtHtml, /__PRODUCT_[A-Z_]+__|Open-source|This project contains no personal data/i);

  const manifestName = readdirSync(distPath).find(name => name === 'manifest.webmanifest' || /^manifest-.*\.webmanifest$/.test(name));
  assert.ok(manifestName, 'Built PWA manifest is missing');
  const manifest = JSON.parse(readFileSync(join(distPath, manifestName!), 'utf8')) as {
    name?: string;
    short_name?: string;
    lang?: string;
    description?: string;
    start_url?: string;
    scope?: string;
  };
  assert.equal(manifest.name, productFullTitle(identity));
  assert.equal(manifest.short_name, identity.shortName);
  assert.equal(manifest.lang, identity.locale, 'Built PWA manifest locale is not buyer-controlled');
  assert.equal(manifest.description, identity.description);
  assert.equal(manifest.start_url, '.', 'Built PWA start URL is not deployment-relative');
  assert.equal(manifest.scope, '.', 'Built PWA scope is not deployment-relative');
}

console.log(`Public metadata validated: ${taskCount} tasks, ${lessonCount} lessons, ${identity.contract}, commercial license metadata and deployment-relative PWA scope.`);
