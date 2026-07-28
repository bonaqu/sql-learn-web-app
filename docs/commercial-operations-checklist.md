# Commercial operations checklist

This checklist is intentionally stricter than the current personal Free deployment.

## Before buyer acceptance

- [ ] buyer-owned GitHub, Cloudflare and domain accounts;
- [ ] signed source-code assignment or commercial license;
- [ ] dependency license inventory and SBOM;
- [ ] staging and production separated;
- [ ] D1 export, restore and rollback rehearsal recorded;
- [ ] private security contact and disclosure SLA;
- [ ] operator incident and support runbooks;
- [ ] jurisdiction-specific Terms and Privacy Policy;
- [ ] real-user pilot evidence and support-load estimate;
- [ ] independent security review.

## Optional capabilities

Email, SMS, Turnstile and administration remain hidden until a buyer supplies providers, secrets, legal copy, abuse controls, monitoring and passing integration tests. Frontend configuration alone must never enable them.

## Current Free deployment

The existing username/password/recovery-code flow remains the supported path. No paid integration is required for the current application to work.
