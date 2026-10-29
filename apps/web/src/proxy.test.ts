// The Content-Security-Policy every page gets (Bab 11 artikel 08, 12, 13),
// made per request by Next.js' proxy.
import { NextRequest } from "next/server";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { config, proxy } from "./proxy.ts";

const request = (url = "http://localhost:5173/produk/kaos-polos") =>
  new NextRequest(url, { headers: { accept: "text/html" } });

/** The page's CSP, one directive per key: { "script-src": "'self' …" }. */
const directives = (csp: string | null): Record<string, string> =>
  Object.fromEntries(
    (csp ?? "").split("; ").map((directive) => {
      const [name = "", ...values] = directive.split(" ");
      return [name, values.join(" ")];
    }),
  );

/** The response's CSP header, parsed. */
const cspOf = (response: Response) =>
  directives(response.headers.get("Content-Security-Policy"));

/**
 * A request header the proxy passes on to the page: NextResponse.next()
 * carries each as x-middleware-request-<name>.
 */
const forwarded = (response: Response, name: string) =>
  response.headers.get(`x-middleware-request-${name.toLowerCase()}`);

beforeEach(() => {
  // Production unless a test says otherwise, with no image origin and no
  // analytics: the strictest policy.
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("IMAGE_ORIGIN", "");
  vi.stubEnv("GA_MEASUREMENT_ID", "");
});

describe("proxy", () => {
  it("sets the production CSP: 'self' plus this request's nonce, no inline code, no framing", () => {
    const response = proxy(request());
    const nonce = forwarded(response, "x-nonce");

    expect(nonce).toMatch(/^[A-Za-z0-9+/]+=*$/);
    expect(cspOf(response)).toEqual({
      "default-src": "'self'",
      "script-src": `'self' 'nonce-${nonce}'`,
      "style-src": `'self' 'nonce-${nonce}'`,
      "img-src": "'self' data:",
      "connect-src": "'self' http://localhost:8080",
      "object-src": "'none'",
      "base-uri": "'self'",
      "form-action": "'self'",
      "frame-ancestors": "'none'",
    });
  });

  it("hands the page the nonce and the same CSP as request headers", () => {
    const response = proxy(request());

    const nonce = forwarded(response, "x-nonce");
    const csp = response.headers.get("Content-Security-Policy");
    expect(nonce).not.toBeNull();
    expect(csp).toContain(`'nonce-${nonce}'`);
    expect(forwarded(response, "Content-Security-Policy")).toBe(csp);
    // The browser's own request headers still reach the page.
    expect(forwarded(response, "accept")).toBe("text/html");
  });

  it("makes a new nonce for every request", () => {
    const nonces = new Set(
      Array.from({ length: 5 }, () => forwarded(proxy(request()), "x-nonce")),
    );

    expect(nonces.size).toBe(5);
  });

  it("allows eval and inline styles in development only, for React's error stacks and hot reload", () => {
    vi.stubEnv("NODE_ENV", "development");

    const response = proxy(request());
    const nonce = forwarded(response, "x-nonce");

    const csp = cspOf(response);
    expect(csp["script-src"]).toBe(`'self' 'nonce-${nonce}' 'unsafe-eval'`);
    expect(csp["style-src"]).toBe("'self' 'unsafe-inline'");
    // Development's default image storage, from server-config.ts.
    expect(csp["img-src"]).toBe("'self' data: http://localhost:8333");
  });

  it("allows product photos from IMAGE_ORIGIN's one origin, never any host", () => {
    vi.stubEnv("IMAGE_ORIGIN", "https://img.example.com/goshop");

    expect(cspOf(proxy(request()))["img-src"]).toBe(
      "'self' data: https://img.example.com",
    );
  });

  it("adds Google Analytics' hosts only when GA_MEASUREMENT_ID is set", () => {
    vi.stubEnv("GA_MEASUREMENT_ID", "G-TEST123456");
    vi.stubEnv("IMAGE_ORIGIN", "https://img.example.com");

    const response = proxy(request());
    const nonce = forwarded(response, "x-nonce");

    const csp = cspOf(response);
    expect(csp["script-src"]).toBe(
      `'self' 'nonce-${nonce}' https://*.googletagmanager.com`,
    );
    expect(csp["img-src"]).toBe(
      "'self' data: https://img.example.com https://*.google-analytics.com https://*.googletagmanager.com",
    );
    expect(csp["connect-src"]).toBe(
      "'self' http://localhost:8080 https://*.google-analytics.com https://*.analytics.google.com https://*.googletagmanager.com",
    );
    // Analytics never brings 'unsafe-inline' with it.
    expect(response.headers.get("Content-Security-Policy")).not.toContain(
      "unsafe-inline",
    );
  });

  it("fails the request on a malformed GA_MEASUREMENT_ID rather than printing it", () => {
    vi.stubEnv("GA_MEASUREMENT_ID", "UA-12345-1");

    expect(() => proxy(request())).toThrow(/GA_MEASUREMENT_ID/);
  });
});

describe("the proxy's matcher", () => {
  const matches = (url: string, headers: Record<string, string> = {}) =>
    unstable_doesMiddlewareMatch({ config, url, headers });

  it.each(["/", "/produk/kaos-polos", "/?kategori=kaos", "/pesanan/o1"])(
    "runs on the page %s",
    (url) => {
      expect(matches(url)).toBe(true);
    },
  );

  it.each([
    "/_next/static/chunks/main.js",
    "/_next/image?url=x",
    "/healthz",
    "/favicon.svg",
    "/theme.js",
    "/robots.txt",
  ])("skips %s, which is not a page", (url) => {
    expect(matches(url)).toBe(false);
  });

  it.each([[{ "next-router-prefetch": "1" }], [{ purpose: "prefetch" }]])(
    "skips a prefetch (%o): it is not a page view",
    (headers) => {
      expect(matches("/produk/kaos-polos", headers)).toBe(false);
    },
  );
});
