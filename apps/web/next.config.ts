import path from "node:path";
import type { NextConfig } from "next";
import { PHASE_PRODUCTION_BUILD } from "next/constants";

// The monorepo's root: packages/shared lives there, outside apps/web.
const workspaceRoot = path.join(import.meta.dirname, "../..");

/**
 * Headers every response gets, the ones apps/web/Caddyfile sent in Bab 7–10.
 * The Content-Security-Policy is not here: it carries a fresh nonce per
 * request, so src/proxy.ts sets it (artikel 08).
 */
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // No camera, microphone, location or browser payment API: the buyer
  // pays on Midtrans' own page (artikel 04).
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=()",
  },
];

export default (phase: string): NextConfig => {
  // NEXT_PUBLIC_* values are written into the browser's JavaScript at
  // build time, like Vite's VITE_*: a production build without the API's
  // public URL would talk to nobody, so it is refused here. Only for
  // `next build`: `next typegen` (make typecheck) loads this file in the
  // same phase and needs no URL.
  const building =
    phase === PHASE_PRODUCTION_BUILD && process.argv.includes("build");
  if (building && !process.env.NEXT_PUBLIC_API_URL) {
    throw new Error(
      "NEXT_PUBLIC_API_URL is not set. A production build needs the API's public URL, " +
        "for example: NEXT_PUBLIC_API_URL=https://api.example.com pnpm --filter @goshop/web build",
    );
  }

  return {
    // A self-contained server (.next/standalone/apps/web/server.js) with
    // only the node_modules it uses: the Docker image copies that folder,
    // not the whole workspace (artikel 14).
    output: "standalone",
    // Trace from the workspace root, so @goshop/shared is copied too.
    outputFileTracingRoot: workspaceRoot,
    turbopack: { root: workspaceRoot },
    // "X-Powered-By: Next.js" tells an attacker which bugs to try.
    poweredByHeader: false,
    // @goshop/shared ships TypeScript source, not built JavaScript.
    transpilePackages: ["@goshop/shared"],
    headers: () =>
      Promise.resolve([{ source: "/:path*", headers: securityHeaders }]),
  };
};
