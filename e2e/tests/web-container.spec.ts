// The storefront image as Docker Compose runs it (apps/web/Dockerfile, Bab
// 11 artikel 14): the Next.js standalone server. Its probe, the security
// headers and the per-request CSP nonce (src/proxy.ts), caching of the
// hashed build files, real 404s, the unprivileged user, $PORT, a fast stop
// on SIGTERM, and the settings it reads when it starts rather than when it
// is built. (Bab 7–10 checked the Caddy image of the Vite build here.)
import { expect, test } from "@playwright/test";
import { watchBrowser } from "../support/browser.ts";
import { asHtml, expectNoProblems, fetchProduct } from "../support/catalog.ts";
import {
  BROWSER_API_URL,
  SITE_URL,
  compose,
  composeWith,
  docker,
  stackImageOrigin,
  waitForOk,
} from "../support/stack.ts";

/** The headers next.config.ts sends with every response. */
const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "strict-origin-when-cross-origin",
  "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=()",
};

const expectSecurityHeaders = (headers: Record<string, string>): void => {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    expect(headers[name], name).toBe(value);
  }
  // poweredByHeader: false. It would only advertise the framework.
  expect(headers["x-powered-by"]).toBeUndefined();
};

/** A base64 nonce in a CSP source: 'nonce-…'. */
const NONCE = /'nonce-([A-Za-z0-9+/=]+)'/;

/**
 * The CSP src/proxy.ts sends for one request, with its nonce, for an image
 * built with NEXT_PUBLIC_API_URL=apiUrl and run with IMAGE_ORIGIN=images
 * and no GA_MEASUREMENT_ID: connect-src holds the API's origin only,
 * because a CSP source with a path allows that exact path and nothing
 * below it.
 */
const cspFor = (nonce: string, apiUrl: string, images: string): string =>
  "default-src 'self'; " +
  `script-src 'self' 'nonce-${nonce}'; style-src 'self' 'nonce-${nonce}'; ` +
  `img-src 'self' data: ${new URL(images).origin}; ` +
  `connect-src 'self' ${new URL(apiUrl).origin}; ` +
  "object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'";

/** The nonce of a page's CSP header, failing the test when there is none. */
const nonceOf = (headers: Record<string, string>): string => {
  const csp = headers["content-security-policy"] ?? "";
  const nonce = NONCE.exec(csp)?.[1];
  expect(nonce, `a nonce in ${csp}`).toBeTruthy();
  return nonce ?? "";
};

/** Every <script> start tag of an HTML page. */
const scriptTags = (html: string): string[] =>
  html.match(/<script\b[^>]*>/g) ?? [];

/** The hashed build files a page loads. */
const builtScripts = (html: string): string[] =>
  [...html.matchAll(/<script[^>]+src="(\/_next\/static\/[^"]+\.js)"/g)].map(
    (m) => m[1] ?? "",
  );

/** The web container's image and Compose network, for docker run. */
const stackWeb = (): { image: string; network: string } => {
  const id = compose("ps", "-q", "web").trim();
  const [image = "", network = ""] = docker(
    "inspect",
    "-f",
    "{{.Config.Image}} {{range $k, $v := .NetworkSettings.Networks}}{{$k}}{{end}}",
    id,
  )
    .trim()
    .split(" ");
  return { image, network };
};

/** The host port docker published for a container's port. */
const publishedPort = (container: string, port: number): string => {
  const published = /:(\d+)\s*$/m.exec(docker("port", container, String(port)));
  expect(published, "the container's published port").toBeTruthy();
  return published?.[1] ?? "";
};

test("GET /healthz answers 200 ok from a route handler, never cached", async ({
  request,
}) => {
  const response = await request.get("/healthz");
  expect(response.status()).toBe(200);
  expect(await response.text()).toBe("ok");
  expect(response.headers()["content-type"]).toMatch(/^text\/plain/);
  expect(response.headers()["cache-control"]).toBe("no-store");
  expectSecurityHeaders(response.headers());
  // The proxy leaves the probe alone: no page, so no CSP and no nonce.
  expect(response.headers()["content-security-policy"]).toBeUndefined();
});

test("each page gets the headers and a CSP with a nonce of its own, which every script carries", async ({
  request,
}) => {
  const images = stackImageOrigin();
  const nonces: string[] = [];
  for (const path of ["/", "/", "/masuk"]) {
    const response = await request.get(path);
    expect(response.status(), path).toBe(200);
    const headers = response.headers();
    expect(headers["content-type"], path).toMatch(/^text\/html/);
    expectSecurityHeaders(headers);
    const nonce = nonceOf(headers);
    expect(headers["content-security-policy"], path).toBe(
      cspFor(nonce, BROWSER_API_URL, images),
    );
    // Rendered for this request: a cached copy would repeat the nonce.
    expect(headers["cache-control"], path).toContain("no-store");

    const tags = scriptTags(await response.text());
    expect(tags.length, `${path} has scripts`).toBeGreaterThan(0);
    for (const tag of tags) {
      // The theme script is a file from 'self' (public/theme.js); every
      // other script, inline or not, carries this response's nonce.
      if (tag.includes('src="/theme.js"')) continue;
      expect(tag, path).toContain(`nonce="${nonce}"`);
    }
    nonces.push(nonce);
  }
  expect(new Set(nonces).size, "three requests, three nonces").toBe(3);
  // A UUID's 36 characters, base64: 48 characters, 122 random bits.
  for (const nonce of nonces) expect(nonce).toHaveLength(48);
});

test("built files are immutable, compressed and carry the headers too", async ({
  request,
}) => {
  const html = await (await request.get("/")).text();
  const [script] = builtScripts(html);
  expect(
    script,
    "the page loads hashed files from /_next/static/",
  ).toBeTruthy();

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

test("a missing build file is a 404 that is never cached, not a page", async ({
  request,
}) => {
  const response = await request.get("/_next/static/chunks/does-not-exist.js");
  expect(response.status()).toBe(404);
  expect(response.headers()["content-type"] ?? "").not.toMatch(/text\/html/);
  expect(response.headers()["cache-control"]).toContain("no-store");
  expectSecurityHeaders(response.headers());
});

test("an unknown URL is a real 404 from the server, with the not-found page", async ({
  request,
}) => {
  // Bab 7–10's SPA fallback answered 200 with index.html here.
  const response = await request.get("/kategori/tidak-ada?urut=terbaru");
  expect(response.status()).toBe(404);
  expect(response.headers()["content-type"]).toMatch(/^text\/html/);
  expect(await response.text()).toContain("Halaman tidak ditemukan");
  expectSecurityHeaders(response.headers());
  nonceOf(response.headers());
});

test("a deep link to a product is rendered by the server and hydrates cleanly", async ({
  page,
  request,
}) => {
  const product = await fetchProduct("kaos-polos-hitam");
  // The HTML already holds the product: no JavaScript needed to read it.
  const html = await (await request.get(`/produk/${product.slug}`)).text();
  expect(html).toMatch(new RegExp(`<h1[^>]*>${asHtml(product.name)}</h1>`));
  expect(html).toContain(
    `<link rel="canonical" href="${SITE_URL}/produk/${product.slug}"/>`,
  );

  const problems = await watchBrowser(page);
  await page.goto(`/produk/${product.slug}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    product.name,
  );
  await expect(page.getByRole("region", { name: "Kategori" })).toHaveCount(0);
  expectNoProblems(problems);
});

test("the server runs as an unprivileged user on $PORT", () => {
  const uid = compose("exec", "-T", "web", "id", "-u").trim();
  expect(uid).toMatch(/^\d+$/);
  expect(uid).not.toBe("0");
  // Listening on $PORT from the environment (8080 in Compose).
  expect(compose("exec", "-T", "web", "printenv", "PORT").trim()).toBe("8080");
});

test("one image, other settings: PORT, SITE_URL, IMAGE_ORIGIN and GA_MEASUREMENT_ID are read at start, and SIGTERM stops it at once", async () => {
  // The stack's own image, started again next to it with other values and
  // no rebuild: everything but NEXT_PUBLIC_API_URL is read by the server
  // when it runs. On the stack's network, so API_INTERNAL_URL reaches the
  // api container by its service name.
  test.setTimeout(90_000);
  const { image, network } = stackWeb();
  const site = "https://shop.example.test";
  const images = "https://img.example.test";
  let container = "";
  try {
    container = docker(
      "run",
      "-d",
      "--network",
      network,
      "-p",
      "127.0.0.1::9191",
      "-e",
      "PORT=9191",
      "-e",
      "API_INTERNAL_URL=http://api:8080",
      "-e",
      `SITE_URL=${site}`,
      "-e",
      `IMAGE_ORIGIN=${images}/foto`,
      "-e",
      "GA_MEASUREMENT_ID=G-E2ETEST01",
      image,
    ).trim();
    const base = `http://127.0.0.1:${publishedPort(container, 9191)}`;
    await waitForOk(`${base}/healthz`, 30_000);
    expect(docker("exec", container, "id", "-u").trim()).not.toBe("0");

    const robots = await (await fetch(`${base}/robots.txt`)).text();
    expect(robots).toContain(`Sitemap: ${site}/sitemap.xml`);

    const product = await fetchProduct("kaos-polos-hitam");
    const response = await fetch(`${base}/produk/${product.slug}`);
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain(
      `<link rel="canonical" href="${site}/produk/${product.slug}"/>`,
    );
    expect(html).toContain("G-E2ETEST01");
    const csp = response.headers.get("content-security-policy") ?? "";
    // IMAGE_ORIGIN's origin only, and Google's hosts once analytics is on.
    expect(csp).toContain(`img-src 'self' data: ${images} `);
    expect(csp).not.toContain("/foto");
    expect(csp).toMatch(
      /script-src 'self' 'nonce-[^']+' https:\/\/\*\.googletagmanager\.com;/,
    );
    expect(csp).toContain(
      `connect-src 'self' ${new URL(BROWSER_API_URL).origin} https://*.google-analytics.com`,
    );

    // docker stop sends SIGTERM and waits up to 10 s before SIGKILL; the
    // server must not use that grace period up.
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

test("a NEXT_PUBLIC_API_URL with a path puts only its origin in connect-src", async () => {
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
      { env: { NEXT_PUBLIC_API_URL: apiUrl }, timeoutMs: 280_000 },
      "-p",
      project,
      "build",
      "web",
    );
    container = docker(
      "run",
      "-d",
      "-p",
      "127.0.0.1::8080",
      "-e",
      "SITE_URL=https://shop.example.test",
      image,
    ).trim();
    const base = `http://127.0.0.1:${publishedPort(container, 8080)}`;
    await waitForOk(`${base}/healthz`, 30_000);

    // The not-found page needs no API, which this image cannot reach.
    const response = await fetch(`${base}/tidak-ada`);
    expect(response.status).toBe(404);
    const csp = response.headers.get("content-security-policy") ?? "";
    expect(csp).toContain("connect-src 'self' http://localhost:18080;");
    expect(csp).not.toContain("/base");

    // The browser's code itself still calls the full URL, path included.
    const html = await response.text();
    const scripts = builtScripts(html);
    expect(scripts.length, "the page loads hashed files").toBeGreaterThan(0);
    const bundles = await Promise.all(
      scripts.map(async (src) => (await fetch(`${base}${src}`)).text()),
    );
    expect(
      bundles.some((code) => code.includes("http://localhost:18080/base")),
      "a script holds NEXT_PUBLIC_API_URL",
    ).toBe(true);
  } finally {
    if (container !== "") docker("rm", "-f", container);
    try {
      docker("rmi", image);
    } catch {
      // The build failed, so there is no image to remove.
    }
  }
});
