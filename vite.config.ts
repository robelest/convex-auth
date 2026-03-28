import path from "node:path";

import { defineConfig } from "vite-plus";

const convexApp = path.resolve(import.meta.dirname, "./convex");
const authSrc = path.resolve(import.meta.dirname, "./packages/auth/src");
const samlifyRoot = path.resolve(import.meta.dirname, "./packages/samlify");
const samlifyTest = path.resolve(import.meta.dirname, "./tests/samlify");

const testProjectAliases = {
  "@convex": convexApp,
  "@convex/": `${convexApp}/`,
  "@robelest/convex-auth/test": path.join(authSrc, "test.ts"),
  "@robelest/convex-auth": authSrc,
  "@robelest/convex-auth/": `${authSrc}/`,
  "@robelest/samlify/test": samlifyTest,
  "@robelest/samlify/test/": `${samlifyTest}/`,
  "@robelest/samlify": samlifyRoot,
  "@robelest/samlify/": `${samlifyRoot}/`,
} as const;

export default defineConfig({
  staged: {
    "*": "vp check --fix",
  },
  lint: {
    ignorePatterns: [
      "**/dist/**",
      "**/_generated/**",
      "**/node_modules/**",
      "packages/samlify/**",
      "packages/auth/src/server/auth.ts",
      "packages/auth/src/server/index.ts",
      "packages/auth/src/server/implementation.ts",
    ],
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
  run: {
    cache: {
      scripts: true,
      tasks: true,
    },
    tasks: {
      "cache:build": {
        command:
          "vp run --filter @robelest/samlify build && vp exec varlock run -- vp exec convex codegen --component-dir ./packages/auth/src/component && vp run --filter @robelest/convex-auth build",
        cache: true,
        input: [
          "convex/**",
          "packages/**",
          "scripts/**",
          "package.json",
          "pnpm-lock.yaml",
          "pnpm-workspace.yaml",
          "tsconfig*.json",
          "vite.config.ts",
          "!**/dist/**",
          "!**/_generated/**",
        ],
      },
      "cache:check": {
        command: "vp lint && vp fmt --check .",
        cache: true,
        input: [
          "convex/**",
          "packages/**",
          "tests/**",
          "scripts/**",
          "docs/**",
          "package.json",
          "pnpm-lock.yaml",
          "pnpm-workspace.yaml",
          "tsconfig*.json",
          "vite.config.ts",
          "!**/dist/**",
          "!**/_generated/**",
        ],
      },
      "cache:test": {
        command:
          "vp test --run --project convex --project node --project samlify --project interop",
        cache: true,
        input: [
          "convex/**",
          "packages/**",
          "tests/**",
          "package.json",
          "pnpm-lock.yaml",
          "pnpm-workspace.yaml",
          "tsconfig*.json",
          "vite.config.ts",
          "!**/dist/**",
          "!**/_generated/**",
        ],
      },
        "cache:validate": {
          command:
            "vp run typecheck:tests && vp run '@robelest/convex-auth#typecheck:consumer' && vp run '@robelest/convex-auth#check:packaging' && vp run --filter @robelest/samlify check:packaging && vp run --filter @robelest/samlify check:runtime-imports && vp run --filter @robelest/samlify report:edge-gaps",
          cache: true,
        input: [
          "convex/**",
          "packages/**",
          "tests/**",
          "package.json",
          "pnpm-lock.yaml",
          "pnpm-workspace.yaml",
          "tsconfig*.json",
          "vite.config.ts",
          "!**/dist/**",
          "!**/_generated/**",
        ],
      },
    },
  },
  test: {
    passWithNoTests: true,
    projects: [
      {
        root: "./tests",
        resolve: {
          alias: testProjectAliases,
        },
        test: {
          name: "convex",
          include: ["*.test.ts", "enterprise/**/*.test.ts"],
          exclude: ["**/*.node.test.ts"],
          environment: "edge-runtime",
          setupFiles: ["./vitest.setup.ts"],
          server: { deps: { inline: ["convex-test"] } },
          fileParallelism: false,
          testTimeout: 10000,
        },
      },
      {
        root: "./tests",
        resolve: {
          alias: testProjectAliases,
        },
        test: {
          name: "node",
          include: ["*.node.test.ts"],
          exclude: ["enterprise/**/*.node.test.ts"],
          environment: "node",
          setupFiles: ["./vitest.setup.ts"],
          server: { deps: { inline: ["convex-test"] } },
          fileParallelism: false,
          testTimeout: 60000,
        },
      },
      {
        root: "./tests",
        resolve: {
          alias: testProjectAliases,
        },
        test: {
          name: "interop",
          include: ["enterprise/**/*.node.test.ts"],
          environment: "node",
          globalSetup: ["./infra/docker/setup.node.ts"],
          setupFiles: ["./vitest.setup.ts"],
          server: { deps: { inline: ["convex-test"] } },
          fileParallelism: false,
          testTimeout: 60000,
          sequence: {
            groupOrder: 1,
          },
        },
      },
      {
        root: "./tests",
        resolve: {
          alias: testProjectAliases,
        },
        test: {
          name: "samlify",
          include: ["samlify/**/*.ts"],
          exclude: ["node_modules", "dist", "samlify/setup.ts"],
          environment: "node",
          globals: false,
          setupFiles: ["./samlify/setup.ts"],
        },
      },
    ],
  },
});
