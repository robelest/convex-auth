import { execFile } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

async function run(command: string, args: string[]) {
  const child = execFile(command, args, {
    cwd: process.cwd(),
    env: process.env,
    maxBuffer: 20 * 1024 * 1024,
  });
  child.stdout?.pipe(process.stdout);
  child.stderr?.pipe(process.stderr);
  return await new Promise<void>((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(`${command} ${args.join(" ")} exited with code ${code}`),
      );
    });
  });
}

const buildReadyFile = path.join(
  process.cwd(),
  ".tmp",
  "full-test-build-ready",
);

try {
  await run("vp", ["run", "cache:build"]);
  await mkdir(path.dirname(buildReadyFile), { recursive: true });
  await writeFile(buildReadyFile, "ready\n");
  await run("vp", ["run", "cache:test"]);
  await run("vp", ["run", "cache:validate"]);
} catch (error) {
  if (error instanceof Error) {
    console.error(error.message);
  } else {
    console.error(error);
  }
  process.exitCode = 1;
} finally {
  await rm(buildReadyFile, { force: true });
}
