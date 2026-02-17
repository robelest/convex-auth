#!/usr/bin/env node

import { randomUUID } from "crypto";
import { execSync, execFile } from "child_process";
import { AUTH_VERSION } from "../server/version";
import { CDN_PORTAL_BASE } from "../server/constants";
import { getMimeType } from "./utils";

type DeployOptions = {
  component: string;
  prod: boolean;
  concurrency?: number;
  version?: string;
};

type PortalManifest = {
  version: string;
  files: Array<{
    path: string;
    sha256: string;
    size: number;
  }>;
};

let useProd = false;

function convexRunAsync(
  functionPath: string,
  args: Record<string, unknown> = {},
): Promise<string> {
  return new Promise((resolve, reject) => {
    const cmdArgs = [
      "convex",
      "run",
      functionPath,
      JSON.stringify(args),
      "--typecheck=disable",
      "--codegen=disable",
    ];
    if (useProd) cmdArgs.push("--prod");
    execFile("npx", cmdArgs, { encoding: "utf-8" }, (error, stdout, stderr) => {
      if (error) {
        console.error("Convex run failed:", stderr || stdout);
        reject(error);
        return;
      }
      resolve(stdout.trim());
    });
  });
}

function runHosting(
  componentName: string,
  action: string,
  extraArgs: Record<string, unknown> = {},
): Promise<string> {
  return convexRunAsync(`${componentName}:portalInternal`, {
    action,
    ...extraArgs,
  });
}

async function fetchManifest(version: string): Promise<PortalManifest> {
  const manifestUrl = `${CDN_PORTAL_BASE}/v/${version}/manifest.json`;
  const response = await fetch(manifestUrl, {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(
      `Failed to fetch portal manifest (${response.status}) from ${manifestUrl}`,
    );
  }

  const text = await response.text();
  let manifest: PortalManifest;
  try {
    manifest = JSON.parse(text) as PortalManifest;
  } catch {
    throw new Error(
      `Portal manifest response is not valid JSON at ${manifestUrl}`,
    );
  }

  if (!manifest || !Array.isArray(manifest.files)) {
    throw new Error(`Invalid portal manifest format at ${manifestUrl}`);
  }

  return manifest;
}

async function deployWithConcurrency(
  files: PortalManifest["files"],
  componentName: string,
  deploymentId: string,
  version: string,
  concurrency: number,
): Promise<void> {
  const total = files.length;
  let completed = 0;
  let failed = false;

  const pending = new Set<Promise<void>>();
  const iterator = files[Symbol.iterator]();

  function enqueue(): Promise<void> | undefined {
    if (failed) return;
    const next = iterator.next();
    if (next.done) return;
    const file = next.value;

    const task = runHosting(componentName, "recordAssetFromCdn", {
      version,
      path: `/${file.path.replace(/^\/+/, "")}`,
      sha256: file.sha256,
      contentType: getMimeType(file.path),
      deploymentId,
    }).then(() => {
      completed++;
      console.log(`  [${completed}/${total}] /${file.path}`);
      pending.delete(task);
    });

    task.catch(() => {
      failed = true;
    });

    pending.add(task);
    return task;
  }

  for (let i = 0; i < concurrency && i < total; i++) {
    void enqueue();
  }

  while (pending.size > 0) {
    await Promise.race(pending);
    if (failed) {
      await Promise.allSettled(pending);
      throw new Error("Portal deployment failed");
    }
    void enqueue();
  }
}

function getConvexSiteUrl(prod: boolean): string | null {
  try {
    const args = ["convex", "env", "get", "CONVEX_CLOUD_URL"];
    if (prod) args.push("--prod");
    const result = execSync(`npx ${args.join(" ")}`, {
      stdio: "pipe",
      encoding: "utf-8",
    });
    const cloudUrl = result.trim();
    if (cloudUrl && cloudUrl.includes(".convex.cloud")) {
      return cloudUrl.replace(".convex.cloud", ".convex.site");
    }
  } catch {
    // Ignore errors
  }
  return null;
}

export async function portalDeployMain(opts: DeployOptions): Promise<void> {
  const version = opts.version ?? AUTH_VERSION;
  if (
    opts.concurrency !== undefined &&
    (!Number.isInteger(opts.concurrency) || opts.concurrency < 1)
  ) {
    console.error("--concurrency must be a positive integer");
    process.exit(1);
  }

  useProd = opts.prod;

  const envLabel = useProd ? "production" : "development";
  console.log(`Deploying portal v${version} to ${envLabel} environment`);
  console.log(`Component: ${opts.component}`);
  console.log(`CDN source: ${CDN_PORTAL_BASE}/v/${version}/auth/`);
  console.log("");

  let manifest: PortalManifest;
  try {
    manifest = await fetchManifest(version);
  } catch (error) {
    console.error(`Failed to load portal manifest: ${(error as Error).message}`);
    process.exit(1);
  }

  const deploymentId = randomUUID();
  const concurrency = opts.concurrency ?? Math.min(32, manifest.files.length);
  console.log(
    `Importing ${manifest.files.length} file(s) with deployment ID: ${deploymentId}`,
  );
  console.log(`Concurrency: ${concurrency}`);
  console.log("");

  try {
    await deployWithConcurrency(
      manifest.files,
      opts.component,
      deploymentId,
      version,
      concurrency,
    );
  } catch (error) {
    console.error((error as Error).message);
    process.exit(1);
  }

  console.log("");

  const gcOutput = await runHosting(opts.component, "gcOldAssets", {
    currentDeploymentId: deploymentId,
  });
  const gcResult = JSON.parse(gcOutput);
  const deletedCount =
    typeof gcResult === "number" ? gcResult : gcResult.deleted;

  if (deletedCount > 0) {
    console.log(
      `Cleaned up ${deletedCount} old storage file(s) from previous deployments`,
    );
  }

  console.log("");
  console.log("Portal deploy complete!");

  const deployedSiteUrl = getConvexSiteUrl(useProd);
  if (deployedSiteUrl) {
    console.log("");
    console.log(`Portal available at: ${deployedSiteUrl}/auth`);
  }
}
