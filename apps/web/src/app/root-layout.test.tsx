// The root layout (Bab 11 artikel 08, 10, 13): the default <head> every
// page gets, this request's CSP nonce on its scripts, and Google's tag only
// when GA_MEASUREMENT_ID is set.
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { gtagInitScript } from "@/features/analytics/gtag-init.ts";
import RootLayout, { generateMetadata, viewport } from "./layout.tsx";

const requestHeaders = vi.hoisted(() => ({ current: new Headers() }));

vi.mock("next/headers", () => ({
  headers: () => Promise.resolve(requestHeaders.current),
}));
// The client parts render in their own tests (Providers.test.tsx,
// SiteFrame.test.tsx); here, only what the layout hands them.
vi.mock("@/components/layout/Providers.tsx", () => ({
  Providers: ({ children }: { children: ReactNode }) => (
    <div data-testid="providers">{children}</div>
  ),
}));
vi.mock("@/components/layout/SiteFrame.tsx", () => ({
  SiteFrame: ({
    children,
    analytics,
  }: {
    children: ReactNode;
    analytics: boolean;
  }) => (
    <div data-testid="site-frame" data-analytics={String(analytics)}>
      {children}
    </div>
  ),
}));
// next/script injects its script from the browser after hydration; the
// stand-in prints what it was given.
vi.mock("next/script", () => ({
  default: ({
    src,
    strategy,
    nonce,
  }: {
    src: string;
    strategy: string;
    nonce?: string;
  }) => (
    <script data-next-script={strategy} data-src={src} data-nonce={nonce} />
  ),
}));

const NONCE = "bm9uY2UtZm9yLXRoaXMtcmVxdWVzdA==";

/** The layout for one request, parsed as the browser would. */
const renderLayout = async () => {
  const element = await RootLayout({ children: <p>Isi halaman</p> });
  return new DOMParser().parseFromString(
    `<!doctype html>${renderToStaticMarkup(element)}`,
    "text/html",
  );
};

beforeEach(() => {
  requestHeaders.current = new Headers({ "x-nonce": NONCE });
  vi.stubEnv("GA_MEASUREMENT_ID", "");
});

describe("the root layout's metadata", () => {
  it('makes every relative URL absolute on SITE_URL and titles pages "<page> — GoShop"', () => {
    vi.stubEnv("SITE_URL", "https://shop.example.com");

    const metadata = generateMetadata();

    expect(String(metadata.metadataBase)).toBe("https://shop.example.com/");
    expect(metadata.title).toEqual({
      default: "GoShop",
      template: "%s — GoShop",
    });
    expect(metadata.description).toBe(
      "GoShop: toko online contoh dari kursus Fullstack Santekno.",
    );
    expect(metadata.icons).toEqual({
      icon: { url: "/favicon.svg", type: "image/svg+xml" },
    });
    expect(metadata.openGraph).toEqual({
      siteName: "GoShop",
      locale: "id_ID",
      type: "website",
      title: "GoShop",
      description: "GoShop: toko online contoh dari kursus Fullstack Santekno.",
    });
    expect(metadata.twitter).toEqual({ card: "summary" });
  });

  it("fails in production without SITE_URL", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SITE_URL", "");

    expect(() => generateMetadata()).toThrow(/SITE_URL is not set/);
  });

  it("supports both colour schemes before the CSS arrives", () => {
    expect(viewport).toEqual({ colorScheme: "light dark" });
  });
});

describe("RootLayout", () => {
  it("renders the page in Indonesian inside the providers and the frame", async () => {
    const doc = await renderLayout();

    expect(doc.documentElement.lang).toBe("id");
    const frame = doc.querySelector('[data-testid="site-frame"]');
    expect(frame?.closest('[data-testid="providers"]')).not.toBeNull();
    expect(frame?.textContent).toBe("Isi halaman");
  });

  it("puts this request's nonce on the theme script, which runs before the first paint", async () => {
    const doc = await renderLayout();

    const theme = doc.head.querySelector('script[src="/theme.js"]');
    expect(theme?.getAttribute("nonce")).toBe(NONCE);
    expect(theme?.hasAttribute("async")).toBe(false);
    expect(theme?.hasAttribute("defer")).toBe(false);
  });

  it("has no Google tag, no analytics footer and no Google host without GA_MEASUREMENT_ID", async () => {
    const doc = await renderLayout();

    expect(doc.getElementById("gtag-init")).toBeNull();
    expect(doc.querySelector("[data-next-script]")).toBeNull();
    expect(doc.documentElement.outerHTML).not.toContain("google");
    expect(
      doc
        .querySelector('[data-testid="site-frame"]')
        ?.getAttribute("data-analytics"),
    ).toBe("false");
  });

  it("starts Google's tag in <head> with the nonce, and loads gtag.js after hydration, with GA_MEASUREMENT_ID", async () => {
    vi.stubEnv("GA_MEASUREMENT_ID", "G-TEST123456");

    const doc = await renderLayout();

    const init = doc.head.querySelector("script#gtag-init");
    expect(init?.getAttribute("nonce")).toBe(NONCE);
    expect(init?.textContent).toBe(gtagInitScript("G-TEST123456"));
    // The theme first, then the tag's queue and consent default.
    const headScripts = Array.from(doc.head.querySelectorAll("script"));
    expect(headScripts.indexOf(init as HTMLScriptElement)).toBeGreaterThan(
      headScripts.findIndex((s) => s.getAttribute("src") === "/theme.js"),
    );

    const gtag = doc.body.querySelector("[data-next-script]");
    expect(gtag?.getAttribute("data-next-script")).toBe("afterInteractive");
    expect(gtag?.getAttribute("data-src")).toBe(
      "https://www.googletagmanager.com/gtag/js?id=G-TEST123456",
    );
    expect(gtag?.getAttribute("data-nonce")).toBe(NONCE);
    expect(
      doc
        .querySelector('[data-testid="site-frame"]')
        ?.getAttribute("data-analytics"),
    ).toBe("true");
  });

  it("renders without a nonce when the proxy did not run (no x-nonce header)", async () => {
    requestHeaders.current = new Headers();

    const doc = await renderLayout();

    expect(
      doc.head.querySelector('script[src="/theme.js"]')?.hasAttribute("nonce"),
    ).toBe(false);
  });

  it("fails the page itself in production without SITE_URL, not only its <head>", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SITE_URL", "");

    await expect(renderLayout()).rejects.toThrow(/SITE_URL is not set/);
  });

  it("fails on a malformed GA_MEASUREMENT_ID rather than printing it into a script", async () => {
    vi.stubEnv("GA_MEASUREMENT_ID", "G-x</script>");

    await expect(renderLayout()).rejects.toThrow(/GA_MEASUREMENT_ID/);
  });
});
