import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { isFile, loadJson, parseArgs } from "./common.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..", "..");
const args = parseArgs(process.argv.slice(2));
dotenv.config({
  path: path.resolve(repositoryRoot, String(args.env ?? ".env.local")),
  quiet: true,
});

const backupRoot = path.resolve(
  String(
    args.output ??
      process.env.BACKUP_OUTPUT_DIR ??
      path.resolve(repositoryRoot, "..", "production-backups"),
  ),
);
const catalog = await loadJson(
  path.join(backupRoot, ".backup-state", "catalog.json"),
  null,
);
if (!catalog) {
  throw new Error(`No backup catalog exists under ${backupRoot}`);
}

const runs = [...(catalog.runs ?? [])]
  .filter((run) => run.completedAt && run.archive)
  .sort((left, right) => right.completedAt.localeCompare(left.completedAt));
const keep = new Set();
const reasons = new Map();

for (const run of runs.slice(0, 7)) mark(run, "one of the latest 7 backups");
keepLatestPeriods(runs, 4, weekKey, "weekly retention");
keepLatestPeriods(runs, 12, monthKey, "monthly retention");

for (const protectedArchive of [
  catalog.source?.lastArchive,
  catalog.r2?.latestFullArchive,
  catalog.r2?.latestArchive,
]) {
  const protectedRun = runs.find((run) => run.archive === protectedArchive);
  if (protectedRun) mark(protectedRun, "required by the current recovery chain");
}

const result = [];
for (const run of runs) {
  result.push({
    runId: run.runId,
    completedAt: run.completedAt,
    mode: run.effectiveMode ?? run.mode,
    archive: run.archive,
    archiveExists: await isFile(run.archive),
    action: keep.has(run.runId) ? "KEEP" : "PRUNE_CANDIDATE",
    reasons: reasons.get(run.runId) ?? [],
  });
}

process.stdout.write(
  `${JSON.stringify(
    {
      policy: {
        latestDaily: 7,
        latestWeekly: 4,
        latestMonthly: 12,
        protectedRecoveryChain: true,
      },
      note: "Preview only. This command never deletes backup files.",
      backups: result,
    },
    null,
    2,
  )}\n`,
);

function mark(run, reason) {
  keep.add(run.runId);
  reasons.set(run.runId, [...(reasons.get(run.runId) ?? []), reason]);
}

function keepLatestPeriods(allRuns, limit, keyFunction, reason) {
  const seen = new Set();
  for (const run of allRuns) {
    const key = keyFunction(new Date(run.completedAt));
    if (seen.has(key)) continue;
    if (seen.size >= limit) break;
    seen.add(key);
    mark(run, reason);
  }
}

function monthKey(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function weekKey(date) {
  const value = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
  const day = value.getUTCDay() || 7;
  value.setUTCDate(value.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(value.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((value - yearStart) / 86400000 + 1) / 7);
  return `${value.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}
