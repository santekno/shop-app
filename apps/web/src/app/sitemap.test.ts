import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getCategoriesForPage,
  listProductsForSitemap,
} from "@/features/catalog/api/server.ts";
import { category, product } from "@/test/fake-api.ts";
import sitemap, { dynamic } from "./sitemap.ts";

// The API side is tested in features/catalog/api/server.test.ts; here only
// what the sitemap makes of its answers.
vi.mock("@/features/catalog/api/server.ts", () => ({
  getCategoriesForPage: vi.fn(),
  listProductsForSitemap: vi.fn(),
}));

const categories = vi.mocked(getCategoriesForPage);
const products = vi.mocked(listProductsForSitemap);

beforeEach(() => {
  categories.mockReset();
  products.mockReset();
  vi.stubEnv("SITE_URL", "https://shop.example.com");
});

describe("/sitemap.xml", () => {
  it("is built per request, never at next build", () => {
    expect(dynamic).toBe("force-dynamic");
  });

  it("lists the catalog root, each category's canonical list and every product, absolute on SITE_URL", async () => {
    categories.mockResolvedValue([
      category("c1", "Kaos"),
      category("c2", "Kemeja"),
    ]);
    products.mockResolvedValue([
      product("kaos-polos", { updated_at: "2026-10-20T08:00:00Z" }),
      product("kemeja flanel/biru", {
        created_at: "2025-01-01T00:00:00Z",
        updated_at: "2026-10-29T10:30:00Z",
      }),
    ]);

    await expect(sitemap()).resolves.toEqual([
      // No lastModified on a list: no single date says when it changed.
      { url: "https://shop.example.com/" },
      { url: "https://shop.example.com/?kategori=kaos" },
      { url: "https://shop.example.com/?kategori=kemeja" },
      {
        url: "https://shop.example.com/produk/kaos-polos",
        lastModified: "2026-10-20T08:00:00Z",
      },
      {
        // The slug is one path segment, encoded; the date is the last
        // edit, never created_at.
        url: "https://shop.example.com/produk/kemeja%20flanel%2Fbiru",
        lastModified: "2026-10-29T10:30:00Z",
      },
    ]);
  });

  it("lists the catalog root alone when the shop has no categories and no products", async () => {
    categories.mockResolvedValue([]);
    products.mockResolvedValue([]);

    await expect(sitemap()).resolves.toEqual([
      { url: "https://shop.example.com/" },
    ]);
  });

  it("fails (500) when the categories cannot be read, rather than listing a partial shop", async () => {
    categories.mockResolvedValue(null);
    products.mockResolvedValue([product("kaos-polos")]);

    await expect(sitemap()).rejects.toThrow(
      "sitemap: the API did not answer GET /v1/categories",
    );
  });

  it("fails (500) when the product walk fails", async () => {
    categories.mockResolvedValue([category("c1", "Kaos")]);
    products.mockRejectedValue(new Error("GET /v1/products: 503"));

    await expect(sitemap()).rejects.toThrow("GET /v1/products: 503");
  });

  it("fails in production without SITE_URL, before asking the API", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SITE_URL", "");

    await expect(sitemap()).rejects.toThrow(/SITE_URL is not set/);
    expect(products).not.toHaveBeenCalled();
  });
});
