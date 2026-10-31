// ESLint flat config for the mobile app: the same rules as apps/admin
// (eslint.config.js there), minus the browser-only parts. It is .mjs
// because this package is CommonJS by default, as Metro's config file
// expects.
//
// Why not eslint-config-expo: it brings eslint-plugin-react and
// eslint-plugin-import, which do not support ESLint 10 yet (their peer
// ranges stop at ESLint 9), and the whole repository is on ESLint 10. What
// it would add for this code is covered by typescript-eslint's type-aware
// rules and the React Hooks plugin below.
import js from "@eslint/js";
import prettier from "eslint-config-prettier/flat";
import reactHooks from "eslint-plugin-react-hooks";
import { defineConfig, globalIgnores } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig([
  globalIgnores(["dist", ".expo", "android", "ios", "expo-env.d.ts"]),
  {
    // This file, run by Node as an ES module.
    files: ["**/*.mjs"],
    extends: [js.configs.recommended],
    languageOptions: { globals: globals.node },
  },
  {
    // metro.config.js, run by Node as CommonJS.
    files: ["**/*.js"],
    extends: [js.configs.recommended],
    languageOptions: { globals: globals.node, sourceType: "commonjs" },
  },
  {
    files: ["**/*.{ts,tsx}"],
    extends: [
      js.configs.recommended,
      // The strictest typescript-eslint preset, with type information.
      tseslint.configs.strictTypeChecked,
      tseslint.configs.stylisticTypeChecked,
      // The Rules of Hooks, exhaustive effect dependencies, and the React
      // Compiler checks.
      reactHooks.configs.flat["recommended-latest"],
    ],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      eqeqeq: "error",
      "@typescript-eslint/switch-exhaustiveness-check": "error",
      "@typescript-eslint/restrict-template-expressions": [
        "error",
        { allowNumber: true },
      ],
    },
  },
  {
    // app.config.ts runs in Node, at build time, not on the phone.
    files: ["app.config.ts"],
    languageOptions: { globals: globals.node },
  },
  // Last: turns off every rule that would fight Prettier's formatting.
  prettier,
]);
