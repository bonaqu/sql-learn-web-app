# Buyer-owned Cloudflare deployment

This guide separates application staging from production and from the external email/SMS provider acceptance environment.

## Environment ownership

The buyer should own:

- the Cloudflare account and billing profile;
- GitHub Environments named `staging` and `production`;
- deployment tokens scoped to the required Worker, D1, KV and Workers AI resources;
- public domains, DNS and `ALLOWED_ORIGINS` decisions;
- Worker secrets and their rotation schedule;
- the support destination and product identity in `config/product-identity.json`;
- two named operational owners with independent account access.

Do not transfer a personal developer API token as the permanent deployment credential. Create buyer-owned credentials and revoke temporary migration access after acceptance.

## Isolated app staging resources

`config/staging-environment.json` is the machine-readable staging contract. The reviewed resource names are:

- Worker: `sql-learn-web-app-staging`
- D1: `sql-academy-staging`
- KV: `sql-academy-settings-staging`

`wrangler.staging.example.jsonc` is a non-deployable template with placeholder IDs and all optional commercial features off. The deployment workflow resolves or creates separate staging D1/KV resources, then renders `wrangler.staging.deploy.jsonc` at runtime.

Never point the staging config at production D1/KV identifiers. The permanent validation gate rejects shared production names and IDs.

## GitHub Environment named `staging`

Create a protected GitHub Environment named exactly `staging`. Configure required reviewers according to the buyer's change-control policy.

### Required environment secrets

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

The token must be buyer-owned and least-privileged. The generated Wrangler config never contains these values.

### Required environment variables

- `STAGING_ALLOWED_ORIGINS`: comma-separated public HTTPS origins.
- `STAGING_EXPECTED_ORIGIN`: one origin from the allowlist used by acceptance smoke tests.

There are deliberately no fallback origins. A missing or local/private origin fails before deployment.

### Optional feature variables

All default to fail-closed values:

- `STAGING_FEATURE_EMAIL_VERIFICATION=off`
- `STAGING_FEATURE_SMS_VERIFICATION=off`
- `STAGING_FEATURE_TURNSTILE=off`
- `STAGING_FEATURE_ADMIN_CONSOLE=off`
- `STAGING_FEATURE_ADMIN_ALERTS=off`
- `STAGING_CONTACT_REGISTRATION_POLICY=optional`
- `STAGING_ADMIN_ALERT_COOLDOWN_MINUTES=60`
- reviewed retention values from `config/staging-environment.json`

When Turnstile is enabled, `STAGING_TURNSTILE_EXPECTED_HOSTNAMES` must contain at least one valid hostname. When the admin console is enabled, `STAGING_ADMIN_ALLOWED_USER_IDS` must contain at least one valid operator user ID. `required-for-new-registration` is accepted only when Turnstile and at least one contact channel are enabled.

### Worker-secret readiness

The staging renderer adds Wrangler `secrets.required` declarations only for features that are enabled. `wrangler deploy` therefore fails before release when an enabled feature is missing any required Worker secret; secret values are never written into generated config or workflow artifacts.

| Enabled capability | Required staging Worker secrets |
| --- | --- |
| Email verification | `CONTACT_VERIFICATION_SIGNING_SECRET`, `EMAIL_VERIFICATION_WEBHOOK_URL`, `EMAIL_VERIFICATION_WEBHOOK_SECRET`, `EMAIL_VERIFICATION_EVENT_SECRET` |
| SMS verification | `CONTACT_VERIFICATION_SIGNING_SECRET`, `SMS_VERIFICATION_WEBHOOK_URL`, `SMS_VERIFICATION_WEBHOOK_SECRET`, `SMS_VERIFICATION_EVENT_SECRET` |
| Turnstile | `TURNSTILE_SECRET_KEY` |
| Admin alerts | `ADMIN_ALERT_WEBHOOK_URL`, `ADMIN_ALERT_WEBHOOK_SECRET` |

Use a two-pass bootstrap for a new buyer account:

1. deploy staging once with every optional feature off, creating the Worker and isolated D1/KV resources;
2. set independent staging Worker secrets;
3. enable only the intended staging feature flags and expected-capability variables;
4. rerun staging acceptance and retain the accepted evidence artifact.

For example:

```bash
npx wrangler secret put CONTACT_VERIFICATION_SIGNING_SECRET --name sql-learn-web-app-staging
npx wrangler secret put EMAIL_VERIFICATION_WEBHOOK_URL --name sql-learn-web-app-staging
npx wrangler secret put EMAIL_VERIFICATION_WEBHOOK_SECRET --name sql-learn-web-app-staging
npx wrangler secret put EMAIL_VERIFICATION_EVENT_SECRET --name sql-learn-web-app-staging
```

Use independent staging credentials and endpoints. Do not reuse production provider, Turnstile, admin-alert or signing secrets.

Real provider credentials, sender/domain approval and delivered-event evidence remain the external boundary tracked in issue #133 and the separate `contact-provider-staging` environment. App staging does not manufacture provider deliverability evidence.

## Running staging acceptance

Run the `Deploy Cloudflare Staging` workflow manually.

The workflow:

1. verifies buyer credentials and public origins;
2. installs the exact lockfile with `npm ci`;
3. runs the complete repository validation and production build;
4. resolves or creates isolated staging D1/KV resources;
5. renders a secret-free staging Wrangler config with required-secret names only for enabled features;
6. performs a Worker dry run;
7. applies D1 migrations to `sql-academy-staging` only;
8. deploys `sql-learn-web-app-staging`;
9. runs commercial, auth, curriculum, checkpoint, capstone, assessment, analytics, dialect, mastery and onboarding smoke lifecycles against the deployed staging URL;
10. uploads a redacted `cloudflare-app-staging-acceptance-v1` artifact for 30 days.

The acceptance artifact contains resource names, commit SHA, run ID, staging URL and completed check names. It must not contain tokens, recovery codes, passwords, provider secrets or raw learner evidence.

## Production promotion

Promotion is a deliberate buyer action, not an automatic continuation of staging.

Before production deployment:

- accept the exact commit in app staging;
- review the staging evidence artifact;
- complete provider acceptance if email/SMS features will be enabled;
- create and verify a D1 backup;
- confirm rollback ownership and the previous known-good commit;
- verify production GitHub Environment approvals, variables and Worker secrets;
- confirm the product identity, support URL and allowed origins;
- review any migration or retention-policy change.

Deploy production with the existing `Deploy Cloudflare Free Stack` workflow. Production uses its own Worker, D1 and KV resources and must not consume staging IDs.

## Rollback

Application rollback:

1. select the previous known-good commit;
2. rerun the staging workflow for that commit if compatibility is uncertain;
3. redeploy production from the accepted commit;
4. run the production health and smoke checks;
5. record the incident and evidence links.

Database rollback is not equivalent to code rollback. Before migrations, use the documented D1 backup tooling. Rehearse restores only in non-production. Do not overwrite production D1 during an incident without an approved recovery plan and verified backup.

## Transfer acceptance

Complete `docs/transfer-acceptance-checklist.md` with links to:

- the accepted staging workflow run and artifact;
- production deployment and health runs;
- current backup verification and restore rehearsal;
- provider acceptance evidence or the explicit #133 external boundary;
- operational-owner confirmations;
- the reviewed identity and support destination.

The repository is technically transferable only when the buyer can deploy, observe, back up, restore-rehearse and roll back without the original developer's personal accounts.
