import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export type ProductIdentity = {
  contract: 'product-identity-v1';
  productName: string;
  shortName: string;
  trackName: string;
  description: string;
  locale: string;
  licenseName: string;
  licenseLabel: string;
  privacyLabel: string;
  privacySummary: string;
  homepageUrl: string;
  repositoryUrl: string;
  supportUrl: string;
};

const URL_FIELDS = ['homepageUrl', 'repositoryUrl', 'supportUrl'] as const;
const IPV4_PATTERN = /^\d{1,3}(?:\.\d{1,3}){3}$/;
const CYRILLIC_PATTERN = /[А-Яа-яЁё]/;

function nonEmptyString(value: unknown, field: string, minimum: number, maximum: number) {
  if (typeof value !== 'string') throw new Error(`${field} must be a string`);
  const normalized = value.trim();
  if (normalized.length < minimum || normalized.length > maximum) {
    throw new Error(`${field} must contain ${minimum}-${maximum} characters`);
  }
  if (/\r|\n|\0/.test(normalized)) throw new Error(`${field} contains a forbidden control character`);
  return normalized;
}

function privateOrReservedIpv4(hostname: string) {
  if (!IPV4_PATTERN.test(hostname)) return false;
  const octets = hostname.split('.').map(Number);
  if (octets.some(octet => !Number.isInteger(octet) || octet < 0 || octet > 255)) return true;
  const [first, second] = octets;
  return first === 0
    || first === 10
    || first === 127
    || (first === 100 && second >= 64 && second <= 127)
    || (first === 169 && second === 254)
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && second === 168)
    || (first === 198 && (second === 18 || second === 19))
    || first >= 224;
}

function publicHttpsUrl(value: unknown, field: string) {
  const raw = nonEmptyString(value, field, 12, 2_000);
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`${field} must be an absolute URL`);
  }
  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (parsed.protocol !== 'https:'
    || parsed.username
    || parsed.password
    || parsed.hash
    || !hostname
    || hostname === 'localhost'
    || hostname.endsWith('.localhost')
    || hostname.endsWith('.local')
    || hostname.endsWith('.internal')
    || hostname.includes(':')
    || privateOrReservedIpv4(hostname)) {
    throw new Error(`${field} must use a public HTTPS destination without credentials or a fragment`);
  }
  return parsed.toString();
}

export function validateProductIdentity(value: unknown): ProductIdentity {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Product identity must be a JSON object');
  }
  const raw = value as Record<string, unknown>;
  const allowedKeys = new Set([
    'contract',
    'productName',
    'shortName',
    'trackName',
    'description',
    'locale',
    'licenseName',
    'licenseLabel',
    'privacyLabel',
    'privacySummary',
    ...URL_FIELDS
  ]);
  for (const key of Object.keys(raw)) {
    if (!allowedKeys.has(key)) throw new Error(`Unknown product identity field: ${key}`);
  }
  if (raw.contract !== 'product-identity-v1') throw new Error('Unsupported product identity contract');

  const identity: ProductIdentity = {
    contract: 'product-identity-v1',
    productName: nonEmptyString(raw.productName, 'productName', 2, 60),
    shortName: nonEmptyString(raw.shortName, 'shortName', 2, 24),
    trackName: nonEmptyString(raw.trackName, 'trackName', 2, 80),
    description: nonEmptyString(raw.description, 'description', 40, 220),
    locale: nonEmptyString(raw.locale, 'locale', 2, 20),
    licenseName: nonEmptyString(raw.licenseName, 'licenseName', 5, 120),
    licenseLabel: nonEmptyString(raw.licenseLabel, 'licenseLabel', 3, 40),
    privacyLabel: nonEmptyString(raw.privacyLabel, 'privacyLabel', 3, 40),
    privacySummary: nonEmptyString(raw.privacySummary, 'privacySummary', 40, 240),
    homepageUrl: publicHttpsUrl(raw.homepageUrl, 'homepageUrl'),
    repositoryUrl: publicHttpsUrl(raw.repositoryUrl, 'repositoryUrl'),
    supportUrl: publicHttpsUrl(raw.supportUrl, 'supportUrl')
  };

  if (!/^[a-z]{2,3}(?:-[A-Z]{2})?$/.test(identity.locale)) {
    throw new Error('locale must be a compact BCP 47 language tag');
  }
  if (/open[ -]?source|открыт(?:ый|ого)\s+исходн/i.test(`${identity.licenseName} ${identity.licenseLabel}`)) {
    throw new Error('Commercial product identity must not claim an open-source license');
  }
  if (identity.locale === 'ru') {
    for (const [field, text] of [
      ['trackName', identity.trackName],
      ['description', identity.description],
      ['licenseLabel', identity.licenseLabel],
      ['privacyLabel', identity.privacyLabel],
      ['privacySummary', identity.privacySummary]
    ] as const) {
      if (!CYRILLIC_PATTERN.test(text)) throw new Error(`${field} must be localized for the Russian identity`);
    }
    if (/\b(?:Commercial Source|privacy-first|Support Engineering Track)\b/i.test(
      `${identity.trackName} ${identity.licenseLabel} ${identity.privacyLabel}`
    )) {
      throw new Error('Russian public labels must not fall back to English service copy');
    }
  }
  return identity;
}

export function loadProductIdentity(root = process.cwd()) {
  const path = resolve(root, 'config/product-identity.json');
  return validateProductIdentity(JSON.parse(readFileSync(path, 'utf8')));
}

export function productFullTitle(identity: ProductIdentity) {
  return `${identity.productName} — ${identity.trackName}`;
}

export function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
