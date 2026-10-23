// The storefront image as Docker Compose runs it (apps/web/Dockerfile and
// its Caddyfile): the probe, the single-page-app fallback, the headers,
// caching and compression, and the unprivileged user.
import { expect, test } from "@playwright/test";
import { watchBrowser } from "../support/browser.ts";
import {
  BROWSER_API_URL,
  compose,
  composeWith,
  docker,
  waitForOk,
} from "../support/stack.ts";

/**
 * The CSP the Caddyfile sends for an image built with VITE_API_URL=apiUrl:
 * connect-src holds the URL's origin only, because a CSP source with a path
 * allows that exact path and nothing below it.
 */
const cspFor = (apiUrl: string): string =>
  "default-src 'self'; script-src 'self'; style-src 'self'; " +
  "img-src 'self' data: https:; " +
  `connect-src 'self' ${new URL(apiUrl).origin}; ` +
  "object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'";

const EXPECTED_CSP = cspFor(BROWSER_API_URL);

/** The security headers every response of the container carries. */
const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "strict-origin-when-cross-origin",
  "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=()",
  "content-security-policy": EXPECTED_CSP,
};

const expectSecurityHeaders = (headers: Record<string, string>): void => {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    expect(headers[name], name).toBe(value);
  }
  // Caddy's Server header is removed: it would only advertise the software.
  expect(headers.server).toBeUndefined();
};

test("GET /healthz answers 200 ok, not the app", async ({ request }) => {
  const response = await request.get("/healthz");
  expect(response.status()).toBe(200);
  expect(await response.text()).toBe("ok");
  expect(response.headers()["content-type"]).toMatch(/^text\/plain/);
  expectSecurityHeaders(response.headers());
});

test("a missing asset is a 404 that is never cached, not index.html", async ({
  request,
}) => {
  const response = await request.get("/assets/does-not-exist.js");
  expect(response.status()).toBe(404);
  expect(response.headers()["content-type"] ?? "").not.toMatch(/text\/html/);
  expect(await response.text()).not.toContain('<div id="root">');
  expect(response.headers()["cache-control"]).toBe("no-store");
  expectSecurityHeaders(response.headers());
});

test("index.html carries the security headers and is never cached stale", async ({
  request,
}) => {
  const response = await request.get("/");
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toMatch(/^text\/html/);
  expectSecurityHeaders(response.headers());
  expect(response.headers()["cache-control"]).toBe("no-cache");
});

test("built assets are immutable, compressed and carry the headers too", async ({
  request,
}) => {
  const html = await (await request.get("/")).text();
  const script = /<script[^>]+src="(\/assets\/[^"]+\.js)"/.exec(html)?.[1];
  expect(script, "index.html loads a hashed script from /assets/").toBeTruthy();

  const response = await request.get(script ?? "", {
    headers: { "Accept-Encoding": "gzip" },
  });
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toMatch(/javascript/);
  expect(response.headers()["cache-control"]).toBe(
    "public, max-age=31536000, immutable",
  );
  expect(response.headers()["content-encoding"]).toBe("gzip");
  expectSecurityHeaders(response.headers());
});

test("a deep link gets index.html (SPA fallback)", async ({ request }) => {
  const index = await request.get("/");
  const deep = await request.get("/kategori/pakaian/kaos?urut=terbaru");
  expect(deep.status()).toBe(200);
  expect(deep.headers()["content-type"]).toMatch(/^text\/html/);
  expect(await deep.text()).toBe(await index.text());
  // Same rules as index.html itself: revalidated on every visit.
  expect(deep.headers()["cache-control"]).toBe("no-cache");
  expectSecurityHeaders(deep.headers());
});

test("the app boots from a deep link", async ({ page }) => {
  const problems = await watchBrowser(page);
  await page.goto("/produk/kaos-polos-hitam");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("GoShop");
  await expect(
    page.getByRole("region", { name: "Kategori" }).getByRole("list").first(),
  ).toBeVisible();
  expect(problems.consoleErrors).toEqual([]);
  expect(problems.pageErrors).toEqual([]);
  expect(problems.cspViolations).toEqual([]);
});

test("Caddy runs as an unprivileged user", () => {
  const uid = compose("exec", "-T", "web", "id", "-u").trim();
  expect(uid).toMatch(/^\d+$/);
  expect(uid).not.toBe("0");
  // And listens on $PORT from the environment (8080 in Compose).
  const port = compose("exec", "-T", "web", "printenv", "PORT").trim();
  expect(port).toBe("8080");
});

test("a VITE_API_URL with a path puts only its origin in connect-src", async () => {
  // Builds a second image (every layer before the build argument comes
  // from the cache) under a Compose project of its own, so the stack's web
  // image is untouched, and runs it on a free port.
  test.setTimeout(300_000);
  const apiUrl = "http://localhost:18080/base/";
  // Unique per run, so two worktrees or CI jobs never share the names.
  const project = `goshop-e2e-csp-${process.pid}-${crypto.randomUUID().slice(0, 8)}`;
  const image = `${project}-web`;
  let container = "";
  try {
    composeWith(
      { env: { VITE_API_URL: apiUrl }, timeoutMs: 280_000 },
      "-p",
      project,
      "build",
      "web",
    );
    container = docker("run", "-d", "--rm", "-p", "127.0.0.1::8080", image);
    container = container.trim();
    const port = /:(\d+)\s*$/.exec(docker("port", container, "8080"))?.[1];
    expect(port, "the container's published port").toBeTruthy();
    const base = `http://127.0.0.1:${port ?? ""}`;
    await waitForOk(`${base}/healthz`, 30_000);

    const response = await fetch(`${base}/`);
    const csp = response.headers.get("content-security-policy");
    expect(csp).toBe(cspFor(apiUrl));
    expect(csp).toContain("connect-src 'self' http://localhost:18080;");
    expect(csp).not.toContain("/base");

    // The app itself still calls the full URL, path included.
    const html = await response.text();
    const script = /<script[^>]+src="(\/assets\/[^"]+\.js)"/.exec(html)?.[1];
    expect(script, "index.html loads a hashed script").toBeTruthy();
    const bundle = await (await fetch(`${base}${script ?? ""}`)).text();
    expect(bundle).toContain("http://localhost:18080/base");
  } finally {
    if (container !== "") docker("rm", "-f", container);
    try {
      docker("rmi", image);
    } catch {
      // The build failed, so there is no image to remove.
    }
  }
});
