# Anonymous accounts and multi-device sync

SQL Academy intentionally avoids email, SMS, phone numbers, OAuth and third-party identity providers. The account system is designed for a personal learning application where privacy, portability and operation on the Cloudflare free tier matter more than social identity.

## Credential model

### Recovery code

The browser generates 20 random bytes (160 bits of entropy), appends a two-byte SHA-256 checksum and encodes the result with a human-friendly Base32 alphabet. The displayed code is grouped for copying and typo detection.

The recovery code never needs to be stored by the server. The client derives:

- an account ID using domain-separated SHA-256;
- a master token using a different domain-separated SHA-256 input.

The Worker stores only another SHA-256 verifier of the master token.

### Device tokens

A recovery code is used only to create an account or connect a new device. The Worker then issues a fresh 256-bit random device token and stores only its verifier.

Every device has:

- an independent device ID;
- a user-facing device label;
- an independent token verifier;
- created and last-seen timestamps.

A single device can be revoked without invalidating other devices or changing the recovery code.

## Progress conflict handling

Cloud progress has an integer revision. A write includes the revision that the client last read.

- Matching revision: the write succeeds and increments the revision.
- Stale revision: the API returns HTTP 409.
- The client reads the newest cloud progress, deterministically merges it with local progress and retries once.

Merge rules:

- completed task IDs are combined as a set;
- XP is recalculated from completed tasks rather than added blindly;
- attempts, mistakes and hints use the maximum observed counters;
- completion timestamps keep the earliest completion;
- last-attempt timestamps keep the latest attempt;
- activity values use the maximum for each displayed day;
- streak keeps the larger value.

This avoids the most common failure mode where the last device to save silently erases work from another device.

## Stored data

D1 stores:

- account ID;
- master verifier;
- device IDs, labels and token verifiers;
- progress JSON, revision and timestamps.

KV may store account settings and short-lived AI quota counters.

The application does not request or store a real name, employer, email, phone number, postal address or social account.

## Client storage

After onboarding, localStorage contains:

- the current device token;
- account and device identifiers;
- current sync revision;
- local course progress.

The recovery code is not persisted by the application. The learner must copy it or download the generated text file.

## Account deletion

Authenticated account deletion removes:

- cloud progress;
- all device sessions;
- the account record;
- account settings in KV.

The local course progress is intentionally retained so deleting a cloud account does not destroy the learner's offline work.

## Known limitations

- Losing the recovery code prevents connecting new devices. The server cannot recover it by design.
- A compromised browser origin or successful XSS could read the local device token. The project therefore avoids remote scripts and untrusted HTML rendering.
- There is no human identity verification. Whoever possesses the recovery code can connect a new device.
- Device names are informational and are not trusted security attributes.
- The system currently uses one master recovery code rather than multiple recovery factors.

## Automated verification

Pull Request CI applies all D1 migrations and launches:

- Vite Pages-style frontend;
- local Wrangler Worker runtime;
- local D1 and KV bindings;
- desktop Chromium;
- Pixel-sized mobile Chromium.

The account test creates an account, solves a SQL task, syncs it, opens a second isolated browser context, connects with the recovery code and verifies the same completed task plus two independent devices.
