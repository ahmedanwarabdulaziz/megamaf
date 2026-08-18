# MegaMaf disaster-recovery backups

This backup system is intentionally external to the live Next.js request path. It
reads production data, verifies the result, and creates a portable archive without
writing to production tables.

## Backup modes

| Mode | Database | Source | R2 files |
| --- | --- | --- | --- |
| `database` | Complete | Only when the Git commit changed | None |
| `incremental` | Complete | Only when the Git commit changed | New or changed objects only |
| `full` | Complete | Complete Git bundle and source ZIP | Every current object |
| `source` | None | Complete Git bundle and source ZIP | None |

An incremental R2 run automatically becomes a full run if no verified full R2
baseline exists. Unchanged objects are identified by bucket, object key, size, and
ETag. Every downloaded object is independently verified with SHA-256.

## Local prerequisites

- Node.js 20 or newer.
- Docker Desktop running. The pinned Supabase CLI uses a PostgreSQL container.
- Git and `tar` available.
- A private local destination with enough free space.

Run `npm install` once, then use:

```powershell
npm run backup:database
npm run backup:incremental
npm run backup:full
npm run backup:source
```

By default, output is stored in the `production-backups` directory beside the
repository. Set `BACKUP_OUTPUT_DIR` to use another location.

## Admin Backup Devices page

After migration `20260818234000_backup_devices.sql` is applied, super-admins can
open **Settings > Backups** (`/settings/backups`) to manage designated Windows
backup computers.

To add a computer:

1. Enter a computer name and create a one-time pairing code. The code expires
   after 15 minutes and is stored by the server only as a SHA-256 hash.
2. Download the Windows installer from the page and run it on the new computer.
3. Enter the app URL, pairing code, local backup folder, and database settings.
   R2 settings are optional and can be configured only on computers that should
   perform incremental or full attachment backups.
4. The installer stores credentials only in the protected local agent folder,
   registers a Windows Scheduled Task, and checks for approved jobs once a
   minute.
5. Return to the page to choose the primary device and run a database,
   incremental, or full backup.

The browser never receives database, R2, or device-token secrets. Pairing codes
are one-use, device tokens can be revoked from the page, and only one job can be
queued or running per computer. Jobs wait safely while a computer is offline.
The application stores only status, checksums, archive metadata, and the local
path reported for admin visibility; backup contents remain on that computer.

The new computer needs Node.js LTS, Git for Windows, and Docker Desktop. If the
GitHub repository is private, its Windows user must sign in to GitHub before the
installer can clone the agent source.

## Required configuration

Keep all values in `.env.local`, GitHub Actions secrets, or the local backup
agent's protected credential store. Never commit them.

Database connection:

```text
BACKUP_DB_HOST
BACKUP_DB_PORT
BACKUP_DB_NAME
BACKUP_DB_USER
SUPABASE_DB_PASSWORD
```

`BACKUP_DATABASE_URL` or `SUPABASE_DB_URL` may be used instead, but component
variables are preferred because the password is encoded safely at runtime.

R2 full or incremental backups additionally require:

```text
R2_ENDPOINT
R2_ACCESS_KEY_ID
R2_SECRET_ACCESS_KEY
R2_BUCKET_NAME
R2_BUCKET_NAME_TREASURY
```

Google Drive upload requires:

```text
GOOGLE_DRIVE_CLIENT_ID
GOOGLE_DRIVE_CLIENT_SECRET
GOOGLE_DRIVE_REFRESH_TOKEN
GOOGLE_DRIVE_FOLDER_ID
GOOGLE_DRIVE_TARGET_PARENT_ID
```

The Google OAuth authorization must use offline access and should use the narrow
`drive.file` scope. The chosen folder must be created by or explicitly shared
with the MegaMaf backup integration.

For a personal Gmail account:

1. Create a Google Cloud project and enable the Google Drive API.
2. Configure an External OAuth consent screen and add the Gmail address as a
   test user.
3. Create a Desktop OAuth client.
4. Download its JSON file and save it as
   `.backup-state/google-oauth-client.json`. This directory is ignored by Git.
5. Run `npm run backup:drive:authorize` and approve the Google consent page.

The helper reads the client JSON, requests only `drive.file` access, stores all
OAuth values in `.env.local` without printing the refresh token, and creates
`MegaMaf Automated Backups`. If Google does not allow the limited token to open
an older folder directly, move the newly created folder into
`Mega Maf Backups` once. Its folder ID and authorization remain valid after the
move.

## Output and verification

Each successful run creates:

- A timestamped staging directory containing readable SQL and manifests.
- A portable `tar.gz` recovery archive.
- A `.sha256` sidecar for archive integrity.
- `.backup-state/catalog.json`, which records source and R2 recovery chains.
- `latest-result.json`, used by the Google Drive uploader.

The archive is created only after all selected components pass verification.
Production credentials and `.env.local` are never included.

## Google Drive automation

The workflows are disabled until the repository variable `BACKUP_ENABLED` is
set to `true`.

Repository variables:

```text
BACKUP_ENABLED
BACKUP_DB_HOST
BACKUP_DB_PORT
BACKUP_DB_NAME
BACKUP_DB_USER
GOOGLE_DRIVE_FOLDER_ID
```

Repository secrets:

```text
SUPABASE_DB_PASSWORD
GOOGLE_DRIVE_CLIENT_ID
GOOGLE_DRIVE_CLIENT_SECRET
GOOGLE_DRIVE_REFRESH_TOKEN
```

`.github/workflows/backup-database.yml` runs at `00:00 UTC` daily and can also
be started manually. `.github/workflows/backup-source.yml` runs after a push to
`main`. The schedule can be adjusted after choosing the preferred Cairo time.

For a physical local copy, configure Google Drive Desktop to mirror the backup
folder or make that folder available offline. The cloud workflow can run while
the PC is off; Drive Desktop synchronizes it after the PC starts.

## Retention

`npm run backup:prune:preview` shows the proposed 7 daily, 4 weekly, and 12
monthly retention decisions. It never deletes files. Automatic deletion must
remain disabled until several scheduled backups and a complete restore chain
have been verified.

The latest source backup, latest R2 full baseline, and every archive required by
the current incremental chain must always be protected from pruning.

## Restore outline

1. Verify the recovery archive against its `.sha256` sidecar.
2. Extract the archive.
3. Restore `database/roles.sql`, then `database/schema.sql`, then
   `database/data.sql` into a clean Supabase project.
4. Restore the latest complete source bundle with:

   ```text
   git clone megamaf-repository.bundle MegaMaf
   ```

5. For R2, begin with the archive whose run ID equals `baseFullRunId`.
6. Apply later incremental archives in chronological order.
7. Use the latest R2 manifest to reconcile deleted objects.
8. Verify table counts, copied row counts, policies, object counts, and
   SHA-256 checksums before reconnecting an application.

Always test restoration in the development project. Never test a restore against
the live production database.

## Security

- Keep the Drive folder private and enable two-factor authentication.
- Do not place database or cloud credentials inside an unencrypted archive.
- Only designated backup administrators should be allowed to trigger or export
  production backups.
- Rotate any credential that was exposed in chat, logs, screenshots, or source
  control before enabling unattended workflows.
