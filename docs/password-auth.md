# Password authentication and recovery

SQL Academy uses a first-party authentication system on Cloudflare Workers and D1. It intentionally does not request an email address, phone number, SMS verification or an external OAuth identity.

## Access boundary

The React course application is wrapped by `AuthGate`. Until a session is successfully validated, only three public actions are available:

- register;
- log in;
- reset a forgotten password with a recovery code.

The Worker keeps only `/api/health` and those three auth endpoints public. Every other API endpoint requires an unexpired bearer session. For legacy core endpoints the Worker replaces any client-supplied profile identifier with the authenticated user ID.

## Username

A username:

- is 3–32 characters long;
- is normalized to lowercase;
- may contain `a-z`, `0-9`, `.`, `_` and `-`;
- must begin and end with a letter or digit;
- is unique with case-insensitive comparison;
- cannot use a small reserved set such as `admin`, `root` or `system`.

The application does not expose whether a username exists during password reset. Login failures use the same generic error for an unknown username and a wrong password.

## Password storage

Accepted passwords are 15–128 Unicode characters and at most 512 UTF-8 bytes. No arbitrary uppercase/lowercase/digit composition rule is imposed.

For every account the Worker generates a random 128-bit salt and derives a 256-bit value using:

- PBKDF2;
- HMAC-SHA-256;
- 600,000 iterations.

D1 stores only the salt, derived password hash and iteration count. The original password is never stored or logged by the application.

After five consecutive invalid password attempts the account is locked for 15 minutes. A successful login or password reset clears the failure counter.

## Sessions

Each successful registration or login creates:

- a random 256-bit bearer token returned to the browser;
- an independent session ID;
- a device label;
- created, last-seen and expiry timestamps.

D1 stores only a domain-separated SHA-256 verifier of the bearer token. Sessions expire after 30 days and may be revoked independently from profile settings.

Password reset and authenticated password change delete every active session. A browser holding a revoked token is returned to the login screen on its next protected API request.

## Recovery codes

Registration generates exactly eight codes. Each code is based on 120 random bits and encoded with a human-friendly alphabet that omits ambiguous characters.

Example format:

```text
SQLR-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX
```

The clear codes are returned once. The registration UI keeps them only in `sessionStorage` while the mandatory save screen is open, so a page refresh does not immediately destroy the only copy. The course remains locked until the learner confirms that all eight codes were saved. Confirmation deletes the temporary clear-code bundle.

D1 stores only a domain-separated SHA-256 verifier for each code. A recovery code:

- is single-use;
- is tied to the current code generation;
- may reset a forgotten password;
- is also required, together with the current password, for an authenticated password change;
- is required together with the current password to delete the cloud account.

Generating a new set:

- requires the current password;
- is permitted at most once per 24 hours;
- invalidates all codes from previous generations;
- returns exactly eight new codes once.

The server cannot display or reconstruct previously issued clear recovery codes.

## Progress and profile

The authenticated user ID is the D1 key for cloud progress. Progress keeps optimistic revision checks and deterministic merge rules, so two devices cannot silently overwrite each other.

Profile data is deliberately limited to:

- optional display name;
- preferred study-session duration;
- UI locale;
- theme.

Deleting the account removes users, profile, sessions, recovery-code verifiers, cloud progress and account settings. The browser-local course progress is intentionally retained.

## Known limitations

- This is password authentication without a second factor.
- A compromised origin or successful XSS could read the browser session token. The project therefore avoids third-party runtime scripts and untrusted HTML rendering.
- Losing all eight recovery codes while also forgetting the password makes recovery impossible by design.
- Recovery-code confirmation is a client acknowledgement; the server cannot verify that the user actually stored the codes safely.
- PBKDF2 is used because it is available in the Cloudflare Web Crypto runtime. The stored iteration count allows future password hashes to be upgraded during login or password change.

## Automated verification

Pull Request CI applies every D1 migration and runs real local Worker authentication through Chromium. It verifies:

- the platform is unavailable without login;
- registration returns exactly eight codes;
- save confirmation is mandatory;
- progress transfers to a clean second browser after login;
- two independent sessions are visible and revocable;
- a recovery code resets the password once;
- old passwords and old sessions stop working;
- immediate recovery-code regeneration is rate-limited;
- desktop and Pixel-sized mobile layouts have no horizontal overflow;
- existing Academy and Adaptive Learning Path scenarios remain green under mandatory authentication.
