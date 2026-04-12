import process from "node:process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ConvexHttpClient } from "convex/browser";
import { Argument, Command } from "effect/unstable/cli";
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Effect, Option } from "effect";
import { config as loadEnvFile } from "dotenv";

import { api } from "../../../convex/_generated/api.js";

import { clearStoredSession, readStoredSession, writeStoredSession } from "./storage";

type DeviceCodeResult = {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string;
  expiresIn: number;
  interval: number;
};

type SignedInResult = {
  kind: "signedIn";
  tokens: {
    token: string;
    refreshToken?: string;
  } | null;
};

function loadCliEnv() {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const cliDir = path.resolve(currentDir, "..");
  const repoRoot = path.resolve(cliDir, "..", "..");
  for (const filePath of [
    path.join(repoRoot, ".env.local"),
    path.join(repoRoot, ".env"),
    path.join(cliDir, ".env.local"),
    path.join(cliDir, ".env"),
    path.join(repoRoot, "demos", "svelte", ".env.local"),
    path.join(repoRoot, "demos", "svelte", ".env"),
  ]) {
    if (existsSync(filePath)) {
      loadEnvFile({ path: filePath, override: false, quiet: true });
    }
  }
}

loadCliEnv();

function requireConvexUrl() {
  const url = process.env.VITE_CONVEX_URL ?? process.env.CONVEX_URL;
  if (!url) {
    throw new Error("Set VITE_CONVEX_URL or CONVEX_URL before running the CLI demo.");
  }
  return url;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isDeviceCodeResult(value: unknown): value is DeviceCodeResult {
  return (
    isRecord(value) &&
    typeof value.deviceCode === "string" &&
    typeof value.userCode === "string" &&
    typeof value.verificationUri === "string" &&
    typeof value.verificationUriComplete === "string" &&
    typeof value.expiresIn === "number" &&
    typeof value.interval === "number"
  );
}

function isSignedInResult(value: unknown): value is SignedInResult {
  return (
    isRecord(value) &&
    value.kind === "signedIn" &&
    (value.tokens === null || isRecord(value.tokens))
  );
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function createClient() {
  const url = requireConvexUrl();
  return new ConvexHttpClient(url);
}

async function applyStoredSession(client: ConvexHttpClient) {
  const session = await readStoredSession();
  if (session?.token) {
    client.setAuth(session.token);
  }
}

async function startDeviceLogin(client: ConvexHttpClient) {
  const result = await client.action(api.auth.signIn, {
    provider: "device",
  });
  if (!isRecord(result) || result.kind !== "deviceCode" || !isDeviceCodeResult(result.deviceCode)) {
    throw new Error("Device sign-in did not return a device code.");
  }
  return result.deviceCode;
}

async function pollDeviceLogin(client: ConvexHttpClient, code: DeviceCodeResult) {
  const deadline = Date.now() + code.expiresIn * 1000;
  while (Date.now() < deadline) {
    await sleep(code.interval * 1000);
    try {
      const result = await client.action(api.auth.signIn, {
        provider: "device",
        params: {
          flow: "poll",
          deviceCode: code.deviceCode,
        },
      });
      if (isSignedInResult(result) && result.tokens) {
        await writeStoredSession(result.tokens);
        return;
      }
    } catch (error) {
      if (
        isRecord(error) &&
        isRecord(error.data) &&
        (error.data.code === "DEVICE_AUTHORIZATION_PENDING" ||
          error.data.code === "DEVICE_SLOW_DOWN")
      ) {
        continue;
      }
      throw error;
    }
  }
  throw new Error("Device code expired before approval completed.");
}

async function requireSession() {
  const session = await readStoredSession();
  if (!session) {
    throw new Error("Not signed in. Run `auth login` first.");
  }
  return session;
}

async function refreshSessionIfNeeded(client: ConvexHttpClient) {
  const session = await requireSession();
  client.setAuth(session.token);
  if (!session.refreshToken) {
    return session;
  }
  const result = await client.action(api.auth.signIn, {
    refreshToken: session.refreshToken,
  });
  if (isSignedInResult(result) && result.tokens) {
    await writeStoredSession(result.tokens);
    client.setAuth(result.tokens.token);
    return result.tokens;
  }
  return session;
}

async function doAuthLogin() {
  const client = createClient();
  const code = await startDeviceLogin(client);
  console.log("Open this URL in your browser:");
  console.log(code.verificationUri);
  console.log("");
  console.log("Or use the prefilled URL:");
  console.log(code.verificationUriComplete);
  console.log("");
  console.log(`Enter code: ${code.userCode}`);
  console.log("Waiting for approval...");
  await pollDeviceLogin(client, code);
  console.log("Login complete.");
}

async function doAuthStatus() {
  const client = createClient();
  await applyStoredSession(client);
  await refreshSessionIfNeeded(client);
  const groups = await client.query(api.groups.listMyGroups, {});
  console.log(JSON.stringify(groups, null, 2));
}

async function doAuthLogout() {
  await clearStoredSession();
  console.log("Stored credentials cleared.");
}

async function doGroupsList() {
  const client = createClient();
  await applyStoredSession(client);
  await refreshSessionIfNeeded(client);
  const groups = await client.query(api.groups.listMyGroups, {});
  console.log(JSON.stringify(groups, null, 2));
}

async function doProjectsList(groupId: string) {
  const client = createClient();
  await applyStoredSession(client);
  await refreshSessionIfNeeded(client);
  const result = await client.query(api.projects.listProjects, {
    groupId,
  });
  console.log(JSON.stringify(result, null, 2));
}

async function doProjectsCreate(
  groupId: string,
  name: string,
  identifier: string,
  description?: string,
) {
  const client = createClient();
  await applyStoredSession(client);
  await refreshSessionIfNeeded(client);
  const result = await client.mutation(api.projects.createProjectByString, {
    groupId,
    name,
    identifier,
    ...(description ? { description } : {}),
  });
  console.log(JSON.stringify(result, null, 2));
}

async function doIssuesList(projectId: string) {
  const client = createClient();
  await applyStoredSession(client);
  await refreshSessionIfNeeded(client);
  const result = await client.query(api.issues.projectIssuesByString, {
    projectId,
  });
  console.log(JSON.stringify(result, null, 2));
}

async function doIssuesCreate(
  projectId: string,
  title: string,
  description?: string,
) {
  const client = createClient();
  await applyStoredSession(client);
  await refreshSessionIfNeeded(client);
  const result = await client.mutation(api.issues.createIssueByString, {
    projectId,
    title,
    ...(description ? { description } : {}),
  });
  console.log(JSON.stringify(result, null, 2));
}

const authLogin = Command.make("login", {}, () =>
  Effect.tryPromise(doAuthLogin),
).pipe(Command.withDescription("Authenticate with device flow and store session tokens locally."));

const authStatus = Command.make("status", {}, () =>
  Effect.tryPromise(doAuthStatus),
).pipe(Command.withDescription("Show groups visible to the current session."));

const authLogout = Command.make("logout", {}, () =>
  Effect.tryPromise(doAuthLogout),
).pipe(Command.withDescription("Remove locally stored session tokens."));

const authCommand = Command.make("auth").pipe(
  Command.withSubcommands([authLogin, authStatus, authLogout]),
  Command.withDescription("Authentication commands."),
);

const groupsList = Command.make("list", {}, () =>
  Effect.tryPromise(doGroupsList),
).pipe(Command.withDescription("List groups available to the current session."));

const groupsCommand = Command.make("groups").pipe(
  Command.withSubcommands([groupsList]),
  Command.withDescription("Group discovery commands."),
);

const projectsList = Command.make(
  "list",
  { group: Argument.string("group") },
  ({ group }) => Effect.tryPromise(() => doProjectsList(group)),
).pipe(Command.withDescription("List projects for a group ID."));

const projectsCreate = Command.make(
  "create",
  {
    group: Argument.string("group"),
    name: Argument.string("name"),
    identifier: Argument.string("identifier"),
    description: Argument.string("description").pipe(Argument.optional),
  },
  ({ group, name, identifier, description }) =>
    Effect.tryPromise(() =>
      doProjectsCreate(
        group,
        name,
        identifier,
        Option.isSome(description) ? description.value : undefined,
      ),
    ),
).pipe(Command.withDescription("Create a project in a group."));

const projectsCommand = Command.make("projects").pipe(
  Command.withSubcommands([projectsList, projectsCreate]),
  Command.withDescription("Project commands."),
);

const issuesList = Command.make(
  "list",
  { project: Argument.string("project") },
  ({ project }) => Effect.tryPromise(() => doIssuesList(project)),
).pipe(Command.withDescription("List issues for a project ID."));

const issuesCreate = Command.make(
  "create",
  {
    project: Argument.string("project"),
    title: Argument.string("title"),
    description: Argument.string("description").pipe(Argument.optional),
  },
  ({ project, title, description }) =>
    Effect.tryPromise(() =>
      doIssuesCreate(
        project,
        title,
        Option.isSome(description) ? description.value : undefined,
      ),
    ),
).pipe(Command.withDescription("Create an issue in a project."));

const issuesCommand = Command.make("issues").pipe(
  Command.withSubcommands([issuesList, issuesCreate]),
  Command.withDescription("Issue commands using direct Convex functions."),
);

const rootCommand = Command.make("convex-auth-demo").pipe(
  Command.withSubcommands([
    authCommand,
    groupsCommand,
    projectsCommand,
    issuesCommand,
  ]),
  Command.withDescription("CLI demo for convex-auth using device login and direct Convex calls."),
);

const runCli = Command.run(rootCommand, { version: "0.0.1" });

export function runCliMain(argv = process.argv) {
  process.argv = argv;
  return runCli.pipe(Effect.provide(NodeServices.layer), NodeRuntime.runMain);
}

runCliMain();
