import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

function withJsExtension(specifier) {
  if (
    specifier.endsWith(".js") ||
    specifier.endsWith(".mjs") ||
    specifier.endsWith(".cjs") ||
    specifier.endsWith(".json")
  ) {
    return specifier;
  }
  return `${specifier}.js`;
}

function patchModuleSpecifiers(content) {
  return content.replace(/(["'])(\.{1,2}\/[^"]+)(["'])/g, (full, q1, specifier, q2) => {
    if (q1 !== q2) {
      return full;
    }
    return `${q1}${withJsExtension(specifier)}${q2}`;
  });
}

async function collectJsFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectJsFiles(entryPath)));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".js")) {
      files.push(entryPath);
    }
  }
  return files;
}

async function getPackageRoots() {
  const roots = new Set();
  const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

  try {
    const entryPath = fileURLToPath(import.meta.resolve("fluent-convex"));
    roots.add(path.dirname(path.dirname(entryPath)));
  } catch {
    // Ignore if fluent-convex is not currently installed.
  }

  const pnpmStore = path.join(workspaceRoot, "node_modules", ".pnpm");
  try {
    const entries = await readdir(pnpmStore, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || !entry.name.startsWith("fluent-convex@")) {
        continue;
      }
      roots.add(path.join(pnpmStore, entry.name, "node_modules", "fluent-convex"));
    }
  } catch {
    // Ignore if the install layout changes.
  }

  return [...roots];
}

async function main() {
  const packageRoots = await getPackageRoots();
  if (packageRoots.length === 0) {
    return;
  }

  let patchedCount = 0;
  let patchedRoots = 0;
  for (const packageRoot of packageRoots) {
    try {
      const distDirectory = path.join(packageRoot, "dist");
      const files = await collectJsFiles(distDirectory);
      let rootPatched = false;
      for (const filePath of files) {
        const original = await readFile(filePath, "utf8");
        const patched = patchModuleSpecifiers(original);
        if (patched !== original) {
          await writeFile(filePath, patched, "utf8");
          patchedCount += 1;
          rootPatched = true;
        }
      }
      if (rootPatched) {
        patchedRoots += 1;
      }
    } catch {
      // Ignore if upstream package layout changes.
    }
  }

  if (patchedCount > 0) {
    console.log(
      `Patched fluent-convex ESM imports in ${patchedCount} files across ${patchedRoots} install(s).`,
    );
  }
}

await main();
