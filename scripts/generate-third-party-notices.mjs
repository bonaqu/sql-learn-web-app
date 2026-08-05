import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const checkOnly = process.argv.includes('--check');
const packagePath = join(root, 'package.json');
const lockPath = join(root, 'package-lock.json');
const inventoryPath = join(root, 'docs', 'third-party-dependencies.json');
const noticesPath = join(root, 'THIRD_PARTY_NOTICES.md');

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function normalizeLicense(value) {
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) return value.map(normalizeLicense).filter(Boolean).join(' OR ');
  if (value && typeof value === 'object') return normalizeLicense(value.type || value.name);
  return '';
}

function normalizeRepository(value) {
  const source = typeof value === 'string' ? value : value?.url;
  if (!source) return '';
  return String(source)
    .replace(/^git\+/, '')
    .replace(/^git:\/\//, 'https://')
    .replace(/\.git$/, '');
}

function matchingNoticeFiles(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true })
    .filter(entry => entry.isFile() && /^(licen[cs]e|copying|notice)([-_.].*)?$/i.test(entry.name))
    .map(entry => entry.name)
    .sort((left, right) => left.localeCompare(right));
}

function packageKind(location, name, manifest) {
  const directDependencies = new Set(Object.keys(manifest.dependencies || {}));
  const directDevDependencies = new Set(Object.keys(manifest.devDependencies || {}));
  if (location === `node_modules/${name}` && directDependencies.has(name)) return 'direct-runtime';
  if (location === `node_modules/${name}` && directDevDependencies.has(name)) return 'direct-development';
  return 'transitive';
}

function lockedName(location) {
  return location.split('node_modules/').at(-1) || location;
}

function packageMetadata(location, lockEntry, manifest) {
  const directory = join(root, location);
  const metadataPath = join(directory, 'package.json');
  if (!existsSync(metadataPath)) {
    if (!lockEntry.optional && !lockEntry.os && !lockEntry.cpu) {
      throw new Error(`Installed package metadata is missing for required entry ${location}`);
    }
    return {
      installed: false,
      name: lockedName(location),
      version: lockEntry.version || '',
      packagePath: location,
      optional: Boolean(lockEntry.optional),
      os: Array.isArray(lockEntry.os) ? lockEntry.os : [],
      cpu: Array.isArray(lockEntry.cpu) ? lockEntry.cpu : [],
      resolved: lockEntry.resolved || '',
      integrity: lockEntry.integrity || ''
    };
  }

  const metadata = readJson(metadataPath);
  const name = metadata.name || lockedName(location);
  const version = metadata.version || lockEntry.version;
  const license = normalizeLicense(metadata.license || metadata.licenses);
  if (!name || !version) throw new Error(`Package identity is incomplete for ${location}`);
  if (!license || /^(unknown|unlicensed)$/i.test(license)) {
    throw new Error(`Package ${name}@${version} has no acceptable license metadata`);
  }

  const noticeFiles = matchingNoticeFiles(directory).map(file => ({
    file,
    text: readFileSync(join(directory, file), 'utf8').replace(/\r\n/g, '\n').trim()
  })).filter(item => item.text);

  return {
    installed: true,
    name,
    version,
    kind: packageKind(location, name, manifest),
    license,
    repository: normalizeRepository(metadata.repository),
    homepage: typeof metadata.homepage === 'string' ? metadata.homepage : '',
    packagePath: location,
    noticeFiles
  };
}

function sortIdentity(left, right) {
  return left.name.localeCompare(right.name)
    || left.version.localeCompare(right.version)
    || left.packagePath.localeCompare(right.packagePath);
}

function buildOutputs() {
  if (!existsSync(lockPath)) throw new Error('package-lock.json is required. Generate it with npm install first.');
  const manifest = readJson(packagePath);
  const lock = readJson(lockPath);
  if (!lock.packages || typeof lock.packages !== 'object') {
    throw new Error('package-lock.json must contain the npm packages map');
  }

  const lockedEntries = Object.entries(lock.packages)
    .filter(([location, entry]) => location && location.includes('node_modules/') && entry && !entry.link);
  const resolvedEntries = lockedEntries.map(([location, entry]) => packageMetadata(location, entry, manifest));
  const packages = resolvedEntries.filter(item => item.installed).sort(sortIdentity);
  const uninstalledPlatformOptional = resolvedEntries.filter(item => !item.installed).sort(sortIdentity);

  if (!packages.length) throw new Error('No installed third-party packages were discovered');
  for (const item of uninstalledPlatformOptional) {
    if (!item.name || !item.version || !item.integrity) {
      throw new Error(`Platform-optional lock entry is incomplete: ${item.packagePath}`);
    }
  }

  const inventory = {
    schemaVersion: 1,
    supportedInventoryPlatform: `${process.platform}-${process.arch}`,
    lockfileVersion: lock.lockfileVersion,
    lockedPackageCount: lockedEntries.length,
    installedPackageCount: packages.length,
    uninstalledPlatformOptionalCount: uninstalledPlatformOptional.length,
    packages: packages.map(({ installed, noticeFiles, ...item }) => ({
      ...item,
      noticeFiles: noticeFiles.map(entry => entry.file)
    })),
    uninstalledPlatformOptional: uninstalledPlatformOptional.map(({ installed, ...item }) => item)
  };

  const licenseGroups = new Map();
  for (const item of packages) {
    for (const notice of item.noticeFiles) {
      const digest = createHash('sha256').update(notice.text).digest('hex');
      const group = licenseGroups.get(digest) || { digest, text: notice.text, packages: [] };
      group.packages.push(`${item.name}@${item.version} (${notice.file})`);
      licenseGroups.set(digest, group);
    }
  }

  const withoutBundledText = packages.filter(item => item.noticeFiles.length === 0);
  const lines = [
    '# Third-Party Notices',
    '',
    'This file is generated from `package-lock.json` and the installed package metadata by `scripts/generate-third-party-notices.mjs`.',
    'SQL Academy source code is governed by the repository `LICENSE`; the packages below remain governed by their own licenses.',
    '',
    `Supported inventory platform: **${process.platform}-${process.arch}**`,
    `Locked package entries: **${lockedEntries.length}**`,
    `Installed package entries covered below: **${packages.length}**`,
    `Uninstalled platform-optional lock entries recorded separately: **${uninstalledPlatformOptional.length}**`,
    `Unique bundled notice/license texts: **${licenseGroups.size}**`,
    '',
    '## Installed dependency inventory',
    ''
  ];

  for (const item of packages) {
    const source = item.repository || item.homepage;
    lines.push(`- \`${item.name}@${item.version}\` — ${item.license} — ${item.kind}${source ? ` — ${source}` : ''}`);
  }

  lines.push('', '## Uninstalled platform-optional lock entries', '');
  if (uninstalledPlatformOptional.length) {
    lines.push('These binaries are pinned by npm for other operating-system or CPU targets but are not installed in the supported Linux x64 CI/deployment tree. Their exact lock identity is retained in `docs/third-party-dependencies.json`; activating another platform requires regenerating and reviewing notices on that platform.', '');
    for (const item of uninstalledPlatformOptional) {
      const constraints = [...item.os.map(value => `os:${value}`), ...item.cpu.map(value => `cpu:${value}`)].join(', ');
      lines.push(`- \`${item.name}@${item.version}\`${constraints ? ` — ${constraints}` : ''}`);
    }
  } else {
    lines.push('None.');
  }

  lines.push('', '## Installed packages without a bundled notice file', '');
  if (withoutBundledText.length) {
    lines.push('These installed packages expose license metadata in `package.json` but do not bundle a matching LICENSE/COPYING/NOTICE file. They remain listed explicitly rather than being silently omitted.', '');
    for (const item of withoutBundledText) lines.push(`- \`${item.name}@${item.version}\` — ${item.license}`);
  } else {
    lines.push('None.');
  }

  lines.push('', '## Bundled license and notice texts', '');
  for (const group of [...licenseGroups.values()].sort((left, right) => left.digest.localeCompare(right.digest))) {
    const packageList = [...new Set(group.packages)].sort((left, right) => left.localeCompare(right));
    lines.push(`### SHA-256 \`${group.digest}\``, '', `Applies to: ${packageList.map(item => `\`${item}\``).join(', ')}`, '', '```text', group.text, '```', '');
  }

  return {
    inventory: `${JSON.stringify(inventory, null, 2)}\n`,
    notices: `${lines.join('\n').trim()}\n`
  };
}

function verify(path, expected) {
  if (!existsSync(path)) throw new Error(`${path.replace(`${root}/`, '')} is missing`);
  const actual = readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
  if (actual !== expected) throw new Error(`${path.replace(`${root}/`, '')} is stale; run npm run notices:generate`);
}

const outputs = buildOutputs();
if (checkOnly) {
  verify(inventoryPath, outputs.inventory);
  verify(noticesPath, outputs.notices);
  console.log('Third-party dependency inventory and notices match the installed lockfile tree.');
} else {
  writeFileSync(inventoryPath, outputs.inventory);
  writeFileSync(noticesPath, outputs.notices);
  const inventory = JSON.parse(outputs.inventory);
  console.log(`Generated notices for ${inventory.installedPackageCount} installed entries and recorded ${inventory.uninstalledPlatformOptionalCount} platform-optional entries.`);
}
