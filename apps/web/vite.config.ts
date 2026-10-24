/// <reference types="vitest/config" />
import { fileURLToPath, URL } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ command, mode }) => {
  // VITE_* variables from .env files and from the environment. Vite writes
  // them into the bundle at build time, so a production build without
  // VITE_API_URL would talk to nobody: refuse it here.
  const env = loadEnv(mode, import.meta.dirname, "VITE_");
  if (command === "build" && !env.VITE_API_URL) {
    throw new Error(
      "VITE_API_URL is not set. A production build needs the API's public URL, " +
        "for example: VITE_API_URL=https://api.example.com pnpm --filter @goshop/web build",
    );
  }

  return {
    // Tailwind v4 is a Vite plugin: it scans the source for class names and
    // writes only the CSS they use into the bundle, as one static file.
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        "@": fileURLToPath(new URL("./src", import.meta.url)),
      },
    },
    server: {
      // The API's CORS default (APP_CORS_ALLOWED_ORIGINS) allows exactly
      // http://localhost:5173, so the dev server must not move to another
      // port when 5173 is taken: it stops with an error instead.
      port: 5173,
      strictPort: true,
    },
    preview: {
      port: 4173,
      strictPort: true,
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
          // Types only.
          "src/vite-env.d.ts",
          // The entry point: mounts <App /> into index.html and nothing
          // else, like a Go main that only wires things together.
          "src/main.tsx",
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
  };
});
