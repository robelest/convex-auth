import { execFileSync } from "child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
} from "fs";
import { tmpdir } from "os";
import path from "path";

import * as p from "@clack/prompts";
import { Command } from "@commander-js/extra-typings";
import { config as loadEnvFile } from "dotenv";
import * as v from "valibot";

import { actionDescription } from "./command";
import { generateKeys } from "./keys";

// ---------------------------------------------------------------------------
// Package version
// ---------------------------------------------------------------------------

function getPackageVersion(): string {
  // When bundled to dist/bin.cjs the package.json is one level up
  for (const relative of ["..", "../.."]) {
    try {
      const pkgPath = path.resolve(__dirname, relative, "package.json");
      return JSON.parse(readFileSync(pkgPath, "utf-8")).version;
    } catch {
      // try next
    }
  }
  return "unknown";
}

const version = getPackageVersion();

// ---------------------------------------------------------------------------
// Package-manager detection
// ---------------------------------------------------------------------------

type PackageRunner = { cmd: string; args: string[] };

function detectPackageRunner(): PackageRunner {
  // Walk up from cwd to find lockfiles or packageManager field
  let dir = process.cwd();
  const root = path.parse(dir).root;

  while (dir !== root) {
    const pkgPath = path.join(dir, "package.json");
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
        if (typeof pkg.packageManager === "string") {
          const name = pkg.packageManager.split("@")[0];
          if (name === "pnpm") return { cmd: "pnpm", args: ["exec"] };
          if (name === "bun") return { cmd: "bunx", args: [] };
          if (name === "yarn") return { cmd: "yarn", args: ["dlx"] };
        }
      } catch {
        // ignore parse errors
      }
    }

    if (existsSync(path.join(dir, "pnpm-lock.yaml")))
      return { cmd: "pnpm", args: ["exec"] };
    if (
      existsSync(path.join(dir, "bun.lockb")) ||
      existsSync(path.join(dir, "bun.lock"))
    )
      return { cmd: "bunx", args: [] };
    if (existsSync(path.join(dir, "yarn.lock")))
      return { cmd: "yarn", args: ["dlx"] };

    dir = path.dirname(dir);
  }

  return { cmd: "npx", args: [] };
}

const runner = detectPackageRunner();

/** Build the full command + args to invoke `convex` via the detected runner. */
function convexCmd(...subArgs: string[]): { file: string; args: string[] } {
  return { file: runner.cmd, args: [...runner.args, "convex", ...subArgs] };
}

// ---------------------------------------------------------------------------
// Commander program
// ---------------------------------------------------------------------------

export const program = new Command()
  .name("@robelest/convex-auth")
  .version(version)
  .description(
    "Add code and set environment variables for @robelest/convex-auth.\n\n" +
      "Full docs: https://deepwiki.com/robelest/convex-auth",
  );

// ---- Default setup command ----
program
  .option(
    "--site-url <url>",
    "Your frontend app URL (e.g. 'http://localhost:5173' for dev, 'https://myapp.com' for prod)",
  )
  .option(
    "--variables <json>",
    "Configure additional variables for interactive configuration.",
  )
  .option("--skip-git-check", "Don't warn when running outside a Git checkout.")
  .option("--allow-dirty-git-state", "Don't warn when Git state is not clean.")
  .addDeploymentSelectionOptions(
    actionDescription("Set environment variables on"),
  )
  .action(async (options) => {
    p.intro("@robelest/convex-auth");

    await checkSourceControl(options);

    const packageJson = readPackageJson();
    const convexJson = readConvexJson();
    const deployment = readConvexDeployment(options);
    const convexFolderPath = convexJson.functions ?? "convex";

    const isNextjs = !!packageJson.dependencies?.next;
    const usesTypeScript = !!(
      packageJson.dependencies?.typescript ||
      packageJson.devDependencies?.typescript
    );
    const isVite = !!(
      packageJson.dependencies?.vite || packageJson.devDependencies?.vite
    );
    const isExpo = !!(
      packageJson.dependencies?.expo || packageJson.devDependencies?.expo
    );
    const config: ProjectConfig = {
      isNextjs,
      isVite,
      isExpo,
      usesTypeScript,
      convexFolderPath,
      deployment,
      step: 1,
    };

    // Step 1: Configure SITE_URL
    await configureSiteUrl(config, options.siteUrl);

    // Step 2: Configure private and public key
    await configureKeys(config);

    // Step 3: Change moduleResolution to "bundler" and turn on skipLibCheck
    await modifyTsConfig(config);

    // Step 4: Configure convex.config.ts
    await configureConvexConfig(config);

    // Step 5: Initialize auth.ts
    await initializeAuth(config);

    // Step 6: Configure http.ts
    await configureHttp(config);

    // Extra: Configure providers interactively.
    if (options.variables !== undefined) {
      await configureOtherVariables(config, options.variables);
    } else {
      printFinalSuccessMessage(config);
    }

    p.outro("Done!");
  });

program
  .command("mount")
  .description("Mount optional Convex Auth app helpers")
  .command("enterprise")
  .description("Create nested enterprise RPC mount files under convex/auth/")
  .option("--only <kind>", "Limit to one namespace: 'sso' or 'scim'.")
  .option("--skip-git-check", "Don't warn when running outside a Git checkout.")
  .option("--allow-dirty-git-state", "Don't warn when Git state is not clean.")
  .action(async (options) => {
    p.intro("@robelest/convex-auth");

    await checkSourceControl(options);

    const packageJson = readPackageJson();
    const convexJson = readConvexJson();
    const usesTypeScript = !!(
      packageJson.dependencies?.typescript ||
      packageJson.devDependencies?.typescript
    );
    const convexFolderPath = convexJson.functions ?? "convex";
    const config: ProjectConfig = {
      isExpo: !!(
        packageJson.dependencies?.expo || packageJson.devDependencies?.expo
      ),
      isNextjs: !!packageJson.dependencies?.next,
      isVite: !!(
        packageJson.dependencies?.vite || packageJson.devDependencies?.vite
      ),
      usesTypeScript,
      convexFolderPath,
      deployment: { name: null, type: null, options: {} },
      step: 1,
    };

    await mountEnterprise(config, options.only);
    p.outro("Done!");
  });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ProjectConfig = {
  isExpo: boolean;
  isNextjs: boolean;
  isVite: boolean;
  usesTypeScript: boolean;
  convexFolderPath: string;
  deployment: {
    name: string | null;
    type: string | null;
    options: {
      url?: string;
      adminKey?: string;
      prod?: boolean;
      previewName?: string;
      deploymentName?: string;
    };
  };
  // Mutated along the way
  step: number;
};

// ---------------------------------------------------------------------------
// Step 1: SITE_URL
// ---------------------------------------------------------------------------

async function configureSiteUrl(config: ProjectConfig, forcedValue?: string) {
  logStep(config, "Configure SITE_URL");
  if (config.isExpo) {
    p.log.info("React Native projects don't require a SITE_URL.");
    return;
  }

  // Default to localhost for dev and also for local backend
  // this is not perfect but OK since it's just the default.
  const value =
    config.deployment.type === "dev" || config.deployment.type === null
      ? config.isVite
        ? "http://localhost:5173"
        : "http://localhost:3000"
      : undefined;
  const description =
    config.deployment.type === "dev"
      ? "the URL of your local web server (e.g. http://localhost:1234)"
      : "the URL where your site is hosted (e.g. https://example.com)";

  await configureEnvVar(config, {
    name: "SITE_URL",
    default: value,
    description,
    validate: (input) => {
      try {
        new URL(input);
        return true;
      } catch {
        return "The URL must start with http:// or https://";
      }
    },
    forcedValue,
  });
}

// ---------------------------------------------------------------------------
// Generic env var configuration
// ---------------------------------------------------------------------------

async function configureEnvVar(
  config: ProjectConfig,
  variable: {
    name: string;
    default?: string;
    description: string;
    validate?: (input: string) => true | string;
    forcedValue?: string;
  },
) {
  if (
    variable.forcedValue &&
    (variable.validate ? variable.validate(variable.forcedValue) : true)
  ) {
    await setEnvVar(config, variable.name, variable.forcedValue);
    return;
  }
  const existing = backendEnvVar(config, variable.name);
  if (existing !== "") {
    const shouldChange = await promptForConfirmation(
      `The ${printDeployment(config)} already has ${variable.name} configured to "${existing}". Do you want to change it?`,
      { default: false },
    );
    if (!shouldChange) {
      return;
    }
  }
  const chosenValue = await promptForInput(`Enter ${variable.description}`, {
    default: variable.default,
    validate: variable.validate,
  });
  await setEnvVar(config, variable.name, chosenValue);
}

// ---------------------------------------------------------------------------
// Step 2: Keys
// ---------------------------------------------------------------------------

async function configureKeys(config: ProjectConfig) {
  logStep(config, "Configure signing and encryption keys");
  const { JWT_PRIVATE_KEY, JWKS, AUTH_SECRET_ENCRYPTION_KEY } =
    await generateKeys();
  const existingPrivateKey = backendEnvVar(config, "JWT_PRIVATE_KEY");
  const existingJwks = backendEnvVar(config, "JWKS");
  const existingSecretEncryptionKey = backendEnvVar(
    config,
    "AUTH_SECRET_ENCRYPTION_KEY",
  );
  if (
    existingPrivateKey !== "" ||
    existingJwks !== "" ||
    existingSecretEncryptionKey !== ""
  ) {
    const shouldOverwrite = await promptForConfirmation(
      `The ${printDeployment(config)} already has JWT_PRIVATE_KEY, JWKS, or AUTH_SECRET_ENCRYPTION_KEY configured. Overwrite them?`,
      { default: false },
    );
    if (!shouldOverwrite) {
      return;
    }
  }
  // Use --from-file to avoid shell quoting issues with multiline values
  await setEnvVarFromFile(config, "JWT_PRIVATE_KEY", JWT_PRIVATE_KEY);
  await setEnvVarFromFile(config, "JWKS", JWKS);
  await setEnvVar(
    config,
    "AUTH_SECRET_ENCRYPTION_KEY",
    AUTH_SECRET_ENCRYPTION_KEY,
    {
      hideValue: true,
    },
  );
}

// ---------------------------------------------------------------------------
// Convex env helpers (no shell injection — argument arrays only)
// ---------------------------------------------------------------------------

function backendEnvVar(config: ProjectConfig, name: string): string {
  const { file, args } = convexCmd(
    "env",
    "get",
    ...deploymentArgs(config),
    name,
  );
  return execFileSync(file, args, {
    stdio: "pipe",
    encoding: "utf-8",
  }).slice(0, -1);
}

async function setEnvVar(
  config: ProjectConfig,
  name: string,
  value: string,
  options?: { hideValue: boolean },
) {
  const { file, args } = convexCmd(
    "env",
    "set",
    ...deploymentArgs(config),
    "--",
    name,
    value,
  );
  execFileSync(file, args, {
    stdio: options?.hideValue ? "ignore" : "inherit",
  });
  if (options?.hideValue) {
    p.log.success(`Successfully set ${name} (on ${printDeployment(config)})`);
  }
}

/**
 * Write value to a temp file and use `convex env set KEY --from-file tmpfile`.
 * This avoids shell-quoting issues with multiline values like private keys.
 */
async function setEnvVarFromFile(
  config: ProjectConfig,
  name: string,
  value: string,
) {
  const tmpDir = mkdtempSync(path.join(tmpdir(), "convex-auth-"));
  const tmpFile = path.join(tmpDir, `${name}.tmp`);
  try {
    writeFileSync(tmpFile, value, "utf-8");
    const { file, args } = convexCmd(
      "env",
      "set",
      ...deploymentArgs(config),
      name,
      "--from-file",
      tmpFile,
    );
    execFileSync(file, args, { stdio: "ignore" });
    p.log.success(`Successfully set ${name} (on ${printDeployment(config)})`);
  } finally {
    try {
      unlinkSync(tmpFile);
    } catch {
      // cleanup is best-effort
    }
  }
}

function deploymentArgs(config: ProjectConfig): string[] {
  const {
    deployment: {
      options: { adminKey, url, prod, previewName, deploymentName },
    },
  } = config;
  const args: string[] = [];

  if (adminKey !== undefined) {
    args.push("--admin-key", adminKey);
  }

  const selectionArgs =
    [
      url ? ["--url", url] : null,
      prod ? ["--prod"] : null,
      previewName ? ["--preview-name", previewName] : null,
      deploymentName ? ["--deployment-name", deploymentName] : null,
    ].find((s): s is string[] => s !== null) ?? [];

  args.push(...selectionArgs);
  return args;
}

function printDeployment(config: ProjectConfig): string {
  const { name, type } = config.deployment;
  return (
    (type !== null ? `${type} ` : "") +
    "deployment" +
    (name !== null ? ` ${name}` : "")
  );
}

// ---------------------------------------------------------------------------
// Step 3: tsconfig
// ---------------------------------------------------------------------------

// Match `"compilerOptions": {"`
// ignore comments after the bracket
// and capture the space between the bracket/last comment
// and the quote.
const compilerOptionsPattern =
  /("compilerOptions"\s*:\s*\{(?:\s*(?:\/\*(?:[^*]|\*(?!\/))*\*\/))*(\s*))(?=")/;

const validTsConfig = `\
{
  /* This TypeScript project config describes the environment that
   * Convex functions run in and is used to typecheck them.
   * You can modify it, but some settings required to use Convex.
   */
  "compilerOptions": {
    /* These settings are not required by Convex and can be modified. */
    "allowJs": true,
    "strict": true,
    "skipLibCheck": true,
    "jsx": "react",

    /* These compiler options are required by Convex */
    "target": "ESNext",
    "lib": ["ES2021", "dom", "ES2023.Array"],
    "forceConsistentCasingInFileNames": true,
    "allowSyntheticDefaultImports": true,
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "isolatedModules": true,
    "noEmit": true
  },
  "include": ["./**/*"],
  "exclude": ["./_generated"]
}
`;

async function modifyTsConfig(config: ProjectConfig) {
  logStep(config, "Modify tsconfig file");
  const projectLevelTsConfigPath = "tsconfig.json";
  const tsConfigPath = path.join(config.convexFolderPath, "tsconfig.json");
  if (!existsSync(tsConfigPath)) {
    if (existsSync(projectLevelTsConfigPath)) {
      if (config.isExpo) {
        writeFileSync(tsConfigPath, validTsConfig);
        p.log.success(`Added ${tsConfigPath}`);
        return;
      }
      // else assume that the project-level tsconfig already
      // has the right settings, which is true for Vite and Next.js
    }
    p.log.info(`No ${tsConfigPath} found. Skipping.`);
    return;
  }
  const existingTsConfig = readFileSync(tsConfigPath, "utf8");
  const moduleResolutionPattern = /"moduleResolution"\s*:\s*"(\w+)"/;
  const [, existingModuleResolution] =
    existingTsConfig.match(moduleResolutionPattern) ?? [];
  const skipLibCheckPattern = /"skipLibCheck"\s*:\s*(\w+)/;
  const [, existingSkipLibCheck] =
    existingTsConfig.match(skipLibCheckPattern) ?? [];
  if (
    /Bundler/i.test(existingModuleResolution) &&
    existingSkipLibCheck === "true"
  ) {
    p.log.success(`The ${tsConfigPath} is already set up.`);
    return;
  }

  if (!compilerOptionsPattern.test(existingTsConfig)) {
    p.log.info(`Modify your ${tsConfigPath} to include the following:`);
    const source = `\
  {
    "compilerOptions": {
      "moduleResolution": "Bundler",
      "skipLibCheck": true
    }
  }
    `;
    p.log.message(indent(`\n${source}\n`));
    await promptForConfirmationOrExit("Ready to continue?");
  }
  const changedTsConfig = addCompilerOption(
    addCompilerOption(
      existingTsConfig,
      existingModuleResolution,
      moduleResolutionPattern,
      '"moduleResolution": "Bundler"',
    ),
    existingSkipLibCheck,
    skipLibCheckPattern,
    '"skipLibCheck": true',
  );
  writeFileSync(tsConfigPath, changedTsConfig);
  p.log.success(`Modified ${tsConfigPath}`);
}

function addCompilerOption(
  tsconfig: string,
  existingValue: string | undefined,
  pattern: RegExp,
  optionAndValue: string,
) {
  if (existingValue === undefined) {
    return tsconfig.replace(compilerOptionsPattern, `$1${optionAndValue},$2`);
  } else {
    return tsconfig.replace(pattern, optionAndValue);
  }
}

// ---------------------------------------------------------------------------
// Step 4: convex.config
// ---------------------------------------------------------------------------

async function configureConvexConfig(config: ProjectConfig) {
  logStep(config, "Configure convex config file");
  const sourceTemplate = `\
import { defineApp } from "convex/server";
import auth from "@robelest/convex-auth/convex.config";

const app = defineApp();

app.use(auth);

export default app;
`;
  const source = templateToSource(sourceTemplate);
  const convexConfigPath = path.join(config.convexFolderPath, "convex.config");
  const existingConfigPath = existingNonEmptySourcePath(convexConfigPath);
  if (existingConfigPath !== null) {
    const existingConfig = readFileSync(existingConfigPath, "utf8");
    if (doesAlreadyMatchTemplate(existingConfig, sourceTemplate)) {
      p.log.success(`The ${existingConfigPath} is already set up.`);
    } else {
      p.log.info(
        `You already have a ${existingConfigPath}, make sure it registers the auth component like this:`,
      );
      p.log.message(indent(`\n${source}\n`));
      await promptForConfirmationOrExit("Ready to continue?");
    }
  } else {
    const newConfigPath = config.usesTypeScript
      ? `${convexConfigPath}.ts`
      : `${convexConfigPath}.js`;
    writeFileSync(newConfigPath, source);
    p.log.success(`Created ${newConfigPath}`);
  }
}

// ---------------------------------------------------------------------------
// Step 5: auth.ts
// ---------------------------------------------------------------------------

async function initializeAuth(config: ProjectConfig) {
  logStep(config, "Initialize auth file");
  const sourceTemplate = `\
import { createAuth } from "@robelest/convex-auth/component";
import { components } from "./_generated/api";

const auth = createAuth(components.auth, {$$
  providers: [$$],$$
});

export { auth };
export const { signIn, signOut, store } = auth;
`;
  const source = templateToSource(sourceTemplate);
  const authPath = path.join(config.convexFolderPath, "auth");
  const existingAuthPath = existingNonEmptySourcePath(authPath);
  if (existingAuthPath !== null) {
    const existingAuth = readFileSync(existingAuthPath, "utf8");
    if (doesAlreadyMatchTemplate(existingAuth, sourceTemplate)) {
      p.log.success(`The ${existingAuthPath} is already set up.`);
    } else {
      p.log.info(
        `You already have a ${existingAuthPath}, make sure it initializes auth with \`createAuth\` like this:`,
      );
      p.log.message(indent(`\n${source}\n`));
      await promptForConfirmationOrExit("Ready to continue?");
    }
  } else {
    const newAuthPath = config.usesTypeScript
      ? `${authPath}.ts`
      : `${authPath}.js`;
    writeFileSync(newAuthPath, source);
    p.log.success(`Created ${newAuthPath}`);
  }
}

// ---------------------------------------------------------------------------
// Step 6: http.ts
// ---------------------------------------------------------------------------

async function configureHttp(config: ProjectConfig) {
  logStep(config, "Configure http file");
  const sourceTemplate = `\
import { httpRouter } from "convex/server";
import { auth } from "./auth";

const http = httpRouter();

auth.http.add(http);

export default http;
`;
  const source = templateToSource(sourceTemplate);
  const httpPath = path.join(config.convexFolderPath, "http");
  const existingHttpPath = existingNonEmptySourcePath(httpPath);
  if (existingHttpPath !== null) {
    const existingHttp = readFileSync(existingHttpPath, "utf8");
    if (doesAlreadyMatchTemplate(existingHttp, sourceTemplate)) {
      p.log.success(`The ${existingHttpPath} is already set up.`);
    } else {
      p.log.info(
        `You already have a ${existingHttpPath}, make sure it includes the call to \`auth.http.add\`:`,
      );
      p.log.message(indent(`\n${source}\n`));
      await promptForConfirmationOrExit("Ready to continue?");
    }
  } else {
    const newHttpPath = config.usesTypeScript
      ? `${httpPath}.ts`
      : `${httpPath}.js`;
    writeFileSync(newHttpPath, source);
    p.log.success(`Created ${newHttpPath}`);
  }
}

// ---------------------------------------------------------------------------
// Optional: mount enterprise helpers
// ---------------------------------------------------------------------------

async function mountEnterprise(config: ProjectConfig, only?: string) {
  logStep(config, "Mount enterprise helper files");

  if (only !== undefined && only !== "sso" && only !== "scim") {
    logErrorAndExit("The --only flag must be either 'sso' or 'scim'.");
  }

  const authPath = path.join(config.convexFolderPath, "auth");
  const existingAuthPath = existingNonEmptySourcePath(authPath);
  if (existingAuthPath === null) {
    logErrorAndExit(
      `Could not find ${authPath}.ts or ${authPath}.js. Initialize auth first, then re-run this command.`,
    );
  }

  const authSource = readFileSync(existingAuthPath, "utf8");
  if (!/new\s+SSO\s*\(/.test(authSource)) {
    p.log.warn(
      "Your auth.ts does not appear to include `new SSO()`. Enterprise helper namespaces will not be available until SSO is enabled.",
    );
    await promptForConfirmationOrExit("Continue anyway?", { default: false });
  }

  const mountSso =
    only === undefined
      ? await promptForConfirmation("Mount SSO helpers?", { default: true })
      : only === "sso";
  const mountScim =
    only === undefined
      ? await promptForConfirmation("Mount SCIM helpers?", { default: true })
      : only === "scim";

  if (!mountSso && !mountScim) {
    p.log.info("Nothing selected. No files were created.");
    return;
  }

  if (mountSso) {
    writeMountFile(
      config,
      path.join(config.convexFolderPath, "auth", "sso", "connection"),
      `import { auth } from "../../auth";
import { sso } from "@robelest/convex-auth/server";

export const { create, get, getByGroup, getByDomain, list, update, remove, status } =
  sso(auth).connection;
`,
    );
    writeMountFile(
      config,
      path.join(config.convexFolderPath, "auth", "sso", "connection", "domain"),
      `import { auth } from "../../../auth";
import { sso } from "@robelest/convex-auth/server";

export const { list, set } = sso(auth).connection.domain;
`,
    );
    writeMountFile(
      config,
      path.join(config.convexFolderPath, "auth", "sso", "oidc"),
      `import { auth } from "../../auth";
import { sso } from "@robelest/convex-auth/server";

export const { configure, get, resolveSignIn, validate } = sso(auth).oidc;
`,
    );
    writeMountFile(
      config,
      path.join(config.convexFolderPath, "auth", "sso", "saml"),
      `import { auth } from "../../auth";
import { sso } from "@robelest/convex-auth/server";

export const { configure, metadata, validate } = sso(auth).saml;
`,
    );
    writeMountFile(
      config,
      path.join(config.convexFolderPath, "auth", "sso", "policy"),
      `import { auth } from "../../auth";
import { sso } from "@robelest/convex-auth/server";

export const { get, update, validate } = sso(auth).policy;
`,
    );
    writeMountFile(
      config,
      path.join(config.convexFolderPath, "auth", "sso", "audit"),
      `import { auth } from "../../auth";
import { sso } from "@robelest/convex-auth/server";

export const { record, list } = sso(auth).audit;
`,
    );
    writeMountFile(
      config,
      path.join(config.convexFolderPath, "auth", "sso", "webhook"),
      `import { auth } from "../../auth";
import { sso } from "@robelest/convex-auth/server";

export const { emit } = sso(auth).webhook;
`,
    );
    writeMountFile(
      config,
      path.join(config.convexFolderPath, "auth", "sso", "webhook", "endpoint"),
      `import { auth } from "../../../auth";
import { sso } from "@robelest/convex-auth/server";

export const { create, list, disable } = sso(auth).webhook.endpoint;
`,
    );
    writeMountFile(
      config,
      path.join(config.convexFolderPath, "auth", "sso", "webhook", "delivery"),
      `import { auth } from "../../../auth";
import { sso } from "@robelest/convex-auth/server";

export const { list, listReady, markDelivered, markFailed } =
  sso(auth).webhook.delivery;
`,
    );
  }

  if (mountScim) {
    writeMountFile(
      config,
      path.join(config.convexFolderPath, "auth", "scim"),
      `import { auth } from "../auth";
import { scim } from "@robelest/convex-auth/server";

export const { configure, get, getConfigByToken, validate } = scim(auth);
`,
    );
    writeMountFile(
      config,
      path.join(config.convexFolderPath, "auth", "scim", "identity"),
      `import { auth } from "../../auth";
import { scim } from "@robelest/convex-auth/server";

export const { get, upsert } = scim(auth).identity;
`,
    );
  }

  p.log.success("Enterprise helper mounts are ready.");
}

function writeMountFile(
  config: ProjectConfig,
  filePathWithoutExtension: string,
  source: string,
) {
  const filePath = `${filePathWithoutExtension}.${config.usesTypeScript ? "ts" : "js"}`;
  mkdirSync(path.dirname(filePath), { recursive: true });
  if (existsSync(filePath)) {
    const existing = readFileSync(filePath, "utf8");
    if (existing.trim() === source.trim()) {
      p.log.success(`The ${filePath} is already set up.`);
      return;
    }
    p.log.info(`You already have a ${filePath}, make sure it matches:`);
    p.log.message(indent(`\n${source}\n`));
    return;
  }
  writeFileSync(filePath, source);
  p.log.success(`Created ${filePath}`);
}

// ---------------------------------------------------------------------------
// Extra: --variables
// ---------------------------------------------------------------------------

const VariablesSchema = v.object({
  help: v.optional(v.string()),
  providers: v.array(
    v.object({
      name: v.string(),
      help: v.optional(v.string()),
      variables: v.array(
        v.object({
          name: v.string(),
          description: v.string(),
        }),
      ),
    }),
  ),
  success: v.optional(v.string()),
});

async function configureOtherVariables(config: ProjectConfig, json: string) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (err) {
    logErrorAndExit(
      "The --variables flag must be valid JSON.",
      err instanceof Error ? err.message : String(err),
    );
  }

  const variables = v.parse(VariablesSchema, parsed);
  logStep(config, "Configure extra environment variables");
  if (variables.help !== undefined) {
    p.log.message(variables.help);
  }
  for (const provider of variables.providers) {
    const shouldConfigure = await promptForConfirmation(
      `Do you want to configure ${provider.name}?`,
    );
    if (!shouldConfigure) {
      continue;
    }
    if (provider.help !== undefined) {
      p.log.message(provider.help);
    }
    for (const variable of provider.variables) {
      await configureEnvVar(config, {
        name: variable.name,
        description: variable.description,
      });
    }
  }
  if (variables.success !== undefined) {
    p.log.success(variables.success);
  }
}

// ---------------------------------------------------------------------------
// Template helpers
// ---------------------------------------------------------------------------

export function doesAlreadyMatchTemplate(existing: string, template: string) {
  const regex = new RegExp(
    template
      .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      .replace(/\\\$\\\$/g, ".*")
      .replace(/;\n/g, ";.*"),
    "s",
  );
  return regex.test(existing);
}

export function templateToSource(template: string) {
  return template.replace(/\$\$/g, "");
}

function existingNonEmptySourcePath(filePath: string): string | null {
  return existsAndNotEmpty(`${filePath}.ts`)
    ? `${filePath}.ts`
    : existsAndNotEmpty(`${filePath}.js`)
      ? `${filePath}.js`
      : null;
}

function existsAndNotEmpty(filePath: string): boolean {
  return existsSync(filePath) && readFileSync(filePath, "utf8").trim() !== "";
}

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

function logStep(config: ProjectConfig, message: string) {
  p.log.step(`Step ${config.step++}: ${message}`);
}

// ---------------------------------------------------------------------------
// Source control check
// ---------------------------------------------------------------------------

async function checkSourceControl(options: {
  skipGitCheck?: boolean;
  allowDirtyGitState?: boolean;
}) {
  if (options.allowDirtyGitState) {
    return;
  }
  const isGit = existsSync(".git");
  if (isGit) {
    let gitStatus: string;
    try {
      gitStatus = execFileSync("git", ["status", "--porcelain"], {
        encoding: "utf-8",
      });
    } catch {
      // git not available — skip check
      return;
    }
    const changedFiles = gitStatus
      .split("\n")
      .filter(
        (line) =>
          !/\bpackage(-lock)?.json/.test(line) &&
          !/\benv\.d\.ts$/.test(line) &&
          line.length > 0,
      );
    if (changedFiles.length > 0) {
      p.log.error(
        "There are unstaged or uncommitted changes in the working directory. " +
          "Please commit or stash them before proceeding.",
      );
      await promptForConfirmationOrExit("Continue anyway?", { default: false });
    }
  } else {
    if (options.skipGitCheck) {
      return;
    }
    p.log.warn(
      "No source control detected. We strongly recommend committing the current state of your code before proceeding.",
    );
    await promptForConfirmationOrExit("Continue anyway?");
  }
}

// ---------------------------------------------------------------------------
// Project file readers
// ---------------------------------------------------------------------------

type PackageJSON = { __isPackageJSON: true; [key: string]: any };

function readPackageJson(): PackageJSON {
  try {
    const data = readFileSync("package.json", "utf8");
    return JSON.parse(data);
  } catch (error: any) {
    logErrorAndExit(
      "`@robelest/convex-auth` must be run from a project directory which " +
        'includes a valid "package.json" file. You can create one by running ' +
        "`npm init`.",
      error.message,
    );
  }
}

type ConvexJSON = { __isConvexJSON: true; [key: string]: any };

function readConvexJson(): ConvexJSON {
  if (!existsSync("convex.json")) {
    return {} as ConvexJSON;
  }
  try {
    const data = readFileSync("convex.json", "utf8");
    return JSON.parse(data);
  } catch (error: any) {
    logErrorAndExit(
      "Could not parse your convex.json. Is it valid JSON?",
      error.message,
    );
  }
}

// ---------------------------------------------------------------------------
// Deployment selection
// ---------------------------------------------------------------------------

function readConvexDeployment(options: {
  url?: string;
  adminKey?: string;
  prod?: boolean;
  previewName?: string;
  deploymentName?: string;
}) {
  const { adminKey, url, prod, previewName, deploymentName } = options;
  const adminKeyName = adminKey ? deploymentNameFromAdminKey(adminKey) : null;
  const adminKeyType = adminKey ? deploymentTypeFromAdminKey(adminKey) : null;

  const explicitSelection = [
    url ? { name: adminKeyName ?? url, type: adminKeyType } : null,
    prod ? { name: adminKeyName, type: "prod" as const } : null,
    previewName ? { name: previewName, type: "preview" as const } : null,
    deploymentName ? { name: deploymentName, type: adminKeyType } : null,
    adminKey ? { name: adminKeyName, type: adminKeyType } : null,
  ].find(
    (
      selection,
    ): selection is {
      name: string | null;
      type: string | null;
    } => selection !== null,
  );

  if (explicitSelection !== undefined) {
    return { ...explicitSelection, options };
  }

  loadEnvFile({ path: ".env.local" });
  loadEnvFile();
  if (process.env.CONVEX_DEPLOYMENT) {
    return {
      name: stripDeploymentTypePrefix(process.env.CONVEX_DEPLOYMENT),
      type: getDeploymentTypeFromConfiguredDeployment(
        process.env.CONVEX_DEPLOYMENT,
      ),
      options,
    };
  }

  logErrorAndExit(
    "Could not find a configured CONVEX_DEPLOYMENT. Did you forget to run `npx convex dev` first?",
  );
}

// NOTE: CONVEX CLI DEP
// Given a deployment string like "dev:tall-forest-1234"
// returns only the slug "tall-forest-1234".
// If there's no prefix returns the original string.
export function stripDeploymentTypePrefix(deployment: string) {
  return deployment.split(":").at(-1)!;
}

// NOTE: CONVEX CLI DEP
// Handling legacy CONVEX_DEPLOYMENT without type prefix as well
function getDeploymentTypeFromConfiguredDeployment(raw: string) {
  const typeRaw = raw.split(":")[0];
  const type =
    typeRaw === "prod" || typeRaw === "dev" || typeRaw === "preview"
      ? typeRaw
      : null;
  return type;
}

// NOTE: CONVEX CLI DEP
function deploymentNameFromAdminKey(adminKey: string) {
  const parts = adminKey.split("|");
  const hasDeployment = parts.length > 1;
  return hasDeployment && !isPreviewDeployKey(adminKey)
    ? stripDeploymentTypePrefix(parts[0])
    : null;
}

// NOTE: CONVEX CLI DEP - but modified to not default to "prod"
//
// For current keys returns prod|dev|preview,
// for legacy keys returns "prod".
// Examples:
//  "prod:deploymentName|key" -> "prod"
//  "preview:deploymentName|key" -> "preview"
//  "dev:deploymentName|key" -> "dev"
//  "key" -> "prod"
export function deploymentTypeFromAdminKey(adminKey: string) {
  const parts = adminKey.split(":");
  return parts.length > 1 ? parts.at(0)! : null;
}

// NOTE: CONVEX CLI DEP
// Needed to differentiate a preview deploy key
// from a concrete preview deployment's deploy key.
// preview deploy key: `preview:team:project|key`
// preview deployment's deploy key: `preview:deploymentName|key`
export function isPreviewDeployKey(adminKey: string) {
  const parts = adminKey.split("|");
  if (parts.length === 1) {
    return false;
  }
  const [prefix] = parts;
  const prefixParts = prefix.split(":");
  return prefixParts[0] === "preview" && prefixParts.length === 3;
}

// ---------------------------------------------------------------------------
// Prompts (using @clack/prompts, with TTY detection on stdin)
// ---------------------------------------------------------------------------

async function promptForConfirmationOrExit(
  message: string,
  options: { default?: boolean } = {},
) {
  if (!(await promptForConfirmation(message, options))) {
    p.cancel("Setup cancelled.");
    process.exit(1);
  }
}

async function promptForConfirmation(
  message: string,
  options: { default?: boolean } = {},
): Promise<boolean> {
  if (process.stdin.isTTY) {
    const result = await p.confirm({
      message,
      initialValue: options.default ?? true,
    });
    if (p.isCancel(result)) {
      p.cancel("Setup cancelled.");
      process.exit(1);
    }
    return result;
  } else {
    return options.default ?? true;
  }
}

async function promptForInput(
  message: string,
  options: {
    default?: string;
    validate?: (input: string) => true | string;
  },
): Promise<string> {
  if (process.stdin.isTTY) {
    const result = await p.text({
      message,
      defaultValue: options.default,
      placeholder: options.default,
      validate: options.validate
        ? (val: string | undefined) => {
            if (val === undefined) return "Input is required";
            const check = options.validate!(val);
            if (check === true) return undefined;
            return check;
          }
        : undefined,
    });
    if (p.isCancel(result)) {
      p.cancel("Setup cancelled.");
      process.exit(1);
    }
    return result;
  } else {
    if (options.default !== undefined) {
      return options.default;
    } else {
      logErrorAndExit(
        "Run this command in an interactive terminal to provide input.",
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Final success message
// ---------------------------------------------------------------------------

function printFinalSuccessMessage(config: ProjectConfig) {
  const isProd = config.deployment.type === "prod";
  const deploymentName = config.deployment.name ?? "your deployment";

  if (isProd) {
    p.log.success(`Production setup complete for ${deploymentName}.`);
    p.log.message("  Full docs: https://deepwiki.com/robelest/convex-auth");
  } else {
    p.log.success(`Setup complete for ${deploymentName}.`);
    p.log.message("");
    p.log.message(
      "  To set up production, run this command with your production URL:",
    );
    p.log.message(
      '    npx @robelest/convex-auth --prod --site-url "https://myapp.com"',
    );
    p.log.message("");
    p.log.message("  Don't forget to set provider secrets on production too:");
    p.log.message('    npx convex env set --prod AUTH_GITHUB_ID "..."');
    p.log.message('    npx convex env set --prod AUTH_GITHUB_SECRET "..."');
    p.log.message("");
    p.log.message("  Full docs: https://deepwiki.com/robelest/convex-auth");
  }
}

// ---------------------------------------------------------------------------
// Error helpers
// ---------------------------------------------------------------------------

function logErrorAndExit(message: string, error?: string): never {
  p.log.error(`${message}${error !== undefined ? `\n  Error: ${error}` : ""}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// String helpers
// ---------------------------------------------------------------------------

function indent(string: string) {
  return string.replace(/^/gm, "  ").slice(2);
}
