import { createWriteStream } from "node:fs";
import {
  readFile,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pipeline } from "node:stream/promises";
import dotenv from "dotenv";
import {
  GetObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";
import {
  acquireLock,
  assertNonEmpty,
  commandOutput,
  contentPath,
  createTarGz,
  ensureDir,
  fileInfo,
  isFile,
  loadJson,
  logStep,
  normalizeEtag,
  parseArgs,
  relativePortable,
  runCommand,
  runId,
  writeJsonAtomic,
} from "./common.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..", "..");
const args = parseArgs(process.argv.slice(2));
const allowedModes = new Set(["database", "incremental", "full", "source"]);
const requestedMode = String(args.mode ?? "database").toLowerCase();

if (!allowedModes.has(requestedMode)) {
  throw new Error(
    `Unknown backup mode "${requestedMode}". Use database, incremental, full, or source.`,
  );
}

const envFile = path.resolve(repositoryRoot, String(args.env ?? ".env.local"));
dotenv.config({ path: envFile, quiet: true });

const backupRoot = path.resolve(
  String(
    args.output ??
      process.env.BACKUP_OUTPUT_DIR ??
      path.resolve(repositoryRoot, "..", "production-backups"),
  ),
);
const stateDirectory = path.join(backupRoot, ".backup-state");
const catalogFile = path.join(stateDirectory, "catalog.json");
const latestR2ManifestFile = path.join(stateDirectory, "r2-latest.json");
const currentRunId = runId();
const runDirectory = path.join(backupRoot, currentRunId);
const archiveFile = path.join(
  backupRoot,
  `megamaf-${requestedMode}-${currentRunId}.tar.gz`,
);

await ensureDir(backupRoot);
const releaseLock = await acquireLock(path.join(stateDirectory, "backup.lock"));

let succeeded = false;
try {
  const catalog = await loadJson(catalogFile, {
    version: 1,
    createdAt: new Date().toISOString(),
    source: {},
    r2: {},
    runs: [],
  });
  await ensureDir(runDirectory);

  const report = {
    version: 1,
    runId: currentRunId,
    requestedMode,
    effectiveMode: requestedMode,
    startedAt: new Date().toISOString(),
    repositoryCommit: null,
    database: { included: false },
    source: { included: false },
    r2: { included: false },
  };

  const sourceResult = args["skip-source"]
    ? {
        included: false,
        commit: await commandOutput("git", ["rev-parse", "HEAD"], {
          cwd: repositoryRoot,
          label: "git commit detection",
        }),
      }
    : await backupSource({
        mode: requestedMode,
        catalog,
        report,
        runDirectory,
      });
  if (args["skip-source"]) {
    report.repositoryCommit = sourceResult.commit;
    report.source = {
      included: false,
      reason: "handled-by-source-on-push-workflow",
      commit: sourceResult.commit,
    };
  }

  if (requestedMode !== "source") {
    await backupDatabase({ report, runDirectory });
  }

  let pendingR2State = null;
  if (requestedMode === "incremental" || requestedMode === "full") {
    pendingR2State = await backupR2({
      requestedMode,
      report,
      runDirectory,
      previousManifest: await loadJson(latestR2ManifestFile, null),
    });
  }

  report.completedAt = new Date().toISOString();
  report.status = "verified";
  await writeJsonAtomic(path.join(runDirectory, "backup-manifest.json"), report);
  await writeRecoveryNotes(runDirectory, report);

  logStep("Creating a portable tar.gz archive");
  await createTarGz(runDirectory, archiveFile);
  const archive = await fileInfo(archiveFile);
  await writeFile(
    `${archiveFile}.sha256`,
    `${archive.sha256}  ${path.basename(archiveFile)}\n`,
    "utf8",
  );

  if (pendingR2State) {
    await writeJsonAtomic(latestR2ManifestFile, pendingR2State);
    catalog.r2.latestRunId = currentRunId;
    catalog.r2.latestArchive = archiveFile;
    catalog.r2.baseFullRunId = pendingR2State.baseFullRunId;
    if (pendingR2State.kind === "full") {
      catalog.r2.latestFullRunId = currentRunId;
      catalog.r2.latestFullArchive = archiveFile;
    }
  }

  if (sourceResult.included) {
    catalog.source.lastCommit = sourceResult.commit;
    catalog.source.lastRunId = currentRunId;
    catalog.source.lastArchive = archiveFile;
  }

  const completedRun = {
    runId: currentRunId,
    mode: requestedMode,
    effectiveMode: report.effectiveMode,
    completedAt: report.completedAt,
    archive: archiveFile,
    bytes: archive.bytes,
    sha256: archive.sha256,
    sourceIncluded: report.source.included,
    databaseIncluded: report.database.included,
    r2Included: report.r2.included,
  };
  catalog.runs = [...(catalog.runs ?? []), completedRun].slice(-500);
  catalog.updatedAt = new Date().toISOString();
  await writeJsonAtomic(catalogFile, catalog);

  const result = {
    ...completedRun,
    manifest: path.join(runDirectory, "backup-manifest.json"),
    checksumFile: `${archiveFile}.sha256`,
  };
  await writeJsonAtomic(path.join(backupRoot, "latest-result.json"), result);

  succeeded = true;
  logStep("Backup completed and verified");
  process.stdout.write(
    `${JSON.stringify(
      {
        runId: result.runId,
        mode: result.mode,
        effectiveMode: result.effectiveMode,
        archive: result.archive,
        bytes: result.bytes,
        sha256: result.sha256,
      },
      null,
      2,
    )}\n`,
  );
} finally {
  await releaseLock();
  if (!succeeded) {
    process.stderr.write(
      `\n[backup] Backup failed. Staging files were kept for diagnosis: ${runDirectory}\n`,
    );
  }
}

function databaseConnection() {
  const componentHost = process.env.BACKUP_DB_HOST;
  const componentPassword =
    process.env.BACKUP_DB_PASSWORD ?? process.env.SUPABASE_DB_PASSWORD;

  if (componentHost) {
    if (!componentPassword) {
      throw new Error("BACKUP_DB_PASSWORD or SUPABASE_DB_PASSWORD is required.");
    }
    const url = new URL("postgresql://placeholder");
    url.hostname = componentHost;
    url.port = process.env.BACKUP_DB_PORT ?? "5432";
    url.username = process.env.BACKUP_DB_USER ?? "postgres";
    url.pathname = `/${process.env.BACKUP_DB_NAME ?? "postgres"}`;
    url.searchParams.set("sslmode", process.env.BACKUP_DB_SSLMODE ?? "require");
    return { url: url.toString(), password: componentPassword };
  }

  const raw =
    process.env.BACKUP_DATABASE_URL ?? process.env.SUPABASE_DB_URL ?? "";
  if (!raw || /YOUR-PASSWORD|your_direct_database/i.test(raw)) {
    throw new Error(
      "Set BACKUP_DATABASE_URL, or BACKUP_DB_HOST/USER/PASSWORD components.",
    );
  }
  const parsed = new URL(raw);
  const password = parsed.password
    ? decodeURIComponent(parsed.password)
    : componentPassword;
  if (!password) {
    throw new Error("The configured database connection has no password.");
  }
  parsed.password = "";
  if (!parsed.searchParams.has("sslmode")) parsed.searchParams.set("sslmode", "require");
  return { url: parsed.toString(), password };
}

async function backupDatabase({ report, runDirectory }) {
  logStep("Creating roles, schema, and data dumps with the Supabase CLI");
  const databaseDirectory = await ensureDir(path.join(runDirectory, "database"));
  const rolesFile = path.join(databaseDirectory, "roles.sql");
  const schemaFile = path.join(databaseDirectory, "schema.sql");
  const dataFile = path.join(databaseDirectory, "data.sql");
  const cli = path.join(
    repositoryRoot,
    "node_modules",
    "supabase",
    "dist",
    "supabase.js",
  );
  if (!(await isFile(cli))) {
    throw new Error("Supabase CLI is missing. Run npm install before backing up.");
  }
  const connection = databaseConnection();
  const databaseEnvironment = {
    ...process.env,
    PGPASSWORD: connection.password,
    SUPABASE_DB_PASSWORD: connection.password,
  };

  await runCommand(
    process.execPath,
    [cli, "db", "dump", "--db-url", connection.url, "-f", rolesFile, "--role-only"],
    { cwd: repositoryRoot, env: databaseEnvironment, label: "roles dump" },
  );
  await runCommand(process.execPath, [cli, "db", "dump", "--db-url", connection.url, "-f", schemaFile], {
    cwd: repositoryRoot,
    env: databaseEnvironment,
    label: "schema dump",
  });
  await runCommand(
    process.execPath,
    [cli, "db", "dump", "--db-url", connection.url, "-f", dataFile, "--use-copy", "--data-only"],
    { cwd: repositoryRoot, env: databaseEnvironment, label: "data dump" },
  );

  await Promise.all([
    assertNonEmpty(rolesFile, "roles dump"),
    assertNonEmpty(schemaFile, "schema dump"),
    assertNonEmpty(dataFile, "data dump"),
  ]);

  const [rolesText, schemaText, dataText] = await Promise.all([
    readFile(rolesFile, "utf8"),
    readFile(schemaFile, "utf8"),
    readFile(dataFile, "utf8"),
  ]);
  const copyStats = countCopyRows(dataText);
  const files = await Promise.all(
    [rolesFile, schemaFile, dataFile].map(async (file) => {
      const info = await fileInfo(file);
      return {
        name: path.basename(file),
        bytes: info.bytes,
        sha256: info.sha256,
      };
    }),
  );

  report.database = {
    included: true,
    verified: true,
    publicTables:
      schemaText.match(/CREATE TABLE(?: IF NOT EXISTS)? "public"\./g)?.length ?? 0,
    policies: schemaText.match(/CREATE POLICY /g)?.length ?? 0,
    roleSettings: rolesText.match(/ALTER ROLE /g)?.length ?? 0,
    copySections: copyStats.sections,
    copiedRows: copyStats.rows,
    files,
  };
}

function countCopyRows(sql) {
  let insideCopy = false;
  let sections = 0;
  let rows = 0;
  for (const line of sql.split(/\r?\n/)) {
    if (!insideCopy && /^COPY\s/.test(line)) {
      insideCopy = true;
      sections += 1;
      continue;
    }
    if (insideCopy && line === "\\.") {
      insideCopy = false;
      continue;
    }
    if (insideCopy) rows += 1;
  }
  return { sections, rows };
}

async function backupSource({ mode, catalog, report, runDirectory }) {
  const commit = await commandOutput("git", ["rev-parse", "HEAD"], {
    cwd: repositoryRoot,
    label: "git commit detection",
  });
  const branch = await commandOutput("git", ["branch", "--show-current"], {
    cwd: repositoryRoot,
    label: "git branch detection",
  });
  const trackedChanges = await commandOutput(
    "git",
    ["status", "--porcelain", "--untracked-files=no"],
    { cwd: repositoryRoot, label: "git status detection" },
  );
  const include =
    mode === "full" || mode === "source" || catalog.source?.lastCommit !== commit;

  report.repositoryCommit = commit;
  if (!include) {
    report.source = {
      included: false,
      reason: "unchanged",
      commit,
      branch,
      lastBackupArchive: catalog.source?.lastArchive ?? null,
    };
    return { included: false, commit };
  }

  logStep("Backing up Git history and the committed production source");
  const sourceDirectory = await ensureDir(path.join(runDirectory, "application"));
  const bundleFile = path.join(sourceDirectory, "megamaf-repository.bundle");
  const sourceFile = path.join(sourceDirectory, "megamaf-source.zip");
  await runCommand("git", ["bundle", "create", bundleFile, "--all"], {
    cwd: repositoryRoot,
    label: "Git repository bundle",
  });
  await runCommand(
    "git",
    ["archive", "--format=zip", `--output=${sourceFile}`, "HEAD"],
    { cwd: repositoryRoot, label: "source snapshot" },
  );
  await Promise.all([
    assertNonEmpty(bundleFile, "Git repository bundle"),
    assertNonEmpty(sourceFile, "source snapshot"),
  ]);
  report.source = {
    included: true,
    verified: true,
    commit,
    branch,
    trackedWorkingTreeClean: trackedChanges.length === 0,
    files: await Promise.all(
      [bundleFile, sourceFile].map(async (file) => {
        const info = await fileInfo(file);
        return {
          name: path.basename(file),
          bytes: info.bytes,
          sha256: info.sha256,
        };
      }),
    ),
  };
  return { included: true, commit };
}

async function backupR2({ requestedMode, report, runDirectory, previousManifest }) {
  const endpoint = process.env.R2_ENDPOINT;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const buckets = [
    process.env.R2_BUCKET_NAME,
    process.env.R2_BUCKET_NAME_TREASURY,
  ].filter(Boolean);
  if (!endpoint || !accessKeyId || !secretAccessKey || buckets.length === 0) {
    throw new Error("R2 endpoint, credentials, and bucket names are required.");
  }

  let effectiveMode = requestedMode;
  if (
    requestedMode === "incremental" &&
    (!previousManifest || !previousManifest.baseFullRunId)
  ) {
    effectiveMode = "full";
    report.effectiveMode = "full";
    logStep("No valid R2 baseline exists; creating a full R2 backup instead");
  }

  logStep("Listing R2 objects and comparing them with the previous manifest");
  const client = new S3Client({
    region: "auto",
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
  });
  const previousByKey = new Map(
    (previousManifest?.objects ?? []).map((object) => [
      `${object.bucket}\0${object.key}`,
      object,
    ]),
  );
  const currentObjects = [];

  for (const bucket of [...new Set(buckets)]) {
    for (const object of await listBucket(client, bucket)) {
      currentObjects.push({
        bucket,
        key: object.Key,
        bytes: Number(object.Size ?? 0),
        etag: normalizeEtag(object.ETag),
        lastModified: object.LastModified?.toISOString() ?? null,
      });
    }
  }

  const changed = [];
  const unchanged = [];
  for (const object of currentObjects) {
    const previous = previousByKey.get(`${object.bucket}\0${object.key}`);
    const same =
      previous &&
      previous.bytes === object.bytes &&
      previous.etag === object.etag;
    if (effectiveMode === "full" || !same) changed.push(object);
    else unchanged.push({ ...object, ...pickContentReference(previous) });
  }

  const currentKeys = new Set(
    currentObjects.map((object) => `${object.bucket}\0${object.key}`),
  );
  const deleted = (previousManifest?.objects ?? [])
    .filter((object) => !currentKeys.has(`${object.bucket}\0${object.key}`))
    .map(({ bucket, key }) => ({ bucket, key }));

  logStep(
    `Downloading ${changed.length} new or changed R2 object(s); ${unchanged.length} unchanged`,
  );
  await mapLimit(changed, 4, async (object) => {
    const relativeFile = contentPath(object.bucket, object.key);
    const destination = path.join(runDirectory, relativeFile);
    await ensureDir(path.dirname(destination));
    const response = await client.send(
      new GetObjectCommand({ Bucket: object.bucket, Key: object.key }),
    );
    if (!response.Body) {
      throw new Error(`R2 returned no body for ${object.bucket}/${object.key}`);
    }
    await pipeline(response.Body, createWriteStream(destination));
    const info = await fileInfo(destination);
    if (info.bytes !== object.bytes) {
      throw new Error(
        `R2 size verification failed for ${object.bucket}/${object.key}`,
      );
    }
    object.sha256 = info.sha256;
    object.contentRunId = currentRunId;
    object.localPath = relativePortable(runDirectory, destination);
  });

  const manifest = {
    version: 1,
    runId: currentRunId,
    kind: effectiveMode,
    baseFullRunId:
      effectiveMode === "full" ? currentRunId : previousManifest.baseFullRunId,
    createdAt: new Date().toISOString(),
    buckets: [...new Set(buckets)],
    objects: [...changed, ...unchanged].sort(
      (left, right) =>
        left.bucket.localeCompare(right.bucket) || left.key.localeCompare(right.key),
    ),
    deleted,
  };
  await writeJsonAtomic(path.join(runDirectory, "r2", "r2-manifest.json"), manifest);

  report.r2 = {
    included: true,
    verified: true,
    kind: effectiveMode,
    baseFullRunId: manifest.baseFullRunId,
    totalObjects: manifest.objects.length,
    downloadedObjects: changed.length,
    unchangedObjects: unchanged.length,
    deletedObjects: deleted.length,
    downloadedBytes: changed.reduce((sum, object) => sum + object.bytes, 0),
  };
  return manifest;
}

function pickContentReference(object) {
  return {
    sha256: object.sha256,
    contentRunId: object.contentRunId,
    localPath: object.localPath,
  };
}

async function listBucket(client, bucket) {
  const objects = [];
  let continuationToken;
  do {
    const response = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        ContinuationToken: continuationToken,
      }),
    );
    objects.push(...(response.Contents ?? []));
    continuationToken = response.IsTruncated
      ? response.NextContinuationToken
      : undefined;
  } while (continuationToken);
  return objects;
}

async function mapLimit(items, limit, worker) {
  let index = 0;
  const runners = Array.from(
    { length: Math.min(limit, Math.max(items.length, 1)) },
    async () => {
      while (index < items.length) {
        const current = items[index];
        index += 1;
        await worker(current);
      }
    },
  );
  await Promise.all(runners);
}

async function writeRecoveryNotes(directory, report) {
  const notes = [
    "MegaMaf recovery package",
    "========================",
    "",
    `Run: ${report.runId}`,
    `Mode: ${report.effectiveMode}`,
    `Production commit: ${report.repositoryCommit}`,
    "",
    "This package contains no plaintext environment file.",
    "Verify the archive SHA-256 sidecar before restoration.",
    "Use docs/backup/README.md from the repository for the tested restore procedure.",
    "For incremental R2 recovery, begin with baseFullRunId and apply later manifests in order.",
    "",
  ].join("\n");
  await writeFile(path.join(directory, "RECOVERY-NOTES.txt"), notes, "utf8");
}
