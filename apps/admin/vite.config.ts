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
  };
});
