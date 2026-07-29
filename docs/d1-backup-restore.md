# D1 backup and restore rehearsal

A successful deployment is not evidence that learner data can be recovered. Commercial acceptance requires a recorded export, checksum verification and restore into a separate non-production database.

## Export

```bash
D1_DATABASE_NAME=sql-academy \
D1_CONFIG=wrangler.deploy.jsonc \
npm run backup:d1
```

The command uses a remote D1 export, verifies core schema markers and writes:

- the SQL export;
- a `*.manifest.json` with byte count, SHA-256 checksum, database/config names, creation time and source commit.

It refuses to overwrite an existing path. Backup files are ignored by Git and must be stored in buyer-approved encrypted storage.

## Verify independently

```bash
npm run backup:d1:verify -- backups/d1/sql-academy-<timestamp>.sql
```

Verification fails when the manifest is missing, checksum/byte count differs, the manifest format is unsupported or a required table declaration is absent.

## Restore rehearsal

Use a separate empty database whose name visibly contains `rehearsal`, `restore`, `staging` or `test`.

```bash
D1_BACKUP_FILE=backups/d1/sql-academy-<timestamp>.sql \
D1_DATABASE_NAME=sql-academy \
D1_RESTORE_TARGET=sql-academy-restore-rehearsal \
D1_CONFIG=wrangler.deploy.jsonc \
ALLOW_D1_RESTORE=RESTORE_TO_NON_PRODUCTION \
npm run restore:d1:rehearsal
```

The script verifies checksum/schema, refuses the source database name, imports the SQL and confirms the four required tables exist.

## Acceptance after import

Point a staging Worker at the restored D1 and run:

- `/api/health` and `/api/capabilities`;
- login with a dedicated acceptance account;
- progress, curriculum, assessment, onboarding and deletion lifecycles;
- sample aggregate row counts;
- verification that no production binding changed.

The SQL rehearsal proves portable importability. The buyer must separately document and rehearse the account's current D1 Time Travel procedure and retention window for the fastest platform-native incident recovery.
