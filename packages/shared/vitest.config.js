// Vitest settings for @goshop/shared. Test files sit next to the code they
// test (src/**/*.test.ts). Coverage is off for a plain `vitest run` and on
// for `make test-unit`, which passes --coverage.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      // Every source file counts, including one no test imports yet.
      include: ["src/**/*.ts"],
      exclude: [
        "src/**/*.test.ts",
        // No statements to cover: generated types (from api/openapi.yaml),
        // type aliases, and the entry point's re-exports.
        "src/api/schema.gen.ts",
        "src/api/types.ts",
        "src/index.ts",
      ],
      // A table in the terminal only: a report written into the package
      // would be linted and format-checked with the source.
      reporter: [["text", { skipFull: false }]],
      // The gate is 70% for TypeScript; each file must meet it on its own,
      // so a well-tested file cannot hide an untested one.
      thresholds: {
        lines: 70,
        branches: 70,
        functions: 70,
        statements: 70,
        perFile: true,
      },
    },
  },
});
