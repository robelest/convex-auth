#!/usr/bin/env node
/**
 * CLI tool to upload portal static files to Convex storage.
 *
 * Forked from @convex-dev/self-hosting upload, adapted to use the
 * consolidated `portalInternal` internal mutation with action discriminator.
 *
 * Usage:
 *   npx @robelest/convex-auth portal upload [options]
 *
 * Options:
 *   --dist <path>            Path to dist directory (default: ./dist)
 *   --component <name>       Convex module with portal functions (default: auth)
 *   --prod                   Deploy to production deployment
 *   --help                   Show help
 */

import { readFileSync, readdirSync, existsSync } from "fs";
import { join, relative, extname, resolve } from "path";
import { randomUUID } from "crypto";
import { execSync, execFile, spawnSync } from "child_process";

// MIME type mapping
const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json",
  ".webmanifest": "application/manifest+json",
  ".xml": "application/xml",
};

function getMimeType(path: string): string {
  return MIME_TYPES[extname(path).toLowerCase()] || "application/octet-stream";
}

interface ParsedArgs {
  dist: string;
  component: string;
  prod: boolean;
  build: boolean;
  concurrency: number;
  help: boolean;
}

export function parsePortalUploadArgs(args: string[]): ParsedArgs {
  const result: ParsedArgs = {
    dist: "./dist",
    component: "auth",
    prod: false,
    build: false,
    concurrency: 5,
    help: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--help" || arg === "-h") {
      result.help = true;
    } else if (arg === "--dist" || arg === "-d") {
      result.dist = args[++i] || result.dist;
    } else if (arg === "--component" || arg === "-c") {
      result.component = args[++i] || result.component;
    } else if (arg === "--prod") {
      result.prod = true;
    } else if (arg === "--no-prod" || arg === "--dev") {
      result.prod = false;
    } else if (arg === "--build" || arg === "-b") {
      result.build = true;
    } else if (arg === "--concurrency" || arg === "-j") {
      const val = parseInt(args[++i], 10);
      if (val > 0) result.concurrency = val;
    }
  }

  return result;
}

function showHelp(): void {
  console.log(`
Usage: npx @robelest/convex-auth portal upload [options]

Upload portal static files to Convex storage.

Options:
  -d, --dist <path>           Path to dist directory (default: ./dist)
   -c, --component <name>      Convex module with portal functions (default: auth)
      --prod                  Deploy to production deployment
  -b, --build                 Run 'npm run build' before uploading
  -j, --concurrency <n>       Number of parallel uploads (default: 5)
  -h, --help                  Show this help message

Examples:
  npx @robelest/convex-auth portal upload
  npx @robelest/convex-auth portal upload --dist packages/portal/build --prod
  npx @robelest/convex-auth portal upload --build --prod
`);
}

// Global flag for production mode
let useProd = true;

/**
 * Run a Convex function via the CLI. Uses the consolidated `portalInternal`
 * internal mutation with an `action` discriminator.
 */
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

/**
 * Run the portalInternal function with a specific action.
 */
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

async function uploadSingleFile(
  file: { path: string; localPath: string; contentType: string },
  componentName: string,
  deploymentId: string,
): Promise<{ path: string }> {
  const content = readFileSync(file.localPath);

  // Generate upload URL
  const uploadUrlOutput = await runHosting(componentName, "generateUploadUrl");
  const uploadUrl = JSON.parse(uploadUrlOutput);

  // Upload to Convex storage
  const response = await fetch(uploadUrl, {
    method: "POST",
    headers: { "Content-Type": file.contentType },
    body: content,
  });

  const { storageId } = (await response.json()) as { storageId: string };

  // Record the asset
  await runHosting(componentName, "recordAsset", {
    path: file.path,
    storageId,
    contentType: file.contentType,
    deploymentId,
  });

  return { path: file.path };
}

async function uploadWithConcurrency(
  files: Array<{ path: string; localPath: string; contentType: string }>,
  componentName: string,
  deploymentId: string,
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

    const task = uploadSingleFile(file, componentName, deploymentId).then(
      ({ path }) => {
        completed++;
        console.log(`  [${completed}/${total}] ${path}`);
        pending.delete(task);
      },
    );

    task.catch(() => {
      failed = true;
    });

    pending.add(task);
    return task;
  }

  // Fill initial pool
  for (let i = 0; i < concurrency && i < total; i++) {
    void enqueue();
  }

  // Process remaining files as slots open
  while (pending.size > 0) {
    await Promise.race(pending);
    if (failed) {
      await Promise.allSettled(pending);
      throw new Error("Upload failed");
    }
    void enqueue();
  }
}

function collectFiles(
  dir: string,
  baseDir: string,
): Array<{ path: string; localPath: string; contentType: string }> {
  const files: Array<{
    path: string;
    localPath: string;
    contentType: string;
  }> = [];

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectFiles(fullPath, baseDir));
    } else if (entry.isFile()) {
      files.push({
        path: "/" + relative(baseDir, fullPath).replace(/\\/g, "/"),
        localPath: fullPath,
        contentType: getMimeType(fullPath),
      });
    }
  }
  return files;
}

/**
 * Get the Convex site URL (.convex.site) from the cloud URL
 */
function getConvexSiteUrl(prod: boolean): string | null {
  try {
    const envFlag = prod ? "--prod" : "";
    const result = execSync(`npx convex env get CONVEX_CLOUD_URL ${envFlag}`, {
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

export async function portalUploadMain(rawArgs: string[]): Promise<void> {
  const args = parsePortalUploadArgs(rawArgs);

  if (args.help) {
    showHelp();
    process.exit(0);
  }

  // Set global prod flag
  useProd = args.prod;

  // Run build if requested
  if (args.build) {
    let convexUrl: string | null = null;

    if (useProd) {
      try {
        const result = execSync("npx convex dashboard --prod --no-open", {
          stdio: "pipe",
          encoding: "utf-8",
        });
        const match = result.match(/dashboard\.convex\.dev\/d\/([a-z0-9-]+)/i);
        if (match) {
          convexUrl = `https://${match[1]}.convex.cloud`;
        }
      } catch {
        console.error("Could not get production Convex URL.");
        console.error(
          "Make sure you have deployed to production: npx convex deploy",
        );
        process.exit(1);
      }
    } else {
      if (existsSync(".env.local")) {
        const envContent = readFileSync(".env.local", "utf-8");
        const match = envContent.match(/(?:VITE_)?CONVEX_URL=(.+)/);
        if (match) {
          convexUrl = match[1].trim();
        }
      }
    }

    if (!convexUrl) {
      console.error("Could not determine Convex URL for build.");
      process.exit(1);
    }

    const envLabel = useProd ? "production" : "development";
    console.log(`Building for ${envLabel}...`);
    console.log(`   VITE_CONVEX_URL=${convexUrl}`);
    console.log("");

    const buildResult = spawnSync("npm", ["run", "build"], {
      stdio: "inherit",
      env: { ...process.env, VITE_CONVEX_URL: convexUrl },
    });

    if (buildResult.status !== 0) {
      console.error("Build failed.");
      process.exit(1);
    }

    console.log("");
  }

  const distDir = resolve(args.dist);
  const componentName = args.component;

  if (!existsSync(distDir)) {
    console.error(`Error: dist directory not found: ${distDir}`);
    console.error(
      "Run your build command first (e.g., 'bun run build:portal' or add --build flag)",
    );
    process.exit(1);
  }

  const deploymentId = randomUUID();
  const files = collectFiles(distDir, distDir);

  const envLabel = useProd ? "production" : "development";
  console.log(`Deploying portal to ${envLabel} environment`);
  console.log(
    `Uploading ${files.length} files with deployment ID: ${deploymentId}`,
  );
  console.log(`Component: ${componentName}`);
  console.log("");

  try {
    await uploadWithConcurrency(
      files,
      componentName,
      deploymentId,
      args.concurrency,
    );
  } catch {
    console.error("Upload failed.");
    process.exit(1);
  }

  console.log("");

  // Garbage collect old files
  const gcOutput = await runHosting(componentName, "gcOldAssets", {
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
  console.log("Upload complete!");

  // Show the deployment URL
  const deployedSiteUrl = getConvexSiteUrl(useProd);
  if (deployedSiteUrl) {
    console.log("");
    console.log(`Portal available at: ${deployedSiteUrl}/auth`);
  }
}
