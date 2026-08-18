import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { parseArgs } from "./common.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..", "..");
const args = parseArgs(process.argv.slice(2));
const envFile = path.resolve(repositoryRoot, String(args.env ?? ".env.local"));
dotenv.config({ path: envFile, quiet: true });

const oauthClient = await loadOAuthClient();
const clientId = oauthClient.clientId;
const clientSecret = oauthClient.clientSecret;
const targetParentId =
  String(args["target-parent"] ?? process.env.GOOGLE_DRIVE_TARGET_PARENT_ID ?? "") ||
  null;
const folderName = String(
  args["folder-name"] ?? "MegaMaf Automated Backups",
);
const state = randomBytes(24).toString("hex");
const callback = await waitForAuthorizationCode(state);

process.stdout.write(
  "\nOpen this Google authorization URL in your browser and approve the limited Drive access:\n\n",
);
process.stdout.write(`${callback.authorizationUrl}\n\n`);

const { code } = await callback.code;
const tokens = await exchangeCode({
  code,
  redirectUri: callback.redirectUri,
  clientId,
  clientSecret,
});
if (!tokens.refresh_token) {
  throw new Error(
    "Google did not return an offline refresh token. Revoke the previous app grant and run authorization again.",
  );
}

let selectedParent = null;
if (targetParentId) {
  selectedParent = await getFolder(tokens.access_token, targetParentId).catch(
    () => null,
  );
}

const createdFolder = await createFolder({
  accessToken: tokens.access_token,
  name: folderName,
  parentId:
    selectedParent?.mimeType === "application/vnd.google-apps.folder"
      ? selectedParent.id
      : null,
});

await upsertEnv(envFile, {
  GOOGLE_DRIVE_CLIENT_ID: clientId,
  GOOGLE_DRIVE_CLIENT_SECRET: clientSecret,
  GOOGLE_DRIVE_REFRESH_TOKEN: tokens.refresh_token,
  GOOGLE_DRIVE_FOLDER_ID: createdFolder.id,
  ...(targetParentId
    ? { GOOGLE_DRIVE_TARGET_PARENT_ID: targetParentId }
    : {}),
});

process.stdout.write("\nGoogle Drive authorization completed.\n");
process.stdout.write(`Upload folder: ${createdFolder.name}\n`);
process.stdout.write(`Folder ID: ${createdFolder.id}\n`);
if (targetParentId && !selectedParent) {
  process.stdout.write(
    "The limited OAuth permission could not directly open the existing parent folder. Move the newly created folder into 'Mega Maf Backups' once in Google Drive; its ID and authorization will remain valid.\n",
  );
}
process.stdout.write(
  "The refresh token was stored only in .env.local and was not printed.\n",
);

async function loadOAuthClient() {
  if (
    process.env.GOOGLE_DRIVE_CLIENT_ID &&
    process.env.GOOGLE_DRIVE_CLIENT_SECRET
  ) {
    return {
      clientId: process.env.GOOGLE_DRIVE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_DRIVE_CLIENT_SECRET,
    };
  }
  const clientFile = path.resolve(
    repositoryRoot,
    String(
      args["client-json"] ??
        path.join(".backup-state", "google-oauth-client.json"),
    ),
  );
  let payload;
  try {
    payload = JSON.parse(await readFile(clientFile, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new Error(
        `Google OAuth client credentials are missing. Save the downloaded Desktop client JSON at ${clientFile}`,
      );
    }
    throw new Error(`Could not read Google OAuth client JSON: ${error.message}`);
  }
  const client = payload.installed ?? payload.web;
  if (!client?.client_id || !client?.client_secret) {
    throw new Error("The Google OAuth JSON does not contain Desktop client credentials.");
  }
  return { clientId: client.client_id, clientSecret: client.client_secret };
}

async function waitForAuthorizationCode(expectedState) {
  let resolveCode;
  let rejectCode;
  const code = new Promise((resolve, reject) => {
    resolveCode = resolve;
    rejectCode = reject;
  });
  const server = createServer((request, response) => {
    const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
    if (requestUrl.pathname !== "/oauth2callback") {
      response.writeHead(404).end("Not found");
      return;
    }
    const returnedState = requestUrl.searchParams.get("state");
    const error = requestUrl.searchParams.get("error");
    const authorizationCode = requestUrl.searchParams.get("code");
    if (returnedState !== expectedState) {
      response.writeHead(400).end("Invalid OAuth state");
      rejectCode(new Error("Google OAuth state verification failed."));
      server.close();
      return;
    }
    if (error || !authorizationCode) {
      response.writeHead(400).end("Authorization was not completed");
      rejectCode(new Error(`Google authorization failed: ${error ?? "no code"}`));
      server.close();
      return;
    }
    response
      .writeHead(200, { "content-type": "text/html; charset=utf-8" })
      .end(
        "<h1>MegaMaf backup authorization completed</h1><p>You may close this window.</p>",
      );
    resolveCode({ code: authorizationCode });
    server.close();
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const redirectUri = `http://127.0.0.1:${address.port}/oauth2callback`;
  const authorizationUrl = new URL(
    "https://accounts.google.com/o/oauth2/v2/auth",
  );
  authorizationUrl.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "https://www.googleapis.com/auth/drive.file",
    access_type: "offline",
    include_granted_scopes: "true",
    prompt: "consent",
    state: expectedState,
  }).toString();

  const timer = setTimeout(() => {
    rejectCode(new Error("Google authorization timed out after 10 minutes."));
    server.close();
  }, 10 * 60 * 1000);
  timer.unref();
  code.finally(() => clearTimeout(timer));

  return {
    authorizationUrl: authorizationUrl.toString(),
    redirectUri,
    code,
  };
}

async function exchangeCode({
  code,
  redirectUri,
  clientId: oauthClientId,
  clientSecret: oauthClientSecret,
}) {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: oauthClientId,
      client_secret: oauthClientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  const payload = await response.json();
  if (!response.ok || !payload.access_token) {
    throw new Error(
      `Google token exchange failed (${response.status}): ${payload.error ?? "unknown error"}`,
    );
  }
  return payload;
}

async function getFolder(accessToken, folderId) {
  const url = new URL(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(folderId)}`,
  );
  url.searchParams.set(
    "fields",
    "id,name,mimeType,parents,capabilities(canAddChildren)",
  );
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error?.message ?? "Folder access failed.");
  }
  if (!payload.capabilities?.canAddChildren) {
    throw new Error("The selected Google Drive folder is not writable.");
  }
  return payload;
}

async function createFolder({ accessToken, name, parentId }) {
  const metadata = {
    name,
    mimeType: "application/vnd.google-apps.folder",
    ...(parentId ? { parents: [parentId] } : {}),
  };
  const response = await fetch(
    "https://www.googleapis.com/drive/v3/files?fields=id,name,mimeType,parents,webViewLink",
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(metadata),
    },
  );
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(
      `Google Drive folder creation failed (${response.status}): ${payload.error?.message ?? "unknown error"}`,
    );
  }
  return payload;
}

async function upsertEnv(file, updates) {
  let text = "";
  try {
    text = await readFile(file, "utf8");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const lines = text.split(/\r?\n/);
  for (const [key, value] of Object.entries(updates)) {
    const index = lines.findIndex((line) =>
      new RegExp(`^\\s*${escapeRegex(key)}\\s*=`).test(line),
    );
    const nextLine = `${key}=${value}`;
    if (index >= 0) lines[index] = nextLine;
    else lines.push(nextLine);
  }
  await writeFile(file, `${lines.join("\n").replace(/^\n+/, "")}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
