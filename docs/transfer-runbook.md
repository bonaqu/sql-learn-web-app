# Buyer transfer runbook

## 1. Legal and repository transfer

1. Sign the asset assignment or commercial license; the repository `LICENSE` does not transfer ownership by itself.
2. Create a buyer-owned private repository and preserve commit history.
3. Run a dependency license/SBOM scan and store the report with the transaction documents.
4. Replace repository contacts, CODEOWNERS, security contact and branding.

## 2. Cloudflare clean-room deployment

1. Create a buyer-owned Cloudflare account and API token with the minimum Worker/D1/KV permissions.
2. Add `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` to buyer GitHub Actions secrets.
3. Replace Worker, D1 and KV names if required.
4. Add the buyer domain to the Worker and update the server CORS allowlist.
5. Deploy to staging first, apply migrations, then run every production smoke.
6. Export the empty/new D1 schema and perform one documented restore rehearsal.

## 3. Optional verification providers

### Email

- implement `EmailVerificationProvider` in `worker/integrations/verification.ts`;
- store provider credentials with `wrangler secret put`;
- verify the sending domain and configure SPF/DKIM/DMARC;
- add code hashing, TTL, attempt limits, replay prevention and generic responses;
- enable the server flag only after integration and abuse E2E pass.

### SMS

- implement `SmsVerificationProvider`;
- review destination-country restrictions, consent and retention;
- enforce per-account, per-IP and global budgets;
- never expose whether an account or phone exists;
- enable only after delivery and cost monitoring exist.

## 4. Production acceptance

- clean account registration and recovery;
- desktop and mobile learner route from first screen to first completed task;
- cross-device sync and deletion lifecycle;
- backup/restore evidence;
- alert delivery and operator runbook;
- legal pages reachable from auth and account settings;
- all CI and production smokes green on the buyer-owned deployment.
