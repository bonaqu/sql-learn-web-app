import { createHash } from 'node:crypto';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { chromium } from '@playwright/test';

const mode = process.argv[2];
if (mode !== 'seed' && mode !== 'verify') {
  throw new Error('Usage: node scripts/pwa-first-reload-smoke.mjs <seed|verify>');
}

const targetUrl = new URL(process.env.PWA_SMOKE_URL || 'https://bonaqu.github.io/sql-learn-web-app/').href;
const profilePath = resolve(process.env.PWA_SMOKE_PROFILE || 'test-results/pwa-old-worker-profile');
const reportPath = resolve(process.env.PWA_SMOKE_REPORT || 'test-results/pwa-old-worker.json');
const screenshotPath = resolve(dirname(reportPath), `pwa-old-worker-${mode}.png`);

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function sha256(url) {
  const response = await fetch(`${url}sw.js?phase12-probe=${Date.now()}`, { redirect: 'follow' });
  if (!response.ok) throw new Error(`Service Worker returned HTTP ${response.status}`);
  return createHash('sha256').update(Buffer.from(await response.arrayBuffer())).digest('hex');
}

async function browserState(page) {
  return page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    return {
      entryScript: document.querySelector('script[type="module"]')?.getAttribute('src') || '',
      controllerScript: navigator.serviceWorker.controller?.scriptURL || '',
      activeScript: registration.active?.scriptURL || '',
      waitingScript: registration.waiting?.scriptURL || '',
      cacheNames: await caches.keys()
    };
  });
}

await mkdir(dirname(reportPath), { recursive: true });
if (mode === 'seed' && await exists(reportPath)) {
  throw new Error(`Seed report already exists: ${reportPath}`);
}
if (mode === 'verify' && !await exists(reportPath)) {
  throw new Error(`Seed report is missing: ${reportPath}`);
}

const context = await chromium.launchPersistentContext(profilePath, {
  headless: true,
  viewport: { width: 390, height: 844 }
});

try {
  const page = context.pages()[0] || await context.newPage();
  if (mode === 'seed') {
    await page.goto(targetUrl, { waitUntil: 'networkidle' });
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
    const seeded = await browserState(page);
    if (!seeded.entryScript || !seeded.controllerScript || seeded.cacheNames.length === 0) {
      throw new Error(`Old-worker seed is incomplete: ${JSON.stringify(seeded)}`);
    }
    const report = {
      targetUrl,
      seededAt: new Date().toISOString(),
      oldWorkerSha256: await sha256(targetUrl),
      seeded
    };
    await page.screenshot({ path: screenshotPath, fullPage: true });
    await writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8');
    process.stdout.write(`PWA old-worker seed ready: ${JSON.stringify(report)}\n`);
  } else {
    const report = JSON.parse(await readFile(reportPath, 'utf8'));
    let mainNavigations = 0;
    page.on('framenavigated', frame => { if (frame === page.mainFrame()) mainNavigations += 1; });
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
    const firstReload = await browserState(page);
    if (firstReload.entryScript !== report.seeded.entryScript) {
      throw new Error(`First reload bypassed the old cached entry: ${firstReload.entryScript} !== ${report.seeded.entryScript}`);
    }
    await page.getByTestId('pwa-update-notice').waitFor({ state: 'visible', timeout: 45_000 });
    await page.screenshot({ path: screenshotPath, fullPage: true });
    const navigationsBeforeUpdate = mainNavigations;
    await page.getByTestId('pwa-update-notice').getByRole('button', { name: 'Обновить сейчас' }).click();
    await page.waitForFunction(oldEntry => document.querySelector('script[type="module"]')?.getAttribute('src') !== oldEntry, report.seeded.entryScript, { timeout: 45_000 });
    await page.waitForLoadState('networkidle');
    const updated = await browserState(page);
    const updateReloads = mainNavigations - navigationsBeforeUpdate;
    if (updateReloads !== 1) throw new Error(`Expected one confirmed update reload, observed ${updateReloads}`);
    if (!updated.entryScript || updated.entryScript === report.seeded.entryScript) {
      throw new Error('Confirmed update did not activate a new hashed entry');
    }
    const verified = {
      ...report,
      verifiedAt: new Date().toISOString(),
      newWorkerSha256: await sha256(targetUrl),
      firstReload,
      updateReloads,
      updated
    };
    if (verified.newWorkerSha256 === verified.oldWorkerSha256) throw new Error('Service Worker content hash did not change');
    await writeFile(reportPath, JSON.stringify(verified, null, 2), 'utf8');
    process.stdout.write(`PWA old-worker first-reload smoke passed: ${JSON.stringify(verified)}\n`);
  }
} finally {
  await context.close();
}
