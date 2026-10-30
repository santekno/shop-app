/// <reference types="vitest/config" />
import { fileURLToPath, URL } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

/**
 * The admin dashboard is the same kind of app as the Bab 7–10 storefront:
 * a Vite single-page app, served as static files by Caddy. A dashboard
 * needs no SEO (it sits behind a login, and Caddy tells crawlers to keep
 * out), so the Bab 11 move to Next.js does not apply to it.
 */
export default defineConfig(({ command, mode }) => {
  // VITE_* variables from .env files and from the environment. Vite writes
  // them into the bundle at build time, so a production build without
  // VITE_API_URL would talk to nobody: refuse it here.
  const env = loadEnv(mode, import.meta.dirname, "VITE_");
  if (command === "build" && !env.VITE_API_URL) {
    throw new Error(
      "VITE_API_URL is not set. A production build needs the API's public URL, " +
        "for example: VITE_API_URL=https://api.example.com pnpm --filter @goshop/admin build",
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
      // The storefront owns 5173; the admin is 5174. The API's CORS default
      // (APP_CORS_ALLOWED_ORIGINS) allows exactly http://localhost:5174 for
      // it, so the dev server must not move to another port when 5174 is
      // taken: it stops with an error instead.
      port: 5174,
      strictPort: true,
    },
    preview: {
      port: 4174,
      strictPort: true,
    },
    test: {
      // Components render into a simulated DOM. Test files, setup and
      // coverage thresholds belong to the test stage (test-engineer).
      environment: "jsdom",
      setupFiles: ["./src/vitest.setup.ts"],
      // React Router ships ESM and CommonJS builds, and under Vitest
      // `react-router/dom` (App.tsx's RouterProvider) loads the CommonJS
      // one, which requires its own copy of `react-router`: two routers,
      // two contexts, and every hook below RouterProvider throws
      // "useLocation() may be used only in the context of a <Router>".
      // Both names point at the ESM files, so there is one copy.
      alias: [
        {
          find: /^react-router$/,
          replacement: fileURLToPath(
            new URL(
              "./node_modules/react-router/dist/development/index.mjs",
              import.meta.url,
            ),
          ),
        },
        {
          find: /^react-router\/dom$/,
          replacement: fileURLToPath(
            new URL(
              "./node_modules/react-router/dist/development/dom-export.mjs",
              import.meta.url,
            ),
          ),
        },
      ],
      // The dashboard's variables, empty whatever the shell exports (the
      // e2e stack's VITE_API_URL, say): config.ts falls back to its
      // development default, which the MSW handlers answer for.
      env: {
        VITE_API_URL: "",
      },
      // 20 s per test instead of 5: make test-unit runs every workspace at
      // once with coverage on a shared machine, where a form with 50
      // variants or a lazy page took over 5 s to render. Assertions are
      // unchanged; only a slow machine gets more time.
      testTimeout: 20_000,
      // vi.stubEnv and vi.stubGlobal last for one test only.
      unstubEnvs: true,
      unstubGlobals: true,
      // And vi.spyOn (a silenced console.error, say).
      restoreMocks: true,
      // Off for a plain `vitest run`; `make test-unit` passes --coverage.
      coverage: {
        provider: "v8",
        // Every source file counts, including one no test imports yet.
        include: ["src/**/*.{ts,tsx}"],
        exclude: [
          "src/**/*.test.{ts,tsx}",
          "src/test/**",
          "src/vitest.setup.ts",
          // The entry point only mounts <App /> into index.html.
          "src/main.tsx",
          // Declarations only: nothing runs.
          "src/**/*.d.ts",
        ],
        // A table in the terminal only: a report written into the app
        // would be linted and format-checked with the source.
        reporter: [["text", { skipFull: false }]],
        // The gate is 70% for TypeScript; each file must meet it on its
        // own, so a well-tested file cannot hide an untested one.
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
