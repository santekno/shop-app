// The admin dashboard image as Docker Compose runs it (apps/admin/
// Dockerfile, Caddyfile; Bab 12): its probe, the security headers and the
// Content-Security-Policy on every response, the SPA fallback, caching of
// the hashed build files, real 404s for missing ones, the unprivileged
// user, $PORT, and the storage origins read when it starts rather than
// when it is built.
import { expect, test } from "@playwright/test";
import { adminUrl } from "../support/admin.ts";
import {
  ADMIN_URL,
  BROWSER_API_URL,
  compose,
  docker,
  waitForOk,
} from "../support/stack.ts";
import { publishedPort } from "../support/web-instance.ts";

/** The headers the Caddyfile sends with every response. */
const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "strict-origin-when-cross-origin",
  "x-robots-tag": "noindex, nofollow",
  "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=()",
};

/**
 * The CSP of an image built with VITE_API_URL=apiUrl and run with
 * IMAGE_ORIGIN=images and UPLOAD_ORIGIN=uploads.
 */
const cspFor = (apiUrl: string, images: string, uploads: string): string =>
  "default-src 'self'; script-src 'self'; style-src 'self'; " +
  `img-src 'self' data: blob: ${images}; ` +
  `connect-src 'self' ${new URL(apiUrl).origin} ${uploads}; ` +
  "object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'";

/** An environment variable of the running admin container. */
const adminEnv = (name: string): string =>
  compose("exec", "-T", "admin", "printenv", name).trim();

const expectHeaders = (
  headers: Record<string, string>,
  csp: string,
  what: string,
): void => {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    expect(headers[name], `${what}: ${name}`).toBe(value);
  }
  expect(headers["content-security-policy"], `${what}: CSP`).toBe(csp);
  // Caddy's Server header would only advertise the software.
  expect(headers.server, `${what}: Server`).toBeUndefined();
};

/** The CSP the stack's admin container sends. */
const stackCsp = (): string =>
  cspFor(BROWSER_API_URL, adminEnv("IMAGE_ORIGIN"), adminEnv("UPLOAD_ORIGIN"));

/** The hashed scripts index.html loads. */
const builtScripts = (html: string): string[] =>
  [...html.matchAll(/<script[^>]+src="(\/assets\/[^"]+\.js)"/g)].map(
    (m) => m[1] ?? "",
  );

test("GET /healthz answers 200 ok with the headers", async ({ request }) => {
  const response = await request.get(adminUrl("/healthz"));
  expect(response.status()).toBe(200);
  expect(await response.text()).toBe("ok");
  expectHeaders(response.headers(), stackCsp(), "/healthz");
});

test("every route is index.html, never cached, under the CSP", async ({
  request,
}) => {
  const csp = stackCsp();
  const pages = await Promise.all(
    [
      "/",
      "/masuk",
      "/produk",
      "/pesanan/0192f5d0-1a2b-7c3d-8e4f-5a6b7c8d9e0f/resi",
    ].map(async (path) => {
      const response = await request.get(adminUrl(path));
      expect(response.status(), path).toBe(200);
      expect(response.headers()["content-type"], path).toMatch(/^text\/html/);
      expect(response.headers()["cache-control"], path).toBe("no-cache");
      expectHeaders(response.headers(), csp, path);
      return response.text();
    }),
  );
  expect(new Set(pages).size, "one index.html for every route").toBe(1);
  // No inline script: script-src 'self' would block it.
  expect(pages[0]).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/);
});

test("built files are immutable and compressed; a missing one is a 404, not the page", async ({
  request,
}) => {
  const html = await (await request.get(adminUrl("/"))).text();
  const [script] = builtScripts(html);
  expect(script, "index.html loads hashed files from /assets/").toBeTruthy();
  const response = await request.get(adminUrl(script ?? ""), {
    headers: { "Accept-Encoding": "gzip" },
  });
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toMatch(/javascript/);
  expect(response.headers()["cache-control"]).toBe(
    "public, max-age=31536000, immutable",
  );
  expect(response.headers()["content-encoding"]).toBe("gzip");
  expectHeaders(response.headers(), stackCsp(), script ?? "");
  // The bundle calls the API the image was built for.
  expect(await response.text()).toContain(BROWSER_API_URL);

  const missing = await request.get(adminUrl("/assets/tidak-ada-abc123.js"));
  expect(missing.status()).toBe(404);
  expect(missing.headers()["content-type"] ?? "").not.toMatch(/text\/html/);
  expect(missing.headers()["cache-control"]).toBe("no-store");
  expectHeaders(missing.headers(), stackCsp(), "a missing asset");
});

test("the server runs as an unprivileged user on $PORT", () => {
  const uid = compose("exec", "-T", "admin", "id", "-u").trim();
  expect(uid).toMatch(/^\d+$/);
  expect(uid).not.toBe("0");
  expect(adminEnv("PORT")).toBe("8080");
  expect(ADMIN_URL).toMatch(/^http:\/\/localhost:\d+$/);
});

test("one image, other settings: PORT and the storage origins are read at start, and SIGTERM stops it at once", async () => {
  test.setTimeout(90_000);
  const id = compose("ps", "-q", "admin").trim();
  const image = docker("inspect", "-f", "{{.Config.Image}}", id).trim();
  const images = "https://img.example.test";
  const uploads = "https://unggah.example.test";
  let container = "";
  try {
    container = docker(
      "run",
      "-d",
      "-p",
      "127.0.0.1::9194",
      "-e",
      "PORT=9194",
      "-e",
      `IMAGE_ORIGIN=${images}`,
      "-e",
      `UPLOAD_ORIGIN=${uploads}`,
      image,
    ).trim();
    const base = `http://127.0.0.1:${publishedPort(container, 9194)}`;
    await waitForOk(`${base}/healthz`, 30_000);
    expect(docker("exec", container, "id", "-u").trim()).not.toBe("0");
    const response = await fetch(`${base}/produk`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-security-policy")).toBe(
      cspFor(BROWSER_API_URL, images, uploads),
    );
    await response.body?.cancel();

    const startedAt = Date.now();
    docker("stop", "-t", "10", container);
    expect(Date.now() - startedAt).toBeLessThan(5000);
    const exitCode = docker(
      "inspect",
      "-f",
      "{{.State.ExitCode}}",
      container,
    ).trim();
    // Not 137: that is SIGKILL after the grace period.
    expect(["0", "143"]).toContain(exitCode);
  } finally {
    if (container !== "") docker("rm", "-f", container);
  }
});
