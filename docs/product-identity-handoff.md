# Product identity and buyer handoff

`config/product-identity.json` is the single buyer-owned source for public product identity. Its schema contract is `product-identity-v1`.

It controls:

- browser title, description, canonical URL, Open Graph and Twitter metadata;
- PWA name, short name, language and description;
- the visible product name in navigation and footer;
- repository and support links;
- the displayed commercial-license and privacy labels.

## Identity fields

| Field | Purpose |
| --- | --- |
| `productName` | Full visible product name. |
| `shortName` | Compact PWA/sidebar name, maximum 24 characters. |
| `trackName` | Public track or edition name used in the full page/PWA title. |
| `description` | Public metadata and install description. |
| `locale` | Compact BCP 47 language tag, for example `ru` or `en-US`. |
| `licenseName` | Must exactly equal the first non-empty line of `LICENSE`. |
| `licenseLabel` | Short visible label, such as `Commercial Source`. |
| `privacyLabel` | Short visible posture label. Do not use it as a substitute for a privacy policy. |
| `privacySummary` | Accurate public metadata summary of the actual account/progress/verification data boundary. |
| `homepageUrl` | Public HTTPS canonical deployment URL. |
| `repositoryUrl` | Public HTTPS source/handoff repository URL. |
| `supportUrl` | Public HTTPS buyer support or ticket-intake URL. |

All three URLs reject credentials, fragments, localhost, private/reserved IPv4 literals and literal IPv6 destinations. Query parameters are allowed but should be avoided unless the destination requires an opaque route token.

## Rebrand procedure

1. Edit only `config/product-identity.json` for the public name, track, descriptions and URLs.
2. Keep `licenseName` synchronized with the first line of `LICENSE`. Changing the commercial terms themselves requires legal review; this configuration only names the governing license.
3. Run:

```bash
npm run identity:generate
npm run identity:check
npm run validate:product-identity
npm run build
npm run validate:product-identity -- --dist
```

4. Review `src/generated/product-identity.ts` and `public/manifest.webmanifest` in the same pull request.
5. Open the built app and verify the sidebar name, repository/support links, footer statement, browser title and install metadata.
6. Update deployment-domain controls separately when the canonical hostname changes: `ALLOWED_ORIGINS`, expected production origin, Turnstile hostnames and any provider callback allowlists are security configuration, not branding.

## Stable internal identifiers

**Внутренние ключи хранения и API-контракты не являются публичным брендом.** Do not rename keys such as `sql-academy-progress-v4`, `sql-academy-profile-id`, event names, D1 table names or API contract/version strings during a visual rebrand.

Changing those identifiers without an explicit migration can make existing progress, sessions, recovery state or cross-device evidence appear lost. A storage namespace migration must be a separate, backwards-compatible engineering change with rollback evidence.

## Commercial-source statement

The repository is source-available under the terms in `LICENSE`; it is not presented as open source. Public HTML, README and UI must not use `Open-source`, `open source` or equivalent wording unless the governing license is deliberately replaced after legal review.

`package.json` uses `SEE LICENSE IN LICENSE`. Third-party packages remain governed by their own licenses and notices in `THIRD_PARTY_NOTICES.md`.

## Support ownership

`supportUrl` should point to a buyer-controlled intake surface with an understood retention/access policy. The application renders the link as ordinary navigation; it does not transmit account, contact, SQL or learning data to that URL automatically.

When support is moved, change the identity file, regenerate artifacts and verify the built link. Do not embed support credentials, private dashboards or signed one-time URLs in the identity file.
