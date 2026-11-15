// Root ESLint flat config. Run from repo root: `npm run lint`.
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import nextPlugin from "@next/eslint-plugin-next";
import globals from "globals";

export default tseslint.config(
  {
    // Allowlist: build output, generated files, deps, and Deno edge functions
    // (they use URL imports / Deno globals that this Node/TS setup cannot resolve).
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.next/**",
      "**/.expo/**",
      "**/coverage/**",
      "**/next-env.d.ts",
      "supabase/functions/**",
      "supabase/.build/**", // esbuild bundles of the edge functions
      ".agents/**", // local agent tooling, not project code
      ".claude/**",
      ".tmp-*/**",
      "tools/lint/eslint.config.mjs",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: {
      "no-irregular-whitespace": ["error", { skipRegExps: true, skipTemplates: true }],
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
    },
  },
  {
    // Tests use loose casts for PGlite rows, mocked repos and fixtures.
    files: ["**/*.test.{ts,tsx}", "tests/**/*.ts", "packages/db/src/harness.ts", "packages/*/src/test-utils.ts", "packages/*/src/fixtures.ts"],
    rules: { "@typescript-eslint/no-explicit-any": "off" },
  },
  {
    // Metro/Expo asset `require()` and CJS config files are idiomatic there.
    files: ["apps/mobile/**/*.{ts,tsx,js}"],
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
  {
    files: [
      "apps/web/**/*.{ts,tsx}",
      "apps/admin/**/*.{ts,tsx}",
      "apps/mobile/**/*.{ts,tsx}",
      "packages/ui/**/*.{ts,tsx}",
      "packages/i18n/**/*.{ts,tsx}",
    ],
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "error",
    },
  },
  {
    files: ["apps/web/**/*.{ts,tsx}", "apps/admin/**/*.{ts,tsx}"],
    plugins: { "@next/next": nextPlugin },
    settings: { next: { rootDir: ["apps/web/", "apps/admin/"] } },
    rules: { ...nextPlugin.configs.recommended.rules, ...nextPlugin.configs["core-web-vitals"].rules },
  },
);
