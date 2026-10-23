import { fileURLToPath, URL } from "node:url";
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
    plugins: [react()],
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
  };
});
