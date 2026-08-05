# Dependency governance

SQL Academy uses npm's committed lockfile as the only supported dependency resolution for development, CI and buyer handoff.

## Supported toolchain boundary

The production and CI dependency inventory is generated on Node.js 24, npm 11, Linux x64—the buyer-owned Cloudflare deployment toolchain. npm also pins optional native binaries for other operating systems and CPU architectures. Those entries remain in `package-lock.json` and are listed explicitly in the machine-readable inventory, but their license files cannot be claimed as installed evidence from the Linux tree. A buyer activating another build platform must regenerate and review notices on that platform.

## Required repository artifacts

- `package-lock.json` pins the complete npm dependency graph and integrity hashes.
- `docs/third-party-dependencies.json` records every installed package plus every uninstalled platform-optional lock entry.
- `THIRD_PARTY_NOTICES.md` lists every installed package, its declared license and all bundled LICENSE/COPYING/NOTICE texts, deduplicated by SHA-256; platform-optional omissions are called out rather than hidden.
- `scripts/generate-third-party-notices.mjs` generates and verifies both notice artifacts from the installed locked tree.

## Change contract

1. Change dependencies only through `package.json` and npm.
2. Regenerate `package-lock.json` with the supported Node/npm toolchain.
3. Install with `npm ci`; do not use a floating install in CI or release assembly.
4. Run the notice generator and commit its outputs in the same pull request.
5. Review new license expressions, packages without a bundled notice file and newly introduced platform-optional entries before merge.
6. Do not treat the repository Commercial Source License as covering third-party packages.

A dependency change is incomplete when the lockfile, inventory or notices are stale. Generated notices are engineering evidence, not a substitute for buyer legal review.
