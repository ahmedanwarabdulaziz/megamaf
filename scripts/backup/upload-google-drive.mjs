import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import {
  loadJson,
  parseArgs,
  sha256File,
  writeJsonAtomic,
} from "./common.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..", "..");
const args = parseArgs(process.argv.slice(2));
dotenv.config({
  path: path.resolve(repositoryRoot, String(args.env ?? ".env.local")),
  quiet: true,
});

const clientId = required("GOOGLE_DRIVE_CLIENT_ID");
const clientSecret = required("GOOGLE_DRIVE_CLIENT_SECRET");
const refreshToken = required("GOOGLE_DRIVE_REFRESH_TOKEN");
const folderId = required("GOOGLE_DRIVE_FOLDER_ID");
const resultFile = path.resolve(
  String(
    args.result ??
      path.join(
        process.env.BACKUP_OUTPUT_DIR ??
          path.resolve(repositoryRoot, "..", "production-backups"),
        "latest-result.json",
      ),
  ),
);
const backupResult = await loadJson(resultFile);
if (!backupResult?.archive) {
  throw new Error(`No completed backup result was found at ${resultFile}`);
}

const accessToken = await getAccessToken({
  clientId,
  clientSecret,
  refreshToken,
});
const archivePath = path.resolve(backupResult.archive);
const checksumPath = path.resolve(
  backupResult.checksumFile ?? `${archivePath}.sha256`,
);

const archiveUpload = await uploadIfMissing({
  accessToken,
  folderId,
  file: archivePath,
  mimeType: "application/gzip",
  appProperties: {
    backupSha256: backupResult.sha256,
    backupRunId: backupResult.runId,
    backupMode: backupResult.effectiveMode ?? backupResult.mode,
  },
});
const checksumUpload = await uploadIfMissing({
  accessToken,
  folderId,
  file: checksumPath,
  mimeType: "text/plain",
  appProperties: {
    backupRunId: backupResult.runId,
    backupSidecar: "sha256",
  },
});

const uploadResult = {
  version: 1,
  runId: backupResult.runId,
  uploadedAt: new Date().toISOString(),
  folderId,
  archive: archiveUpload,
  checksum: checksumUpload,
};
const output = path.join(path.dirname(resultFile), "latest-drive-upload.json");
await writeJsonAtomic(output, uploadResult);
process.stdout.write(
  `${JSON.stringify(
    {
      runId: uploadResult.runId,
      archiveName: uploadResult.archive.name,
      archiveId: uploadResult.archive.id,
      archiveBytes: uploadResult.archive.size,
      reusedExistingFile: uploadResult.archive.reusedExistingFile,
    },
    null,
    2,
  )}\n`,
);

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for Google Drive upload.`);
  return value;
}

async function getAccessToken({ clientId, clientSecret, refreshToken }) {
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  const payload = await response.json();
  if (!response.ok || !payload.access_token) {
    throw new Error(
      `Google OAuth token refresh failed (${response.status}): ${payload.error ?? "unknown error"}`,
    );
  }
  return payload.access_token;
}

async function uploadIfMissing({
  accessToken,
  folderId,
  file,
  mimeType,
  appProperties,
}) {
  const details = await stat(file);
  const checksum = await sha256File(file);
  const existing = await findExisting({
    accessToken,
    folderId,
    name: path.basename(file),
    checksum,
  });
  if (existing) return { ...existing, reusedExistingFile: true };

  const metadata = {
    name: path.basename(file),
    parents: [folderId],
    description: "Verified MegaMaf disaster-recovery backup",
    appProperties: {
      ...appProperties,
      uploadSha256: checksum,
    },
  };
  const session = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,size,md5Checksum,webViewLink,createdTime",
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json; charset=UTF-8",
        "x-upload-content-type": mimeType,
        "x-upload-content-length": String(details.size),
      },
      body: JSON.stringify(metadata),
    },
  );
  if (!session.ok) {
    throw new Error(
      `Google Drive upload session failed (${session.status}): ${await safeText(session)}`,
    );
  }
  const uploadUrl = session.headers.get("location");
  if (!uploadUrl) throw new Error("Google Drive returned no resumable upload URL.");

  const response = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      "content-type": mimeType,
      "content-length": String(details.size),
    },
    body: createReadStream(file),
    duplex: "half",
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(
      `Google Drive upload failed (${response.status}): ${payload.error?.message ?? "unknown error"}`,
    );
  }
  if (Number(payload.size) !== details.size) {
    throw new Error(`Google Drive size verification failed for ${path.basename(file)}`);
  }
  return { ...payload, reusedExistingFile: false, uploadSha256: checksum };
}

async function findExisting({ accessToken, folderId, name, checksum }) {
  const query = [
    `'${escapeQuery(folderId)}' in parents`,
    "trashed = false",
    `name = '${escapeQuery(name)}'`,
    `appProperties has { key='uploadSha256' and value='${escapeQuery(checksum)}' }`,
  ].join(" and ");
  const url = new URL("https://www.googleapis.com/drive/v3/files");
  url.searchParams.set("q", query);
  url.searchParams.set("fields", "files(id,name,size,md5Checksum,webViewLink,createdTime)");
  url.searchParams.set("pageSize", "1");
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(
      `Google Drive duplicate check failed (${response.status}): ${payload.error?.message ?? "unknown error"}`,
    );
  }
  return payload.files?.[0] ?? null;
}

function escapeQuery(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

async function safeText(response) {
  const text = await response.text();
  return text.slice(0, 500);
}
