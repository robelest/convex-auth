import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

const workspaceRoot = path.resolve(import.meta.dirname, "..");

function runGit(args: string[], options: { capture?: boolean } = {}) {
  const output = execFileSync("git", args, {
    cwd: workspaceRoot,
    encoding: "utf8",
    stdio: options.capture === false ? "inherit" : "pipe",
  });
  return typeof output === "string" ? output.trim() : "";
}

function getAuthVersion() {
  const authPackageJson = JSON.parse(
    readFileSync(path.join(workspaceRoot, "packages/auth/package.json"), "utf8"),
  ) as { version: string };
  return authPackageJson.version;
}

function getPreferredRemote() {
  const remotes = runGit(["remote"]).split("\n").filter(Boolean);
  if (remotes.includes("fork")) return "fork";
  if (remotes.includes("origin")) return "origin";
  throw new Error("No git remote found. Expected at least `fork` or `origin`.");
}

function ensureCleanWorktree() {
  const status = runGit(["status", "--short"]);
  if (status !== "") {
    throw new Error("Working tree is not clean. Commit or stash changes before pushing a release.");
  }
}

function ensureTagExists(tag: string) {
  const existing = runGit(["tag", "--list", tag]);
  if (existing !== tag) {
    throw new Error(`Local tag ${tag} does not exist.`);
  }
}

function main() {
  const args = new Set(process.argv.slice(2));
  const remote = process.env.RELEASE_REMOTE || getPreferredRemote();
  const branch = runGit(["rev-parse", "--abbrev-ref", "HEAD"]);
  const version = getAuthVersion();
  const tag = `v${version}`;
  const force = args.has("--force");

  ensureCleanWorktree();
  ensureTagExists(tag);

  console.log(`Pushing branch ${branch} and tag ${tag} to ${remote}...`);

  if (force) {
    runGit(["push", "--force-with-lease", remote, branch], { capture: false });
    runGit(["push", "--force", remote, tag], { capture: false });
    return;
  }

  runGit(["push", remote, branch], { capture: false });
  runGit(["push", remote, tag], { capture: false });
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
