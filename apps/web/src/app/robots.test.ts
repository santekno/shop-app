import { describe, expect, it, vi } from "vitest";
import robots, { dynamic } from "./robots.ts";

describe("/robots.txt", () => {
  it("is built per request, when SITE_URL can be read", () => {
    expect(dynamic).toBe("force-dynamic");
  });

  it("lets every crawler in, keeps the private pages and the searches out, and names the sitemap on SITE_URL", () => {
    vi.stubEnv("SITE_URL", "https://shop.example.com");

    expect(robots()).toEqual({
      rules: {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/keranjang",
          "/checkout",
          "/pembayaran",
          "/pesanan",
          "/akun",
          "/masuk",
          "/daftar",
          "/*?q=",
          "/*&q=",
        ],
      },
      sitemap: "https://shop.example.com/sitemap.xml",
    });
  });

  it("never disallows the catalog, a sort order or a product page", () => {
    vi.stubEnv("SITE_URL", "https://shop.example.com");

    const { rules } = robots();
    const disallow = Array.isArray(rules) ? [] : (rules.disallow ?? []);
    for (const blocked of disallow) {
      expect(["/", "/produk", "/*?urut=", "/*?kategori="]).not.toContain(
        blocked,
      );
      expect(blocked.startsWith("/produk")).toBe(false);
    }
  });

  it("fails in production without SITE_URL rather than pointing at localhost", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SITE_URL", "");

    expect(() => robots()).toThrow(/SITE_URL is not set/);
  });
});
