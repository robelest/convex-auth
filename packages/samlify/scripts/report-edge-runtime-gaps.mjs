import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const sourceExtensions = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
]);

const trackedSpecifiers = new Map([
  ["node-rsa", "Replace with Oslo/WebCrypto wrapper"],
  ["xml-crypto", "Replace with internal xmldsig implementation"],
  ["@authenio/xml-encryption", "Replace with internal xmlenc implementation"],
  ["node-forge", "Replace with Oslo ASN.1 + WebCrypto key handling"],
  ["xml", "Replace with deterministic internal XML builders"],
  ["pako", "Replace with edge-safe deflate/inflate strategy"],
  ["xpath", "Validate edge compatibility and harden selector usage"],
]);

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

function findFileHits(filePath) {
  const content = readFileSync(filePath, "utf8");
  const lines = content.split(/\r?\n/);
  const hits = [];

  const importRegex =
    /\bimport\s+(?:type\s+)?(?:[^'";]+\s+from\s+)?['"]([^'"]+)['"]/g;
  const requireRegex = /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g;
  const bufferRegex = /\bBuffer\b/g;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    for (const regex of [importRegex, requireRegex]) {
      regex.lastIndex = 0;
      let match = regex.exec(line);
      while (match) {
        const specifier = match[1];
        if (trackedSpecifiers.has(specifier)) {
          hits.push({
            type: "module",
            specifier,
            line: i + 1,
            source: line.trim(),
          });
        }
        match = regex.exec(line);
      }
    }

    bufferRegex.lastIndex = 0;
    if (bufferRegex.test(line)) {
      hits.push({
        type: "buffer",
        specifier: "Buffer",
        line: i + 1,
        source: line.trim(),
      });
    }
  }

  return hits;
}

function main() {
  const packageRoot = process.cwd();
  const runtimeRoot = path.join(packageRoot, "src");

  try {
    if (!statSync(runtimeRoot).isDirectory()) {
      console.log("No src directory found.");
      process.exit(0);
    }
  } catch {
    console.log("No src directory found.");
    process.exit(0);
  }

  const files = collectFiles(runtimeRoot);
  const hits = [];

  for (const filePath of files) {
    const fileHits = findFileHits(filePath);
    for (const hit of fileHits) {
      hits.push({
        ...hit,
        filePath,
      });
    }
  }

  console.log("Edge Runtime Gap Report");
  console.log("=======================");

  if (hits.length === 0) {
    console.log("\nNo potential blockers found in src/.");
  } else {
    console.log(`\n[src] ${hits.length} potential blockers`);
    for (const hit of hits) {
      const relative = path.relative(packageRoot, hit.filePath);
      if (hit.type === "buffer") {
        console.log(`- ${relative}:${hit.line} uses Buffer`);
      } else {
        const replacement = trackedSpecifiers.get(hit.specifier);
        console.log(`- ${relative}:${hit.line} imports '${hit.specifier}'`);
        console.log(`  replacement: ${replacement}`);
      }
    }
  }

  const aggregate = new Map();
  for (const hit of hits) {
    const key = hit.specifier;
    aggregate.set(key, (aggregate.get(key) || 0) + 1);
  }

  console.log("\nAggregate");
  console.log("---------");
  for (const [specifier, count] of aggregate.entries()) {
    console.log(`- ${specifier}: ${count}`);
  }
}

main();
