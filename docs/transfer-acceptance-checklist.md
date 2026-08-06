# Buyer transfer acceptance checklist

This checklist is an acceptance record, not a promise that repository code alone completes buyer onboarding. Each checked item should include an owner, date and evidence link in the buyer's change-management system.

## 1. Ownership and access

- [ ] Buyer Cloudflare account owner confirmed.
- [ ] Buyer GitHub organization/repository owner confirmed.
- [ ] Two independent operational owners can access GitHub Environments, Cloudflare Workers, D1 and KV.
- [ ] Billing, security notifications and recovery contacts belong to the buyer.
- [ ] Temporary developer/admin access has an expiry and revocation owner.
- [ ] Least-privileged deployment tokens replace personal developer tokens.

Required evidence: account-owner screenshots or audit records, named owners, token-scope review and temporary-access expiry.

## 2. Product identity and support

- [ ] `config/product-identity.json` contains the accepted product/track names and locale.
- [ ] `homepageUrl`, `repositoryUrl` and `supportUrl` belong to the buyer.
- [ ] `licenseName` matches the first line of `LICENSE`.
- [ ] Public copy does not claim open-source licensing or zero personal data.
- [ ] Browser title, canonical metadata, PWA manifest, sidebar and footer were reviewed from a production build.
- [ ] Internal `sql-academy-*` storage/API identifiers remain unchanged unless a separate migration was accepted.

Required evidence: Product Identity Contract run, built metadata review and support-intake ownership.

## 3. Staging environment

- [ ] GitHub Environment `staging` exists with required reviewers.
- [ ] `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` are buyer-owned staging environment secrets.
- [ ] `STAGING_ALLOWED_ORIGINS` contains only accepted public HTTPS origins.
- [ ] `STAGING_EXPECTED_ORIGIN` is included in that allowlist.
- [ ] Worker `sql-learn-web-app-staging` is separate from production.
- [ ] D1 `sql-academy-staging` is separate from production.
- [ ] KV `sql-academy-settings-staging` is separate from production.
- [ ] Optional staging features are off unless their independent staging secrets and acceptance evidence exist.
- [ ] `Deploy Cloudflare Staging` completed for the exact candidate commit.
- [ ] The redacted `cloudflare-app-staging-acceptance-v1` artifact was reviewed.

Required evidence: workflow URL, artifact ID, commit SHA, deployed staging URL and resource inventory.

## 4. Production deployment

- [ ] GitHub Environment/approval policy for production is buyer-owned.
- [ ] Production `ALLOWED_ORIGINS` and expected health origin were reviewed.
- [ ] Production Worker, D1 and KV identifiers are recorded and do not equal staging resources.
- [ ] Production deployment token scope was reviewed.
- [ ] `Deploy Cloudflare Free Stack` succeeded for the accepted commit.
- [ ] Production health probe succeeded against the buyer-configured URL.
- [ ] Full production smoke evidence was retained according to buyer policy.
- [ ] Previous known-good commit and rollback operator are recorded.

Required evidence: deployment run, production health run, smoke artifact/status and rollback commit.

## 5. Authentication and external providers

- [ ] Username/password and recovery-code lifecycle passed staging acceptance.
- [ ] Contact registration policy is explicitly `optional` or accepted as `required-for-new-registration`.
- [ ] Turnstile is off or has buyer-owned hostname/secret acceptance.
- [ ] Email verification is off or has buyer-owned provider credentials, sender/domain approval and signed delivered-event evidence.
- [ ] SMS verification is off or has buyer-owned provider credentials, sender approval and signed delivered-event evidence.
- [ ] Provider callback/event secrets are independent between staging and production.
- [ ] External provider boundary #133 is closed or explicitly accepted as a launch blocker with an owner/date.

Required evidence: provider staging acceptance artifact, provider console/domain approval, or signed blocker acceptance.

## 6. Privacy, retention and account operations

- [ ] Technical retention values were reviewed and do not exceed repository maxima.
- [ ] Protected retention dry-run was reviewed before any manual execution.
- [ ] Learning evidence, verified contacts, recovery codes and account records are excluded from technical cleanup.
- [ ] Account recovery runbook was exercised with a non-production test account.
- [ ] Session revocation after recovery was verified.
- [ ] Account deletion/export expectations and support escalation ownership are documented.
- [ ] Logs and uploaded diagnostics contain no passwords, tokens, recovery codes, contact destinations or learner SQL.

Required evidence: retention endpoint output, recovery exercise and privacy-log gate.

## 7. Backup, restore and rollback

- [ ] Current D1 backup completed with checksum metadata.
- [ ] Backup verification passed.
- [ ] Non-production restore rehearsal passed.
- [ ] Production overwrite protection remains enabled in restore tooling.
- [ ] Backup retention/location/access policy belongs to the buyer.
- [ ] Code rollback and database recovery are documented as separate decisions.
- [ ] Incident commander and recovery operator are named.

Required evidence: backup manifest, verification output, restore-rehearsal artifact and owner record.

## 8. Monitoring and alerts

- [ ] Production health workflow is enabled with a buyer-owned `PRODUCTION_HEALTH_URL`.
- [ ] Production health origin matches the production allowlist.
- [ ] Buyer-owned admin alert routing is off or has an accepted public HTTPS receiver and independent HMAC secret.
- [ ] Alert receiver validates timestamp/signature and deduplicates event IDs.
- [ ] Test alert and recovery event were observed when alert routing is enabled.
- [ ] Escalation destinations, severity policy and on-call owner are documented outside the repository.

Required evidence: health run, alert test, receiver log and escalation-policy link.

## 9. Runbooks and support readiness

- [ ] Incident response runbook reviewed by both operational owners.
- [ ] Support triage runbook linked from the buyer's intake process.
- [ ] Account recovery runbook reviewed by support/security owners.
- [ ] Buyer deployment guide reviewed by the deployment owner.
- [ ] Support tickets cannot request or store credentials, recovery codes or raw D1 exports.
- [ ] Severity definitions and response ownership match buyer policy.

Required evidence: reviewer approvals and buyer-system links.

## 10. Final sign-off

- [ ] Technical acceptance owner approved the exact commit SHA.
- [ ] Security/privacy owner approved configuration and evidence boundaries.
- [ ] Operations owner accepted deployment, monitoring, backup and rollback responsibility.
- [ ] Product/support owner accepted identity, support routing and user-facing policy wording.
- [ ] Open external blockers include owner, target date and launch impact.
- [ ] Original developer is not a single point of failure for deployment or recovery.

Final acceptance record:

| Field | Value |
| --- | --- |
| Accepted commit SHA | |
| Staging workflow/artifact | |
| Production deployment/health | |
| Backup/restore evidence | |
| Provider evidence or blocker | |
| Technical owner/date | |
| Security/privacy owner/date | |
| Operations owner/date | |
| Product/support owner/date | |
