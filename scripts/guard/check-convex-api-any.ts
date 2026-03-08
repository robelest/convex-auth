import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

const repoRoot = process.cwd();
const generatedApiFiles = [
  join(repoRoot, "convex", "_generated", "api.d.ts"),
  join(
    repoRoot,
    "packages",
    "auth",
    "src",
    "component",
    "_generated",
    "api.d.ts",
  ),
].filter((filePath) => existsSync(filePath));

const offenders: Array<{ file: string; line: number; snippet: string }> = [];

for (const generatedApiFile of generatedApiFiles) {
  const sourceText = readFileSync(generatedApiFile, "utf8");
  const lines = sourceText.split(/\r?\n/);

  let inFunctionReference = false;
  let functionStartLine = 0;
  let functionLines: string[] = [];

  for (const [index, line] of lines.entries()) {
    const trimmed = line.trim();

    if (!inFunctionReference && trimmed.includes("FunctionReference<")) {
      inFunctionReference = true;
      functionStartLine = index + 1;
      functionLines = [line];

      if (trimmed.endsWith(">;")) {
        const collapsed = functionLines.join(" ").replace(/\s+/g, " ").trim();
        if (
          /FunctionReference<\s*"(?:query|mutation|action|httpAction)"\s*,\s*"(?:public|internal)"\s*,[\s\S]*,\s*any\s*>;$/.test(
            collapsed,
          )
        ) {
          offenders.push({
            file: relative(repoRoot, generatedApiFile),
            line: functionStartLine,
            snippet: collapsed,
          });
        }
        inFunctionReference = false;
        functionLines = [];
      }

      continue;
    }

    if (!inFunctionReference) {
      continue;
    }

    functionLines.push(line);

    if (!trimmed.endsWith(">;")) {
      continue;
    }

    const collapsed = functionLines.join(" ").replace(/\s+/g, " ").trim();
    if (
      /FunctionReference<\s*"(?:query|mutation|action|httpAction)"\s*,\s*"(?:public|internal)"\s*,[\s\S]*,\s*any\s*>;$/.test(
        collapsed,
      )
    ) {
      offenders.push({
        file: relative(repoRoot, generatedApiFile),
        line: functionStartLine,
        snippet: collapsed,
      });
    }

    inFunctionReference = false;
    functionLines = [];
  }
}

if (offenders.length > 0) {
  console.error(
    "Convex API any guard failed. Unexpected any return types detected:",
  );
  for (const offender of offenders) {
    console.error(`- ${offender.file}:${offender.line}`);
    console.error(`  ${offender.snippet}`);
  }
  process.exit(1);
}

console.log("Convex API any guard passed.");
