# Dependency governance

SQL Academy uses npm's committed lockfile as the only supported dependency resolution for development, CI and buyer handoff.

## Required repository artifacts

- `package-lock.json` pins the complete npm dependency graph and integrity hashes.
- `docs/third-party-dependencies.json` is the machine-readable inventory of every installed lockfile entry.
- `THIRD_PARTY_NOTICES.md` lists every locked package, its declared license and all bundled LICENSE/COPYING/NOTICE texts, deduplicated by SHA-256.
- `scripts/generate-third-party-notices.mjs` generates and verifies both notice artifacts from the installed locked tree.

## Change contract

1. Change dependencies only through `package.json` and npm.
2. Regenerate `package-lock.json` with the repository's supported Node/npm toolchain.
3. Install with `npm ci`; do not use a floating install in CI or release assembly.
4. Run the notice generator and commit its outputs in the same pull request.
5. Review new license expressions and packages without a bundled notice file before merge.
6. Do not treat the repository Commercial Source License as covering third-party packages.

A dependency change is incomplete when the lockfile, inventory or notices are stale. Generated notices are engineering evidence, not a substitute for buyer legal review.
