# D1 backup and restore rehearsal

A successful deployment is not evidence that learner data can be recovered. Commercial acceptance requires a recorded export, checksum verification and restore into a separate non-production database.

## Prerequisites

- buyer-owned Cloudflare account and API token;
- Wrangler authentication with access to the intended D1 databases;
- source database name confirmed independently;
- a separate empty database whose name contains `rehearsal`, `restore`, `staging` or `test`;
- sufficient local encrypted storage for the SQL export and manifest.

Never commit backup files. The repository ignores `backups/` and local SQL artifacts.

## Export

```bash
D1_DATABASE_NAME=sql-academy \
D1_CONFIG=wrangler.deploy.jsonc \
npm run backup:d1
```

The command uses `wrangler d1 export --remote`, then writes:

- the SQL export;
- a `*.manifest.json` file containing byte count, SHA-256 checksum, database/config names, creation time and source commit.

It refuses to overwrite an existing path and requires core schema markers.

A custom output can be supplied with `D1_BACKUP_OUTPUT`.

## Verify independently

```bash
npm run backup:d1:verify -- backups/d1/sql-academy-<timestamp>.sql
```

Verification fails when:

- the manifest is missing;
- byte count or SHA-256 differs;
- a required table declaration is missing;
- the manifest format is unsupported.

Copy the SQL file and manifest together. Record the checksum in the change or acceptance ticket through a channel separate from the backup storage.

## Restore rehearsal

Restoration is intentionally guarded and refuses the source database name.

```bash
D1_BACKUP_FILE=backups/d1/sql-academy-<timestamp>.sql \
D1_DATABASE_NAME=sql-academy \
D1_RESTORE_TARGET=sql-academy-restore-rehearsal \
D1_CONFIG=wrangler.deploy.jsonc \
ALLOW_D1_RESTORE=RESTORE_TO_NON_PRODUCTION \
npm run restore:d1:rehearsal
```

The script:

1. verifies checksum and schema markers;
2. rejects a production/source target;
3. imports the SQL through `wrangler d1 execute --file`;
4. confirms the four required tables exist.

Use an empty rehearsal database. A SQL export may contain table creation and inserts that conflict with existing data.

## Acceptance after import

Table existence alone is insufficient. Point a staging Worker at the restored D1 and run:

- `/api/health` and `/api/capabilities` probe;
- login with a dedicated acceptance account;
- progress, curriculum, assessment, onboarding and deletion lifecycle smokes;
- a sample of expected aggregate row counts;
- operator verification that no production bindings were modified.

Destroy the rehearsal database or retain it according to the buyer's approved retention policy.

## Time Travel and incident recovery

Cloudflare-native restore options and retention windows can change. The buyer must document the account's current D1 Time Travel capability and rehearse it separately from portable SQL export/import. The portable export remains useful for transaction handoff and provider-independent evidence; it is not a substitute for the platform's fastest incident rollback mechanism.
