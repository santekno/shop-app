// ESLint flat config for @goshop/shared. The same rules as apps/web, minus
// React: see apps/web/eslint.config.js for why each one is here.
import js from "@eslint/js";
import prettier from "eslint-config-prettier/flat";
import { defineConfig, globalIgnores } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig([
  // Generated from api/openapi.yaml; `make gen-types-check` guards it.
  globalIgnores(["src/api/schema.gen.ts"]),
  {
    files: ["**/*.js"],
    extends: [js.configs.recommended],
    languageOptions: { globals: globals.node },
  },
  {
    files: ["**/*.ts"],
    extends: [
      js.configs.recommended,
      tseslint.configs.strictTypeChecked,
      tseslint.configs.stylisticTypeChecked,
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
