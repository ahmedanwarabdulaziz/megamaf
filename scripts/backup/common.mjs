import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, open, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

export function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      result[key] = true;
    } else {
      result[key] = next;
      index += 1;
    }
  }
  return result;
}

export function runId(date = new Date()) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

export async function ensureDir(directory) {
  await mkdir(directory, { recursive: true });
  return directory;
}

export async function loadJson(file, fallback = null) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return fallback;
    throw error;
  }
}

export async function writeJsonAtomic(file, value) {
  await ensureDir(path.dirname(file));
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, file);
}

export async function sha256File(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex").toUpperCase();
}

export async function fileInfo(file) {
  const details = await stat(file);
  return {
    path: file,
    bytes: details.size,
    sha256: await sha256File(file),
  };
}

export async function assertNonEmpty(file, label = path.basename(file)) {
  const details = await stat(file);
  if (!details.isFile() || details.size === 0) {
    throw new Error(`${label} was not created or is empty.`);
  }
  return details.size;
}

export async function isFile(file) {
  try {
    return (await stat(file)).isFile();
  } catch {
    return false;
  }
}

export function runCommand(command, args, options = {}) {
  const {
    cwd,
    env = process.env,
    label = command,
    quiet = false,
    capture = false,
  } = options;

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      windowsHide: true,
      stdio: capture ? ["ignore", "pipe", "pipe"] : ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      const value = chunk.toString();
      if (capture) stdout += value;
      if (!quiet) process.stdout.write(value);
    });
    child.stderr.on("data", (chunk) => {
      const value = chunk.toString();
      if (capture) stderr += value;
      if (!quiet) process.stderr.write(value);
    });
    child.on("error", (error) => {
      reject(new Error(`${label} could not start: ${error.message}`, { cause: error }));
    });
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ code, stdout, stderr });
      } else {
        reject(new Error(`${label} failed with exit code ${code}.`));
      }
    });
  });
}

export async function commandOutput(command, args, options = {}) {
  const result = await runCommand(command, args, {
    ...options,
    quiet: true,
    capture: true,
  });
  return result.stdout.trim();
}

export async function acquireLock(lockFile) {
  await ensureDir(path.dirname(lockFile));
  try {
    const handle = await open(lockFile, "wx");
    await handle.writeFile(
      JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }),
      "utf8",
    );
    return async () => {
      await handle.close();
      const { unlink } = await import("node:fs/promises");
      await unlink(lockFile).catch(() => {});
    };
  } catch (error) {
    if (error?.code === "EEXIST") {
      throw new Error(
        `Another backup is already running. If it is not, remove the stale lock: ${lockFile}`,
      );
    }
    throw error;
  }
}

export function normalizeEtag(etag) {
  return String(etag ?? "").replace(/^"|"$/g, "");
}

export function safeFilename(value, fallback = "file") {
  const cleaned = String(value)
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_")
    .replace(/[. ]+$/g, "")
    .slice(0, 120);
  return cleaned || fallback;
}

export function contentPath(bucket, key) {
  const digest = createHash("sha256").update(`${bucket}\0${key}`).digest("hex");
  return path.join(
    "r2",
    "objects",
    safeFilename(bucket, "bucket"),
    digest.slice(0, 2),
    `${digest.slice(0, 20)}-${safeFilename(path.basename(key), "object")}`,
  );
}

export function relativePortable(from, to) {
  return path.relative(from, to).split(path.sep).join("/");
}

export async function createTarGz(sourceDirectory, archiveFile) {
  await ensureDir(path.dirname(archiveFile));
  await runCommand("tar", ["-czf", archiveFile, "-C", sourceDirectory, "."], {
    label: "backup archive creation",
  });
  await assertNonEmpty(archiveFile, "backup archive");
}

export function logStep(message) {
  process.stdout.write(`\n[backup] ${message}\n`);
}
