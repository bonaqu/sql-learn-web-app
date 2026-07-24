import { readFileSync, writeFileSync } from 'node:fs';

const file = new URL('../worker/auth.ts', import.meta.url);
const source = readFileSync(file, 'utf8');

const before = `async function passwordHash(password: string, saltBase64: string, iterations = PASSWORD_ITERATIONS) {
  const passwordBytes = new TextEncoder().encode(password);
  const key = await crypto.subtle.importKey('raw', ownedBuffer(passwordBytes), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({
    name: 'PBKDF2',
    hash: 'SHA-256',
    salt: ownedBuffer(base64UrlToBytes(saltBase64)),
    iterations
  }, key, 256);
  return bytesToBase64Url(new Uint8Array(bits));
}`;

const after = `const PASSWORD_PBKDF2_CHUNK = 100_000;
const PASSWORD_HASH_SCHEME = 'pbkdf2-sha256-chain-v1';

function concatenateBytes(...parts: Uint8Array[]) {
  const output = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }
  return output;
}

async function passwordHash(password: string, saltBase64: string, iterations = PASSWORD_ITERATIONS) {
  if (!Number.isSafeInteger(iterations) || iterations < 1 || iterations > 1_000_000) {
    throw new RangeError('Invalid password KDF iteration count');
  }

  const encoder = new TextEncoder();
  const baseSalt = base64UrlToBytes(saltBase64);
  let material = encoder.encode(password);
  let remaining = iterations;
  let stage = 0;

  while (remaining > 0) {
    const stageIterations = Math.min(PASSWORD_PBKDF2_CHUNK, remaining);
    const stageDomain = encoder.encode(\`sql-academy/password-chain/v1:\${iterations}:\${stage}:\`);
    const stageSalt = await sha256(concatenateBytes(stageDomain, baseSalt));
    const key = await crypto.subtle.importKey('raw', ownedBuffer(material), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt: ownedBuffer(stageSalt),
      iterations: stageIterations
    }, key, 256);
    material = new Uint8Array(bits);
    remaining -= stageIterations;
    stage += 1;
  }

  return \`\${PASSWORD_HASH_SCHEME}:\${iterations}:\${bytesToBase64Url(material)}\`;
}`;

if (source.includes("const PASSWORD_HASH_SCHEME = 'pbkdf2-sha256-chain-v1';")) {
  console.log('Cloudflare PBKDF2 patch is already applied.');
  process.exit(0);
}

const occurrences = source.split(before).length - 1;
if (occurrences !== 1) {
  throw new Error(`Expected exactly one legacy passwordHash implementation, found ${occurrences}.`);
}

writeFileSync(file, source.replace(before, after));
console.log('Applied six-stage Cloudflare-compatible PBKDF2 chain.');
