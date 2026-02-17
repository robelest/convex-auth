import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const forbiddenModules = [
  "assert",
  "buffer",
  "child_process",
  "crypto",
  "dgram",
  "events",
  "fs",
  "http",
  "https",
  "net",
  "os",
  "path",
  "perf_hooks",
  "stream",
  "tls",
  "url",
  "util",
  "vm",
  "worker_threads",
  "zlib",
];

const sourceExtensions = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
]);

function isForbidden(specifier) {
  if (!specifier) return false;

  const normalized = specifier.startsWith("node:")
    ? specifier.slice("node:".length)
    : specifier;

  return forbiddenModules.some(
    (name) => normalized === name || normalized.startsWith(name + "/"),
  );
}

function collectFiles(dir, files = []) {
  if (!statSync(dir).isDirectory()) return files;

  for (const entry of readdirSync(dir)) {
    const fullPath = path.join(dir, entry);
    const stats = statSync(fullPath);
    if (stats.isDirectory()) {
      collectFiles(fullPath, files);
      continue;
    }
    if (sourceExtensions.has(path.extname(fullPath))) {
      files.push(fullPath);
    }
  }

  return files;
}

function findViolationsInFile(filePath) {
  const content = readFileSync(filePath, "utf8");
  const lines = content.split(/\r?\n/);
  const violations = [];

  const importRegex =
    /\bimport\s+(?:type\s+)?(?:[^'";]+\s+from\s+)?['"]([^'"]+)['"]/g;
  const requireRegex = /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    for (const regex of [importRegex, requireRegex]) {
      regex.lastIndex = 0;
      let match = regex.exec(line);
      while (match) {
        const specifier = match[1];
        if (isForbidden(specifier)) {
          violations.push({
            filePath,
            line: i + 1,
            specifier,
            source: line.trim(),
          });
        }
        match = regex.exec(line);
      }
    }
  }

  return violations;
}

function main() {
  const packageRoot = process.cwd();
  const runtimeRoot = path.join(packageRoot, "src");

  try {
    if (!statSync(runtimeRoot).isDirectory()) {
      console.log("No runtime src directory found. Guardrail skipped.");
      process.exit(0);
    }
  } catch {
    console.log("No runtime src directory found. Guardrail skipped.");
    process.exit(0);
  }

  const files = collectFiles(runtimeRoot);
  if (files.length === 0) {
    console.log("No source files found under src/. Guardrail skipped.");
    process.exit(0);
  }

  const violations = files.flatMap((filePath) =>
    findViolationsInFile(filePath),
  );
  if (violations.length === 0) {
    console.log(`Runtime import guard passed (${files.length} files scanned).`);
    process.exit(0);
  }

  console.error(
    "Forbidden Node builtin imports found in runtime source files:",
  );
  for (const violation of violations) {
    console.error(
      `- ${path.relative(packageRoot, violation.filePath)}:${violation.line} imports '${violation.specifier}'`,
    );
    console.error(`  ${violation.source}`);
  }

  console.error(
    "\\nMove these imports behind non-runtime adapters or replace with edge-safe alternatives.",
  );
  process.exit(1);
}

main();
