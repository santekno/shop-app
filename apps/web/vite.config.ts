/// <reference types="vitest/config" />
// Vitest's configuration: the storefront's unit tests. Next.js builds and
// serves the app (next.config.ts); this file only runs the tests.
import { fileURLToPath, URL } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const src = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      { find: "@", replacement: src("./src") },
      // `import "server-only"` makes `next build` refuse a server module
      // that a client component imports. Under Vitest it would throw on
      // import: an empty module instead, so a test can import a server
      // module (and app-tree.tsx can load every page).
      { find: /^server-only$/, replacement: src("./src/test/server-only.ts") },
      // What Next.js itself does for code under app/: next/dynamic is the
      // App Router's (React.lazy, a failed chunk reaches error.tsx), not
      // the Pages Router's the package's main entry gives.
      { find: /^next\/dynamic$/, replacement: "next/dist/api/app-dynamic" },
    ],
  },
  test: {
    // Components render into a simulated DOM. Test files, setup and
    // coverage thresholds belong to the test stage (test-engineer).
    environment: "jsdom",
    setupFiles: ["./src/vitest.setup.ts"],
    // vi.stubEnv and vi.stubGlobal last for one test only.
    unstubEnvs: true,
    unstubGlobals: true,
    // Off for a plain `vitest run`; `make test-unit` passes --coverage.
    coverage: {
      provider: "v8",
      // Every source file counts, including one no test imports yet.
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/**/*.test.{ts,tsx}",
        "src/test/**",
        "src/vitest.setup.ts",
        // Declarations only: nothing runs.
        "src/**/*.d.ts",
      ],
      // A table in the terminal only: a report written into the app
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
