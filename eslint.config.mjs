import js from "@eslint/js";
import convexPlugin from "@convex-dev/eslint-plugin";
import globals from "globals";
import noOnlyTests from "eslint-plugin-no-only-tests";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/.next/**",
      "**/coverage/**",
      "**/node_modules/**",
      "**/convex/_generated/**",
      "packages/auth/src/component/_generated/**",
      "packages/portal/.svelte-kit/**",
      "packages/portal/build/**",
      "packages/portal/build-cdn/**",
      "cdn-stage/**",
      "examples/**/.output/**",
      "examples/**/src/routeTree.gen.ts",
      "**/*.d.ts",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{js,mjs,cjs,ts,tsx,jsx}"],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    plugins: {
      "no-only-tests": noOnlyTests,
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { varsIgnorePattern: "^_", argsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/ban-ts-comment": "error",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/require-await": "off",
      "@typescript-eslint/no-empty-object-type": "off",
      "@typescript-eslint/no-require-imports": "off",
      "@typescript-eslint/no-unused-expressions": "off",
      "no-only-tests/no-only-tests": "warn",
    },
  },
  {
    files: ["convex/**/*.{ts,tsx}", "packages/auth/src/component/**/*.{ts,tsx}"],
    extends: convexPlugin.configs.recommended,
  },
  {
    files: [
      "examples/**/src/**/*.{ts,tsx}",
      "examples/**/app/**/*.{ts,tsx}",
      "examples/**/components/**/*.{ts,tsx}",
    ],
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": [
        "warn",
        {
          allowConstantExport: true,
          allowExportNames: [
            "metadata",
            "dynamic",
            "buttonVariants",
            "toggleVariants",
            "badgeVariants",
            "tabsListVariants",
            "useAuthActions",
            "useAuthState",
            "useTheme",
            "Combobox",
            "useComboboxAnchor",
          ],
        },
      ],
    },
  },
);
