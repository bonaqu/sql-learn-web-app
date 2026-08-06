import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadProductIdentity, productFullTitle } from './product-identity';

const root = resolve(import.meta.dirname, '..');
const distMode = process.argv.includes('--dist');
const identity = loadProductIdentity(root);

function read(path: string) {
  return readFileSync(resolve(root, path), 'utf8').replace(/\r\n/g, '\n');
}

const license = read('LICENSE');
const firstLicenseLine = license.split('\n').map(line => line.trim()).find(Boolean);
assert.equal(firstLicenseLine, identity.licenseName,
  'config/product-identity.json licenseName must equal the first non-empty LICENSE line.');

const packageManifest = JSON.parse(read('package.json')) as { license?: unknown; scripts?: Record<string, string> };
assert.equal(packageManifest.license, 'SEE LICENSE IN LICENSE');
assert.ok(packageManifest.scripts?.['identity:generate']?.includes('generate-product-identity.ts'));
assert.ok(packageManifest.scripts?.['identity:check']?.includes('generate-product-identity.ts --check'));
assert.ok(packageManifest.scripts?.['validate:product-identity']?.includes('validate-product-identity.ts'));
assert.ok(packageManifest.scripts?.check?.includes('validate:product-identity'));

const generated = read('src/generated/product-identity.ts');
for (const value of [identity.productName, identity.shortName, identity.trackName, identity.description]) {
  assert.ok(generated.includes(JSON.stringify(value)), `Generated identity module is missing ${value}`);
}
assert.ok(generated.includes(`export const productFullTitle = ${JSON.stringify(productFullTitle(identity))}`));

const sourceManifest = JSON.parse(read('public/manifest.webmanifest')) as {
  name: string;
  short_name: string;
  description: string;
  lang: string;
  start_url: string;
  scope: string;
};
assert.equal(sourceManifest.name, productFullTitle(identity));
assert.equal(sourceManifest.short_name, identity.shortName);
assert.equal(sourceManifest.description, identity.description);
assert.equal(sourceManifest.lang, identity.locale);
assert.equal(sourceManifest.start_url, './');
assert.equal(sourceManifest.scope, './');

const html = read('index.html');
for (const token of [
  '__PRODUCT_LOCALE__',
  '__PRODUCT_FULL_TITLE__',
  '__PRODUCT_DESCRIPTION__',
  '__PRODUCT_NAME__',
  '__PRODUCT_LICENSE_NAME__',
  '__PRODUCT_PRIVACY_SUMMARY__',
  '<!-- PRODUCT_CANONICAL -->'
]) assert.ok(html.includes(token), `index.html is missing product identity token ${token}`);
assert.doesNotMatch(html, /Open-source|open source|contains no personal data/i);
assert.doesNotMatch(html, /bonaqu\.github\.io|github\.com\/bonaqu/i,
  'Public HTML must receive buyer URLs through the identity transform, not source hardcodes.');

const vite = read('vite.config.ts');
for (const marker of [
  "loadProductIdentity(process.cwd())",
  'productFullTitle(identity)',
  'transformIndexHtml',
  "html.replaceAll('__PRODUCT_NAME__'",
  "html.replace('<!-- PRODUCT_CANONICAL -->'",
  'identity.shortName',
  'identity.description',
  'identity.locale'
]) assert.ok(vite.includes(marker), `vite.config.ts is missing identity integration ${marker}`);
assert.doesNotMatch(vite, /name:\s*'SQL Academy|short_name:\s*'SQL Academy/);

const app = read('src/App.tsx');
assert.ok(app.includes("from './generated/product-identity'"));
assert.ok(app.includes('productIdentity.productName'));
assert.ok(app.includes('productIdentity.repositoryUrl'));
assert.ok(app.includes('productIdentity.supportUrl'));
assert.ok(app.includes('productIdentity.licenseLabel'));
assert.ok(app.includes('productIdentity.privacyLabel'));
assert.doesNotMatch(app, />SQL Academy<|Open-source · privacy-first|https:\/\/github\.com\/bonaqu\/sql-learn-web-app/);

const commercialIdentity = read('src/components/CommercialIdentityPortal.tsx');
assert.ok(commercialIdentity.includes("from '../generated/product-identity'"));
assert.ok(commercialIdentity.includes('productIdentity.productName'));
assert.doesNotMatch(commercialIdentity, /SQL Academy сохраняет HMAC/);

const readme = read('README.md');
assert.doesNotMatch(readme, /^Open-source|open-source|open source/mi);
assert.ok(readme.includes('Коммерчески лицензируемая'));
assert.ok(readme.includes('docs/product-identity-handoff.md'));
assert.ok(readme.includes('config/product-identity.json'));

const runbook = read('docs/product-identity-handoff.md');
for (const marker of [
  'product-identity-v1',
  'config/product-identity.json',
  'npm run identity:generate',
  'npm run identity:check',
  'Внутренние ключи хранения',
  'supportUrl',
  'LICENSE'
]) assert.ok(runbook.includes(marker), `Product identity runbook is missing ${marker}`);

const publicSurfaces = [html, app, commercialIdentity, readme, runbook].join('\n');
assert.doesNotMatch(publicSurfaces, /This project contains no personal data/i);
assert.doesNotMatch(publicSurfaces, /Open-source · privacy-first/i);

if (distMode) {
  const distIndexPath = resolve(root, 'dist/index.html');
  const distManifestPath = resolve(root, 'dist/manifest.webmanifest');
  assert.ok(existsSync(distIndexPath), 'dist/index.html is missing');
  assert.ok(existsSync(distManifestPath), 'dist/manifest.webmanifest is missing');
  const distIndex = readFileSync(distIndexPath, 'utf8');
  const distManifest = JSON.parse(readFileSync(distManifestPath, 'utf8')) as {
    name: string;
    short_name: string;
    description: string;
    lang: string;
  };
  assert.ok(distIndex.includes(`<title>${productFullTitle(identity)}</title>`));
  assert.ok(distIndex.includes(`content="${identity.licenseName}"`));
  assert.ok(distIndex.includes(`href="${identity.homepageUrl}"`));
  assert.doesNotMatch(distIndex, /__PRODUCT_[A-Z_]+__/);
  assert.equal(distManifest.name, productFullTitle(identity));
  assert.equal(distManifest.short_name, identity.shortName);
  assert.equal(distManifest.description, identity.description);
  assert.equal(distManifest.lang, identity.locale);
}

console.log(`Product identity validated: ${identity.contract}, one commercial license statement, synchronized HTML/PWA/runtime surfaces and buyer-owned support URLs.`);
