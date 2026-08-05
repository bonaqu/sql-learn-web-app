import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const manifestPath = join(root, 'package.json');
const lockPath = join(root, 'package-lock.json');
const inventoryPath = join(root, 'docs', 'third-party-dependencies.json');
const noticesPath = join(root, 'THIRD_PARTY_NOTICES.md');
const workflowsDirectory = join(root, '.github', 'workflows');

function readJson(path) {
  assert.ok(existsSync(path), `${path.replace(`${root}/`, '')} is missing`);
  return JSON.parse(readFileSync(path, 'utf8'));
}

function sortedRecord(value = {}) {
  return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)));
}

const manifest = readJson(manifestPath);
const lock = readJson(lockPath);
const inventory = readJson(inventoryPath);
const notices = readFileSync(noticesPath, 'utf8');

assert.equal(lock.lockfileVersion, 3, 'npm lockfileVersion must remain 3');
assert.ok(lock.packages && lock.packages[''], 'package-lock root package entry is missing');
assert.deepEqual(
  sortedRecord(lock.packages[''].dependencies),
  sortedRecord(manifest.dependencies),
  'Runtime dependency specs drifted between package.json and package-lock.json'
);
assert.deepEqual(
  sortedRecord(lock.packages[''].devDependencies),
  sortedRecord(manifest.devDependencies),
  'Development dependency specs drifted between package.json and package-lock.json'
);

const lockedEntries = Object.entries(lock.packages)
  .filter(([location, entry]) => location && location.includes('node_modules/') && entry && !entry.link);
assert.equal(inventory.schemaVersion, 1, 'Unsupported dependency inventory schema');
assert.equal(inventory.lockfileVersion, lock.lockfileVersion, 'Inventory lockfile version is stale');
assert.equal(inventory.lockedPackageCount, lockedEntries.length, 'Inventory does not cover every lockfile package entry');
assert.equal(
  inventory.installedPackageCount + inventory.uninstalledPlatformOptionalCount,
  inventory.lockedPackageCount,
  'Installed and platform-optional inventory counts do not reconcile'
);
assert.equal(inventory.packages.length, inventory.installedPackageCount, 'Installed package inventory count is stale');
assert.equal(
  inventory.uninstalledPlatformOptional.length,
  inventory.uninstalledPlatformOptionalCount,
  'Platform-optional inventory count is stale'
);

for (const item of inventory.packages) {
  assert.ok(item.name && item.version && item.packagePath, 'Installed dependency identity is incomplete');
  assert.ok(item.license && !/^(unknown|unlicensed)$/i.test(item.license), `${item.name}@${item.version} has unacceptable license metadata`);
  assert.ok(notices.includes(`\`${item.name}@${item.version}\``), `${item.name}@${item.version} is missing from THIRD_PARTY_NOTICES.md`);
}
for (const item of inventory.uninstalledPlatformOptional) {
  assert.ok(item.name && item.version && item.packagePath && item.integrity, 'Platform-optional lock identity is incomplete');
  assert.ok(notices.includes(`\`${item.name}@${item.version}\``), `${item.name}@${item.version} platform-optional entry is missing from notices`);
}

const workflowFiles = readdirSync(workflowsDirectory, { withFileTypes: true })
  .filter(entry => entry.isFile() && /\.ya?ml$/i.test(entry.name))
  .map(entry => join(workflowsDirectory, entry.name));
assert.ok(workflowFiles.length, 'No GitHub Actions workflows were found');

const floatingInstalls = [];
let lockedInstallCount = 0;
for (const path of workflowFiles) {
  const relative = path.replace(`${root}/`, '');
  const source = readFileSync(path, 'utf8');
  const lines = source.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (/\bnpm\s+ci\b/.test(line)) lockedInstallCount += 1;
    if (/\bnpm\s+install\b/.test(line) && !/--package-lock-only\b/.test(line)) {
      floatingInstalls.push(`${relative}:${index + 1}: ${line.trim()}`);
    }
  }
}
assert.equal(
  floatingInstalls.length,
  0,
  `Floating npm installs are forbidden after lockfile adoption:\n${floatingInstalls.join('\n')}`
);
assert.ok(lockedInstallCount > 0, 'At least one workflow must install dependencies with npm ci');

console.log(`Dependency governance validated: ${inventory.lockedPackageCount} locked entries, ${inventory.installedPackageCount} installed notices, ${inventory.uninstalledPlatformOptionalCount} explicit platform optionals, ${lockedInstallCount} npm ci workflow steps.`);
