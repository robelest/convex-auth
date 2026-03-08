import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const repoRoot = process.cwd();
const sourceRoots = [
  join(repoRoot, "convex"),
  join(repoRoot, "packages", "auth", "src", "component"),
];

const ignoredFileSuffixes = [".test.ts"];
const ignoredPathSegments = new Set(["_generated"]);

function walkTsFiles(directory: string): string[] {
  let files: string[] = [];
  for (const entry of readdirSync(directory)) {
    const absolutePath = join(directory, entry);
    const stats = statSync(absolutePath);
    if (stats.isDirectory()) {
      if (ignoredPathSegments.has(entry)) {
        continue;
      }
      files = files.concat(walkTsFiles(absolutePath));
      continue;
    }

    if (!entry.endsWith(".ts")) {
      continue;
    }

    if (ignoredFileSuffixes.some((suffix) => entry.endsWith(suffix))) {
      continue;
    }

    files.push(absolutePath);
  }

  return files;
}

function lineNumberFromIndex(sourceText: string, index: number): number {
  return sourceText.slice(0, index).split("\n").length;
}

const exportPattern =
  /export\s+const\s+([A-Za-z0-9_]+)\s*=\s*([\s\S]*?)(?:\.public\(\)|\.internal\(\))\s*;/g;

const violations: Array<{ path: string; line: number; exportName: string }> =
  [];

for (const sourceRoot of sourceRoots) {
  for (const filePath of walkTsFiles(sourceRoot)) {
    const sourceText = readFileSync(filePath, "utf8");

    for (const match of sourceText.matchAll(exportPattern)) {
      const [, exportName, chainText] = match;
      if (!chainText.includes(".handler(")) {
        continue;
      }

      const handlerIndex = chainText.indexOf(".handler(");
      const returnsIndex = chainText.indexOf(".returns(");
      const hasReturnsBeforeHandler =
        returnsIndex !== -1 && returnsIndex < handlerIndex;

      if (hasReturnsBeforeHandler) {
        continue;
      }

      violations.push({
        path: relative(repoRoot, filePath),
        line: lineNumberFromIndex(sourceText, match.index ?? 0),
        exportName,
      });
    }
  }
}

if (violations.length > 0) {
  console.error(
    "Convex returns guard failed. Missing `.returns(...)` on exported handlers:",
  );
  for (const violation of violations) {
    console.error(
      `- ${violation.path}:${violation.line} (${violation.exportName})`,
    );
  }
  process.exit(1);
}

console.log("Convex returns guard passed.");
