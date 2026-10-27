// ESLint flat config for the storefront. One array, read top to bottom; a
// later entry wins over an earlier one for the files it matches.
import js from "@eslint/js";
import prettier from "eslint-config-prettier/flat";
import nextPlugin from "@next/eslint-plugin-next";
import reactHooks from "eslint-plugin-react-hooks";
import { defineConfig, globalIgnores } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig([
  // Build output and the file `next build` writes.
  globalIgnores(["dist", ".next", "next-env.d.ts"]),
  // The unit tests, their setup and vite.config.ts (which only runs them
  // now) were written for the Vite app and React Router. Bab 11 artikel
  // 08 moved the app to Next.js; the test stage moves them, with a
  // tsconfig of their own, and removes this entry.
  globalIgnores([
    "src/**/*.test.{ts,tsx}",
    "src/test/**",
    "src/vitest.setup.ts",
    "vite.config.ts",
  ]),
  {
    // This file and the scripts, run by Node.
    files: ["**/*.{js,mjs}"],
    extends: [js.configs.recommended],
    languageOptions: { globals: globals.node },
  },
  {
    // public/ is served as it is and runs in the browser (public/theme.js,
    // before the app): browser globals, not Node's.
    files: ["public/**/*.js"],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ["**/*.{ts,tsx}"],
    extends: [
      js.configs.recommended,
      // The strictest typescript-eslint preset, with type information: it
      // catches floating promises, `any` leaking out of JSON, needless
      // conditions and unsafe template strings, not just style.
      tseslint.configs.strictTypeChecked,
      tseslint.configs.stylisticTypeChecked,
      // The Rules of Hooks, exhaustive effect dependencies, and the React
      // Compiler checks (no setState during render, no mutating props …).
      reactHooks.configs.flat["recommended-latest"],
      // Next.js' own rules: <a> for an internal page instead of <Link>,
      // a <head> or <script> where Next.js manages them, and the Core Web
      // Vitals checks (a synchronous script, an <img> without sizes …).
      nextPlugin.configs["core-web-vitals"],
    ],
    languageOptions: {
      globals: globals.browser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // `==` converts types first (0 == "" is true). Go has no such thing;
      // always compare with ===.
      eqeqeq: "error",
      // A switch over a union must handle every member, so adding a member
      // (a new status, a new error code) points at every switch to update.
      "@typescript-eslint/switch-exhaustiveness-check": "error",
      // Numbers read fine in a template string (`after ${ms} ms`); objects,
      // null and undefined still need an explicit conversion.
      "@typescript-eslint/restrict-template-expressions": [
        "error",
        { allowNumber: true },
      ],
    },
  },
  // Last: turns off every rule that would fight Prettier's formatting.
  prettier,
]);
