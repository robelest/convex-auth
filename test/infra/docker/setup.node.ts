import { execFile } from "node:child_process";
import { access, rename } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const setupDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(setupDir, "../../..");
const composePath = resolve(setupDir, "compose.yml");
const DEFAULT_WAIT_TIMEOUT_MS = 120_000;
const DEFAULT_CONVEX_TIMEOUT_MS = 300_000;
const envLocalPath = resolve(repoRoot, ".env.local");
const envLocalBackupPath = resolve(repoRoot, ".env.local.test-backup");

type RunOptions = {
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
};

function requireEnv(name: string) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required test env: ${name}`);
  }
  return value;
}

async function run(command: string, args: string[], options: RunOptions = {}) {
  try {
    return await execFileAsync(command, args, {
      cwd: repoRoot,
      env: options.env ?? process.env,
      timeout: options.timeoutMs,
      maxBuffer: 10 * 1024 * 1024,
      windowsHide: true,
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Command execution failed unexpectedly.";
    throw new Error(`${command} ${args.join(" ")} failed: ${message}`);
  }
}

function envNumber(name: string, fallback: number) {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

async function waitForHealthy(service: string, timeoutMs: number) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const { stdout: idOut } = await run("docker", [
      "compose",
      "-f",
      composePath,
      "ps",
      "-q",
      service,
    ]);
    const containerId = idOut.trim();
    if (!containerId) {
      await delay(1_000);
      continue;
    }

    const { stdout: healthOut } = await run("docker", [
      "inspect",
      "--format",
      "{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}",
      containerId,
    ]);
    const health = healthOut.trim();
    if (health === "healthy" || health === "none") {
      return;
    }
    if (health === "unhealthy") {
      const { stdout, stderr } = await run("docker", [
        "compose",
        "-f",
        composePath,
        "logs",
        service,
        "--since=5m",
      ]);
      throw new Error(
        `${service} became unhealthy.\n${stdout}${stderr ? `\n${stderr}` : ""}`,
      );
    }
    await delay(1_000);
  }
  throw new Error(`Timed out waiting for ${service} to become healthy.`);
}

function parseAdminKey(stdout: string, stderr: string) {
  const combined = `${stdout}\n${stderr}`;
  const match = combined.match(/convex-self-hosted\|[A-Za-z0-9]+/);
  if (!match) {
    throw new Error(
      `Unable to parse generated admin key from output:\n${combined}`,
    );
  }
  return match[0];
}

async function setConvexEnv(
  convexEnv: NodeJS.ProcessEnv,
  name: string,
  value: string | undefined,
) {
  if (!value) {
    return;
  }
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      await run(
        "env",
        [
          "-u",
          "CONVEX_DEPLOYMENT",
          "vp",
          "exec",
          "convex",
          "env",
          "set",
          "--",
          name,
          value,
        ],
        {
          env: convexEnv,
        },
      );
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const isRetryable =
        message.includes("OptimisticConcurrencyControlFailure") ||
        message.includes("503 Service Unavailable");
      if (!isRetryable || attempt === 5) {
        throw error;
      }
      await delay(attempt * 500);
    }
  }
}

async function readFileFromZitadel(remotePath: string, timeoutMs: number) {
  const bootstrapVolume = await getZitadelBootstrapVolume();
  const fileName = remotePath.split("/").at(-1);
  if (!fileName) {
    throw new Error(`Could not determine filename for ${remotePath}.`);
  }

  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const { stdout } = await run("docker", [
        "run",
        "--rm",
        "-v",
        `${bootstrapVolume}:/data`,
        "alpine",
        "cat",
        `/data/${fileName}`,
      ]);
      const value = stdout.trim();
      if (value !== "") {
        return value;
      }
    } catch {
      await delay(1_000);
    }
  }
  throw new Error(`Timed out reading ${remotePath} from zitadel.`);
}

async function getZitadelBootstrapVolume() {
  const { stdout: idOut } = await run("docker", [
    "compose",
    "-f",
    composePath,
    "ps",
    "-q",
    "zitadel",
  ]);
  const containerId = idOut.trim();
  if (!containerId) {
    throw new Error("Could not find the running zitadel container.");
  }

  const { stdout: volumeOut } = await run("docker", [
    "inspect",
    "--format",
    '{{range .Mounts}}{{if eq .Destination "/zitadel/bootstrap"}}{{.Name}}{{end}}{{end}}',
    containerId,
  ]);
  const bootstrapVolume = volumeOut.trim();
  if (!bootstrapVolume) {
    throw new Error("Could not find the zitadel bootstrap volume.");
  }
  return bootstrapVolume;
}

function shouldPrepareInteropInfra() {
  return (
    process.env.ZITADEL_INTEROP_TEST === "true" &&
    process.env.ZITADEL_MANAGE_COMPOSE === "true"
  );
}

async function hideEnvLocalForSelfHostedCommands() {
  try {
    await access(envLocalPath);
  } catch {
    return false;
  }
  await rename(envLocalPath, envLocalBackupPath);
  return true;
}

async function restoreEnvLocalAfterSelfHostedCommands(wasHidden: boolean) {
  if (!wasHidden) {
    return;
  }
  await rename(envLocalBackupPath, envLocalPath);
}

export default async function setupZitadelInterop(project: {
  provide: (key: string, value: string) => void;
}) {
  if (!shouldPrepareInteropInfra()) {
    return;
  }

  const waitTimeoutMs = envNumber(
    "ZITADEL_WAIT_TIMEOUT_MS",
    DEFAULT_WAIT_TIMEOUT_MS,
  );
  const convexTimeoutMs = envNumber(
    "ZITADEL_CONVEX_RUN_TIMEOUT_MS",
    DEFAULT_CONVEX_TIMEOUT_MS,
  );

  await run("docker", ["compose", "-f", composePath, "up", "-d"]);
  await waitForHealthy("postgres", waitTimeoutMs);
  await waitForHealthy("backend", waitTimeoutMs);
  await waitForHealthy("zitadel", waitTimeoutMs);

  const { stdout: keyOut, stderr: keyErr } = await run("docker", [
    "compose",
    "-f",
    composePath,
    "exec",
    "-T",
    "backend",
    "/convex/generate_admin_key.sh",
  ]);
  const adminKey = parseAdminKey(keyOut, keyErr);

  const convexEnv: NodeJS.ProcessEnv = { ...process.env };
  delete convexEnv.CONVEX_DEPLOYMENT;
  convexEnv.CONVEX_SELF_HOSTED_URL = requireEnv("TEST_TARGET_BASE_URL");
  convexEnv.CONVEX_SELF_HOSTED_ADMIN_KEY = adminKey;

  const envLocalWasHidden = await hideEnvLocalForSelfHostedCommands();
  try {
    await run("vp", ["run", "build:auth"], {
      env: convexEnv,
      timeoutMs: convexTimeoutMs,
    });

    await run(
      "env",
      ["-u", "CONVEX_DEPLOYMENT", "vp", "exec", "convex", "deploy", "--yes"],
      {
        env: convexEnv,
        timeoutMs: convexTimeoutMs,
      },
    );

    await setConvexEnv(convexEnv, "SITE_URL", process.env.SITE_URL);
    await setConvexEnv(convexEnv, "APP_URL", process.env.APP_URL);
    await setConvexEnv(convexEnv, "AUTH_EMAIL", process.env.AUTH_EMAIL);
    await setConvexEnv(
      convexEnv,
      "JWT_PRIVATE_KEY",
      process.env.JWT_PRIVATE_KEY,
    );
    await setConvexEnv(convexEnv, "JWKS", process.env.JWKS);
    await setConvexEnv(
      convexEnv,
      "GOOGLE_CLIENT_ID",
      process.env.GOOGLE_CLIENT_ID,
    );
    await setConvexEnv(
      convexEnv,
      "GOOGLE_CLIENT_SECRET",
      process.env.GOOGLE_CLIENT_SECRET,
    );
    await setConvexEnv(convexEnv, "RESEND_API_KEY", process.env.RESEND_API_KEY);
  } finally {
    await restoreEnvLocalAfterSelfHostedCommands(envLocalWasHidden);
  }

  const adminPat = await readFileFromZitadel(
    "/zitadel/bootstrap/admin.pat",
    waitTimeoutMs,
  );
  const loginClientPat = await readFileFromZitadel(
    "/zitadel/bootstrap/login-client.pat",
    waitTimeoutMs,
  );

  project.provide("zitadelAdminPat", adminPat);
  project.provide("zitadelLoginClientPat", loginClientPat);
}
