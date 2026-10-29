// "/" as the server renders it (Bab 11 artikel 09–10): the catalog's <head>
// for the filters in the URL, and the first page of products handed to the
// browser so it renders without asking the API again.
import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getCategoriesForPage } from "@/features/catalog/api/server.ts";
import {
  category,
  errorResponse,
  fetchMock,
  product,
  productsResponse,
  requestUrl,
  serve,
  categoriesResponse,
} from "@/test/fake-api.ts";
import { renderWithProviders } from "@/test/render.tsx";
import Home, { generateMetadata } from "./page.tsx";

// The browser's API client: what CatalogPage would ask for after hydrating.
vi.mock("@/lib/api.ts", () => import("@/test/fake-api.ts"));
// The categories' fetch is tested in features/catalog/api/server.test.ts.
vi.mock("@/features/catalog/api/server.ts", () => ({
  getCategoriesForPage: vi.fn(),
}));
// On the server, getQueryClient makes a new client per request; under jsdom
// it would hand out the browser's one shared client instead.
vi.mock("@/lib/query-client.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/query-client.ts")>();
  return { ...actual, getQueryClient: () => actual.createQueryClient() };
});

const categories = vi.mocked(getCategoriesForPage);
const KAOS = category("c1", "Kaos");

/** The server's own fetch (lib/server-api.ts), with Next.js' cache options. */
const serverFetch = vi.fn<typeof fetch>();

type NextInit = RequestInit & {
  next?: { revalidate?: number; tags?: string[] };
};

const searchParams = (query: Record<string, string | string[] | undefined>) =>
  Promise.resolve(query);

beforeEach(() => {
  categories.mockReset();
  categories.mockResolvedValue([KAOS]);
  serverFetch.mockReset();
  vi.stubGlobal("fetch", serverFetch);
  fetchMock.mockReset();
  // The browser's requests never answer: whatever shows came from the server.
  fetchMock.mockReturnValue(new Promise(() => undefined));
});

describe("the catalog's metadata", () => {
  it("indexes the root, canonical to /, with the full title written out", async () => {
    await expect(
      generateMetadata({ searchParams: searchParams({}) }),
    ).resolves.toEqual({
      title: { absolute: "Katalog — GoShop" },
      description:
        "Belanja pakaian, elektronik, perlengkapan rumah, dan camilan di GoShop.",
      alternates: { canonical: "/" },
      openGraph: {
        siteName: "GoShop",
        locale: "id_ID",
        type: "website",
        title: "Katalog — GoShop",
        description:
          "Belanja pakaian, elektronik, perlengkapan rumah, dan camilan di GoShop.",
        url: "/",
      },
    });
  });

  it("points a sorted category list at its unsorted canonical URL", async () => {
    const metadata = await generateMetadata({
      searchParams: searchParams({ kategori: "kaos", urut: "termurah" }),
    });

    expect(metadata.title).toEqual({ absolute: "Kaos — GoShop" });
    expect(metadata.alternates).toEqual({ canonical: "/?kategori=kaos" });
    expect(metadata.robots).toBeUndefined();
    expect(metadata.openGraph).toMatchObject({ url: "/?kategori=kaos" });
  });

  it("reads the first value of a repeated parameter", async () => {
    const metadata = await generateMetadata({
      searchParams: searchParams({
        kategori: ["kaos", "kemeja"],
        x: undefined,
      }),
    });

    expect(metadata.title).toEqual({ absolute: "Kaos — GoShop" });
  });

  it("keeps a search out of the index (noindex, follow) with no canonical URL", async () => {
    const metadata = await generateMetadata({
      searchParams: searchParams({ q: "kaos" }),
    });

    expect(metadata.title).toEqual({
      absolute: "Hasil pencarian “kaos” — GoShop",
    });
    expect(metadata.robots).toEqual({ index: false, follow: true });
    expect(metadata).not.toHaveProperty("alternates");
    expect(metadata.openGraph).not.toHaveProperty("url");
  });

  it("keeps an unknown category out of the index", async () => {
    const metadata = await generateMetadata({
      searchParams: searchParams({ kategori: "tidak-ada" }),
    });

    expect(metadata.title).toEqual({
      absolute: "Kategori tidak ditemukan — GoShop",
    });
    expect(metadata.robots).toEqual({ index: false, follow: true });
  });
});

describe("the catalog page (/)", () => {
  it("renders the server's first page of products and categories without the browser asking again", async () => {
    serverFetch.mockResolvedValue(
      productsResponse([
        product("kaos-polos", { name: "Kaos Polos" }),
        product("kaos-garis", { name: "Kaos Garis" }),
      ]),
    );

    const page = await Home({
      searchParams: searchParams({ kategori: "kaos" }),
    });
    renderWithProviders(page, { url: "/?kategori=kaos" });

    expect(await screen.findByText("Kaos Polos")).toBeTruthy();
    expect(screen.getByText("Kaos Garis")).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
    // One request, for the first twelve of the category, through Next.js'
    // data cache for a minute.
    expect(serverFetch).toHaveBeenCalledTimes(1);
    const [input, init] = serverFetch.mock.calls[0] ?? [];
    const url = requestUrl(input as RequestInfo);
    expect(url.pathname).toBe("/v1/products");
    expect(url.searchParams.get("category")).toBe("kaos");
    expect(url.searchParams.get("limit")).toBe("12");
    expect((init as NextInit).next).toEqual({
      revalidate: 60,
      tags: ["products"],
    });
  });

  it("leaves the work to the browser when the API fails on the server", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    categories.mockResolvedValue(null);
    serverFetch.mockResolvedValue(errorResponse(503, "UNAVAILABLE"));
    serve((url) => {
      if (url.pathname === "/v1/categories") return categoriesResponse([KAOS]);
      if (url.pathname === "/v1/products")
        return productsResponse([
          product("kaos-polos", { name: "Kaos Polos" }),
        ]);
      return undefined;
    });

    const page = await Home({ searchParams: searchParams({}) });
    renderWithProviders(page, { url: "/" });

    expect(await screen.findByText("Kaos Polos")).toBeTruthy();
    const browserPaths = fetchMock.mock.calls.map(
      ([input]) => requestUrl(input).pathname,
    );
    expect(browserPaths).toContain("/v1/products");
    expect(browserPaths).toContain("/v1/categories");
  });
});
