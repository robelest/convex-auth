#!/usr/bin/env node
/**
 * CLI tool to generate a portal admin invite link.
 *
 * Generates a random invite token, hashes it (SHA-256), stores the hash
 * in the database via `createPortalInvite`, and prints a URL the admin
 * can visit to accept the invite.
 *
 * Usage:
 *   npx @robelest/convex-auth portal link [options]
 *
 * Options:
 *   --prod                   Use production deployment
 *   --component <name>       Convex component with portal functions (default: auth)
 *   --self-hosted            Generate a self-hosted URL ({site}/auth)
 */

import { randomBytes, createHash } from "crypto";
import { execFile } from "child_process";
import { buildCdnPortalUrl } from "../server/constants";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let useProd = false;

/**
 * Run a Convex internal function via the CLI.
 * Follows the same pattern as upload.ts.
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

function convexEnvGetAsync(name: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const cmdArgs = ["convex", "env", "get", name];
    if (useProd) cmdArgs.push("--prod");
    execFile("npx", cmdArgs, { encoding: "utf-8" }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr || stdout || `Failed to read ${name}`));
        return;
      }
      resolve(stdout.trim());
    });
  });
}

/**
 * Generate a URL-safe random token (32 bytes → 43 chars base64url).
 */
function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * SHA-256 hash a token and return the hex digest.
 */
function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export async function portalLinkMain(opts: {
  prod: boolean;
  component: string;
  selfHosted: boolean;
}): Promise<void> {
  useProd = opts.prod;
  const component = opts.component;

  // 1. Generate a random token and its hash
  const token = generateToken();
  const tokenHash = hashToken(token);

  console.log("Creating portal admin invite...");

  // 2. Store the invite and get portal URL candidates back
  let portalUrl: string | null = null;
  let cdnPortalUrl: string | null = null;
  try {
    const raw = await convexRunAsync(`${component}:portalInternal`, {
      action: "createPortalInvite",
      tokenHash,
    });
    const result = JSON.parse(raw) as {
      portalUrl?: string;
      cdnPortalUrl?: string | null;
    };
    portalUrl = result.portalUrl ?? null;
    cdnPortalUrl = result.cdnPortalUrl ?? null;
  } catch {
    console.error(
      "\nFailed to create invite. Make sure your Convex deployment is running",
      "and the portal module is configured in your convex/ directory.",
    );
    process.exit(1);
  }

  if (!cdnPortalUrl && !opts.selfHosted) {
    try {
      const cloudUrl = await convexEnvGetAsync("CONVEX_CLOUD_URL");
      cdnPortalUrl = buildCdnPortalUrl(cloudUrl);
    } catch {
      // ignore and fall through to error handling below
    }
  }

  const baseUrl = opts.selfHosted ? portalUrl : cdnPortalUrl;
  if (!baseUrl) {
    const mode = opts.selfHosted ? "self-hosted" : "CDN";
    console.error(`\nFailed to determine ${mode} portal URL for this deployment.`);
    if (!opts.selfHosted) {
      console.error(
        "Try: npx @robelest/convex-auth portal link --self-hosted",
      );
    }
    process.exit(1);
  }

  // 3. Print the invite link
  const inviteUrl = `${baseUrl}?invite=${token}`;

  console.log("\nPortal admin invite created!\n");
  console.log(`  ${inviteUrl}\n`);
  console.log("This invite is single-use. Share it securely.");
  if (useProd) {
    console.log("(Using production deployment)");
  }
}
