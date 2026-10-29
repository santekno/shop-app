// /produk/[slug] as the server renders it (Bab 11 artikel 09–10): the
// product's <head>, its structured data, a 404 for an unknown slug, and
// the product handed to the browser so it is not fetched twice.
import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProductImage } from "@goshop/shared";
import { getProductForPage } from "@/features/product/api/server.ts";
import { fetchMock, product } from "@/test/fake-api.ts";
import { renderWithProviders } from "@/test/render.tsx";
import ProductPage, { generateMetadata } from "./page.tsx";

vi.mock("@/lib/api.ts", () => import("@/test/fake-api.ts"));
// The API side is tested in features/product/api/server.test.ts.
vi.mock("@/features/product/api/server.ts", () => ({
  getProductForPage: vi.fn(),
}));
// On the server, a new QueryClient per request (jsdom would share one).
vi.mock("@/lib/query-client.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/query-client.ts")>();
  return { ...actual, getQueryClient: () => actual.createQueryClient() };
});

const getProduct = vi.mocked(getProductForPage);

const photo = (overrides: Partial<ProductImage> = {}): ProductImage => ({
  id: "11111111-1111-4111-8111-111111111111",
  url: "https://img.example.com/products/kaos-800.webp",
  alt: "Kaos polos putih, tampak depan",
  width: 800,
  height: 1000,
  variants: [],
  ...overrides,
});

const LONG_DESCRIPTION = `Kaos polos dari katun combed 30s yang lembut dan adem. ${"Nyaman dipakai seharian, jahitan rapi, warna tidak mudah pudar. ".repeat(4)}`;

const kaos = product("kaos-polos", {
  name: "Kaos Polos",
  description: LONG_DESCRIPTION,
  images: [photo(), photo({ url: "https://img.example.com/second.webp" })],
});

const params = (slug: string) => Promise.resolve({ slug });

beforeEach(() => {
  getProduct.mockReset();
  fetchMock.mockReset();
  fetchMock.mockReturnValue(new Promise(() => undefined));
  vi.stubEnv("SITE_URL", "https://shop.example.com");
});

describe("the product page's metadata", () => {
  it("gives the title, a description cut at a word, the canonical path and a large card with the first photo", async () => {
    getProduct.mockResolvedValue(kaos);

    const metadata = await generateMetadata({ params: params("kaos-polos") });

    expect(getProduct).toHaveBeenCalledWith("kaos-polos");
    const description = metadata.description ?? "";
    expect(description.length).toBeLessThanOrEqual(160);
    expect(description.endsWith("…")).toBe(true);
    expect(LONG_DESCRIPTION.startsWith(description.slice(0, -1))).toBe(true);
    const image = {
      url: "https://img.example.com/products/kaos-800.webp",
      width: 800,
      height: 1000,
      alt: "Kaos polos putih, tampak depan",
    };
    expect(metadata).toEqual({
      // The layout's template makes it "Kaos Polos — GoShop".
      title: "Kaos Polos",
      description,
      alternates: { canonical: "/produk/kaos-polos" },
      openGraph: {
        siteName: "GoShop",
        locale: "id_ID",
        type: "website",
        title: "Kaos Polos — GoShop",
        description,
        url: "/produk/kaos-polos",
        images: [image],
      },
      twitter: {
        card: "summary_large_image",
        title: "Kaos Polos — GoShop",
        description,
        images: [image],
      },
    });
  });

  it("uses the product's name for a photo without its own text", async () => {
    getProduct.mockResolvedValue({ ...kaos, images: [photo({ alt: "" })] });

    const metadata = await generateMetadata({ params: params("kaos-polos") });

    expect(metadata.openGraph?.images).toEqual([
      expect.objectContaining({ alt: "Kaos Polos" }),
    ]);
  });

  it("gives a small card and no image when the product has no photo", async () => {
    getProduct.mockResolvedValue({ ...kaos, images: [] });

    const metadata = await generateMetadata({ params: params("kaos-polos") });

    expect(metadata.openGraph).not.toHaveProperty("images");
    expect(metadata.twitter).toEqual({
      card: "summary",
      title: "Kaos Polos — GoShop",
      description: metadata.description,
    });
  });

  it("encodes the slug in the canonical path", async () => {
    getProduct.mockResolvedValue({ ...kaos, slug: "kaos/biru muda" });

    const metadata = await generateMetadata({
      params: params("kaos/biru muda"),
    });

    expect(metadata.alternates).toEqual({
      canonical: "/produk/kaos%2Fbiru%20muda",
    });
  });

  it("titles an unknown product's 404 page, and nothing more", async () => {
    getProduct.mockResolvedValue(null);

    await expect(
      generateMetadata({ params: params("tidak-ada") }),
    ).resolves.toEqual({ title: "Produk tidak ditemukan" });
  });
});

describe("the product page (/produk/[slug])", () => {
  it("renders the server's product without the browser fetching it again", async () => {
    getProduct.mockResolvedValue(kaos);

    const page = await ProductPage({ params: params("kaos-polos") });
    renderWithProviders(page, { url: "/produk/kaos-polos" });

    expect(
      await screen.findByRole("heading", { level: 1, name: "Kaos Polos" }),
    ).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("carries the Product and the BreadcrumbList as JSON-LD, absolute on SITE_URL", async () => {
    getProduct.mockResolvedValue(kaos);

    const page = await ProductPage({ params: params("kaos-polos") });
    const { container } = renderWithProviders(page, {
      url: "/produk/kaos-polos",
    });

    const blocks = Array.from(
      container.querySelectorAll('script[type="application/ld+json"]'),
      (script) => JSON.parse(script.textContent) as Record<string, unknown>,
    );
    expect(blocks.map((block) => block["@type"])).toEqual([
      "Product",
      "BreadcrumbList",
    ]);
    expect(blocks[0]).toMatchObject({
      name: "Kaos Polos",
      url: "https://shop.example.com/produk/kaos-polos",
      image: [
        "https://img.example.com/products/kaos-800.webp",
        "https://img.example.com/second.webp",
      ],
    });
    expect(blocks[1]).toMatchObject({
      itemListElement: [
        { position: 1, item: "https://shop.example.com/" },
        { position: 2, item: "https://shop.example.com/?kategori=kaos" },
        { position: 3, name: "Kaos Polos" },
      ],
    });
  });

  it("answers 404 (notFound) for a product the API does not know", async () => {
    getProduct.mockResolvedValue(null);

    const error: unknown = await ProductPage({
      params: params("tidak-ada"),
    }).then(
      () => undefined,
      (thrown: unknown) => thrown,
    );

    expect((error as { digest?: string } | undefined)?.digest).toMatch(
      /^NEXT_HTTP_ERROR_FALLBACK;404/,
    );
  });

  it("lets an API failure through, so the page answers 500 and is retried", async () => {
    getProduct.mockRejectedValue(new Error("GET /v1/products/kaos-polos: 503"));

    await expect(ProductPage({ params: params("kaos-polos") })).rejects.toThrow(
      "GET /v1/products/kaos-polos: 503",
    );
  });
});
