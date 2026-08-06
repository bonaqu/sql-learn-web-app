import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { loadProductIdentity, validateProductIdentity } from './product-identity';

const identity = loadProductIdentity(resolve(import.meta.dirname, '..'));

assert.throws(
  () => validateProductIdentity({ ...identity, unknownField: true }),
  /Unknown product identity field/
);
assert.throws(
  () => validateProductIdentity({ ...identity, licenseLabel: 'Open source' }),
  /must not claim an open-source license/
);
assert.throws(
  () => validateProductIdentity({ ...identity, supportUrl: 'http://support.example.test' }),
  /public HTTPS destination/
);
assert.throws(
  () => validateProductIdentity({ ...identity, supportUrl: 'https://127.0.0.1/support' }),
  /public HTTPS destination/
);
assert.throws(
  () => validateProductIdentity({
    ...identity,
    trackName: 'Support Engineering Track',
    licenseLabel: 'Commercial Source',
    privacyLabel: 'privacy-first'
  }),
  /localized for the Russian identity|must not fall back to English service copy/
);
assert.throws(
  () => validateProductIdentity({ ...identity, locale: 'ru_ru' }),
  /compact BCP 47/
);

assert.equal(identity.trackName, 'Трек инженера поддержки');
assert.equal(identity.licenseLabel, 'Коммерческая лицензия');
assert.equal(identity.privacyLabel, 'минимизация данных');

console.log('Product identity boundaries validated: no open-source claim, public HTTPS buyer URLs, compact locale and localized Russian service copy.');
