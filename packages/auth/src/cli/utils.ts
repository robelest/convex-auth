/**
 * Shared CLI utilities — logging, subprocess execution, file helpers.
 *
 * Eliminates duplication across index.ts, portal-upload.ts, portal-link.ts.
 * All output goes to stderr so stdout can be piped cleanly.
 */

import chalk from "chalk";
import { execFileSync } from "child_process";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { extname } from "path";

// ---------------------------------------------------------------------------
// Logging — unified output to stderr with chalk prefixes
// ---------------------------------------------------------------------------

const write = (msg: string) => process.stderr.write(msg + "\n");

export const log = {
  step:    (n: number, msg: string) => write(`${chalk.blue.bold(`[${n}]`)} ${chalk.bold(msg)}`),
  success: (msg: string) => write(`${chalk.green("✔")} ${msg}`),
  warn:    (msg: string) => write(`${chalk.yellow.bold("!")} ${msg}`),
  error:   (msg: string, detail?: string) =>
    write(`${chalk.red("✖")} ${msg}${detail ? `\n  ${chalk.grey(`Error: ${detail}`)}` : ""}`),
  info:    (msg: string) => write(`${chalk.blue.bold("i")} ${msg}`),
  blank:   () => write(""),
  raw:     (msg: string) => write(msg),
  indent:  (msg: string) => write(`  ${msg}`),
} as const;

// ---------------------------------------------------------------------------
// Subprocess — safe execFile with argument arrays (no shell injection)
// ---------------------------------------------------------------------------

export type DeploymentOptions = {
  prod?: boolean;
  adminKey?: string;
  url?: string;
  previewName?: string;
  deploymentName?: string;
};

/** Build CLI args array for Convex deployment selection. */
export const deploymentArgs = (opts: DeploymentOptions): string[] => {
  const args: string[] = [];
  if (opts.adminKey)       args.push("--admin-key", opts.adminKey);
  if (opts.url)            args.push("--url", opts.url);
  else if (opts.prod)      args.push("--prod");
  else if (opts.previewName)     args.push("--preview-name", opts.previewName);
  else if (opts.deploymentName)  args.push("--deployment-name", opts.deploymentName);
  return args;
};

/** Run `npx convex env get <name>` and return the value. */
export const envGet = (name: string, opts: DeploymentOptions): string =>
  execFileSync("npx", ["convex", "env", "get", ...deploymentArgs(opts), name], {
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
  }).slice(0, -1); // strip trailing newline

/** Run `npx convex env set <name> <value>`. */
export const envSet = (
  name: string,
  value: string,
  opts: DeploymentOptions & { hideValue?: boolean },
): void => {
  execFileSync(
    "npx",
    ["convex", "env", "set", ...deploymentArgs(opts), "--", name, value],
    { stdio: opts.hideValue ? "ignore" : "inherit" },
  );
};

/**
 * Run a Convex function via `npx convex run` and return parsed JSON output.
 * Uses execFile with argument arrays — no shell injection.
 */
export const convexRun = <T = unknown>(
  functionPath: string,
  args: Record<string, unknown>,
  opts: { prod?: boolean } = {},
): Promise<T> =>
  new Promise((resolve, reject) => {
    const { execFile } = require("child_process");
    const cmdArgs = [
      "convex", "run", functionPath,
      JSON.stringify(args),
      "--typecheck=disable",
      "--codegen=disable",
      ...(opts.prod ? ["--prod"] : []),
    ];
    execFile("npx", cmdArgs, { encoding: "utf-8" }, (error: any, stdout: string, stderr: string) => {
      if (error) {
        reject(new Error(`convex run ${functionPath} failed: ${stderr || stdout}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout.trim()) as T);
      } catch {
        // If output is not JSON, return raw string as-is
        resolve(stdout.trim() as T);
      }
    });
  });

// ---------------------------------------------------------------------------
// MIME types
// ---------------------------------------------------------------------------

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js":   "application/javascript; charset=utf-8",
  ".mjs":  "application/javascript; charset=utf-8",
  ".css":  "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png":  "image/png",
  ".jpg":  "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif":  "image/gif",
  ".svg":  "image/svg+xml",
  ".ico":  "image/x-icon",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2":"font/woff2",
  ".ttf":  "font/ttf",
  ".txt":  "text/plain; charset=utf-8",
  ".map":  "application/json",
  ".webmanifest": "application/manifest+json",
  ".xml":  "application/xml",
  ".br":   "application/octet-stream",
  ".gz":   "application/gzip",
};

export const getMimeType = (path: string): string =>
  MIME_TYPES[extname(path).toLowerCase()] ?? "application/octet-stream";

// ---------------------------------------------------------------------------
// File helpers
// ---------------------------------------------------------------------------

/**
 * Check for an existing non-empty source file (.ts or .js) at the given
 * base path (without extension). Returns the path if found, null otherwise.
 */
export const findExistingSource = (basePath: string): string | null =>
  [".ts", ".js"]
    .map((ext) => basePath + ext)
    .find((p) => existsSync(p) && readFileSync(p, "utf-8").trim() !== "")
    ?? null;

/**
 * Test whether an existing file already matches a template.
 * Templates use `$$` as wildcards and `;` followed by newline as flexible separators.
 */
export const matchesTemplate = (existing: string, template: string): boolean =>
  new RegExp(
    template
      .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      .replace(/\\\$\\\$/g, ".*")
      .replace(/;\n/g, ";.*"),
    "s",
  ).test(existing);

/** Strip template markers from a source template. */
export const stripMarkers = (template: string): string =>
  template.replace(/\$\$/g, "");

/**
 * Higher-order function: ensure a file matches a template.
 *
 * - If the file doesn't exist → create it
 * - If it already matches → log success
 * - If it exists but doesn't match → show instructions and prompt
 *
 * Returns a configured function bound to the convex folder path + TS preference.
 */
export const createFileEnsurer = (
  convexFolderPath: string,
  usesTypeScript: boolean,
  promptFn: (message: string) => Promise<void>,
) => {
  const path = require("path");

  return async (
    baseName: string,
    template: string,
    description: string,
  ): Promise<void> => {
    const source = stripMarkers(template);
    const filePath = path.join(convexFolderPath, baseName);
    const existing = findExistingSource(filePath);

    if (existing) {
      const content = readFileSync(existing, "utf-8");
      if (matchesTemplate(content, template)) {
        log.success(`${chalk.bold(existing)} already configured.`);
        return;
      }
      log.info(`${chalk.bold(existing)} needs ${description}:`);
      log.raw(`\n${indentBlock(source)}\n`);
      await promptFn("Ready to continue?");
      return;
    }

    const ext = usesTypeScript ? ".ts" : ".js";
    const newPath = filePath + ext;
    writeFileSync(newPath, source);
    log.success(`Created ${chalk.bold(newPath)}`);
  };
};

/** Indent a multiline string (2 spaces, first line not indented). */
export const indentBlock = (s: string): string =>
  s.replace(/^/gm, "  ").slice(2);

// ---------------------------------------------------------------------------
// Crypto helpers (for portal invite links)
// ---------------------------------------------------------------------------

export { randomBytes, createHash } from "crypto";

/** Generate a URL-safe random token (32 bytes → 43 chars base64url). */
export const generateToken = (): string =>
  require("crypto").randomBytes(32).toString("base64url");

/** SHA-256 hash a string and return the hex digest. */
export const hashToken = (token: string): string =>
  require("crypto").createHash("sha256").update(token).digest("hex");

// ---------------------------------------------------------------------------
// Package version
// ---------------------------------------------------------------------------

/** Read the auth package version from its own package.json. */
export const getPackageVersion = (): string => {
  try {
    const pkgPath = require("path").resolve(__dirname, "..", "package.json");
    return JSON.parse(readFileSync(pkgPath, "utf-8")).version;
  } catch {
    // Fallback: if running from dist/bin.cjs, package.json is two levels up
    try {
      const pkgPath = require("path").resolve(__dirname, "..", "..", "package.json");
      return JSON.parse(readFileSync(pkgPath, "utf-8")).version;
    } catch {
      return "unknown";
    }
  }
};
