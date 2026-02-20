import { readFile, writeFile } from "node:fs/promises";
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

async function main() {
  let entryPath;
  try {
    entryPath = fileURLToPath(await import.meta.resolve("fluent-convex"));
  } catch {
    return;
  }

  const packageRoot = path.dirname(path.dirname(entryPath));
  const files = [
    "dist/index.js",
    "dist/builder.js",
    "dist/ConvexBuilder.js",
    "dist/ConvexBuilderWithFunctionKind.js",
    "dist/ConvexBuilderWithHandler.js",
    "dist/zod/index.js",
    "dist/zod/withZod.js",
  ];

  let patchedCount = 0;
  for (const relativeFile of files) {
    const filePath = path.join(packageRoot, relativeFile);
    try {
      const original = await readFile(filePath, "utf8");
      const patched = patchModuleSpecifiers(original);
      if (patched !== original) {
        await writeFile(filePath, patched, "utf8");
        patchedCount += 1;
      }
    } catch {
      // Ignore if upstream package layout changes.
    }
  }

  if (patchedCount > 0) {
    console.log(`Patched fluent-convex ESM imports in ${patchedCount} files.`);
  }
}

await main();
