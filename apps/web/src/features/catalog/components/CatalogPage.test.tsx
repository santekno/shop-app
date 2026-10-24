import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  categoriesResponse,
  category,
  deferred,
  errorResponse,
  fetchMock,
  product,
  productsResponse,
  requestUrl,
} from "@/test/fake-api.ts";
import { currentLocation, renderWithProviders } from "@/test/render.tsx";
import { CatalogPage } from "./CatalogPage.tsx";

vi.mock("@/lib/api.ts", () => import("@/test/fake-api.ts"));

/** Categories answer at once; every product page waits for the test. */
const serveCatalog = () => {
  const pages: { query: string; answer: (response: Response) => void }[] = [];
  fetchMock.mockImplementation((input) => {
    const url = requestUrl(input);
    if (url.pathname === "/v1/categories") {
      return Promise.resolve(categoriesResponse([category("1", "Pakaian")]));
    }
    const response = deferred<Response>();
    pages.push({ query: url.search, answer: response.resolve });
    return response.promise;
  });
  return {
    pages,
    answer: (n: number, response: Response) => {
      const page = pages[n];
      if (!page) throw new Error(`page request ${n} was not sent`);
      page.answer(response);
    },
  };
};

const productsSection = () => screen.getByRole("region", { name: "Produk" });

beforeEach(() => {
  fetchMock.mockReset();
  document.title = "GoShop";
});

describe("CatalogPage", () => {
  it("names the tab Katalog — GoShop and shows categories beside products", async () => {
    serveCatalog();
    renderWithProviders(<CatalogPage />, { path: "/" });

    expect(document.title).toBe("Katalog — GoShop");
    expect(screen.getByRole("region", { name: "Kategori" })).toBeTruthy();
    expect(await screen.findByText("Pakaian")).toBeTruthy();
  });

  it("asks for 12 products and says Memuat produk… while the first page loads", () => {
    const { pages } = serveCatalog();
    renderWithProviders(<CatalogPage />, { path: "/" });

    expect(pages[0]?.query).toBe("?sort=newest&limit=12");
    expect(within(productsSection()).getByRole("status").textContent).toBe(
      "Memuat produk…",
    );
    expect(within(productsSection()).queryByRole("list")).toBeNull();
  });

  it("loads more pages until all products are shown", async () => {
    const user = userEvent.setup();
    const { pages, answer } = serveCatalog();
    renderWithProviders(<CatalogPage />, { path: "/" });

    answer(0, productsResponse([product("a"), product("b")], "c2"));
    const more = await screen.findByRole("button", {
      name: "Muat lebih banyak",
    });
    expect(within(productsSection()).getAllByRole("listitem")).toHaveLength(2);
    expect(screen.queryByText("Semua produk sudah ditampilkan.")).toBeNull();

    await user.click(more);

    expect(within(productsSection()).getByRole("status").textContent).toBe(
      "Memuat produk berikutnya…",
    );
    expect(
      screen.queryByRole("button", { name: "Muat lebih banyak" }),
    ).toBeNull();
    expect(within(productsSection()).getAllByRole("listitem")).toHaveLength(2);
    expect(pages[1]?.query).toBe("?sort=newest&limit=12&cursor=c2");

    answer(1, productsResponse([product("c")], null));
    expect(
      await screen.findByText("Semua produk sudah ditampilkan."),
    ).toBeTruthy();
    expect(within(productsSection()).getAllByRole("listitem")).toHaveLength(3);
    expect(
      screen.queryByRole("button", { name: "Muat lebih banyak" }),
    ).toBeNull();
  });

  it("says Belum ada produk. for an empty catalog", async () => {
    const { answer } = serveCatalog();
    renderWithProviders(<CatalogPage />, { path: "/" });

    answer(0, productsResponse([], null));

    expect(await screen.findByText("Belum ada produk.")).toBeTruthy();
    expect(within(productsSection()).queryByRole("list")).toBeNull();
    expect(screen.queryByText("Semua produk sudah ditampilkan.")).toBeNull();
  });

  it("offers Muat lebih banyak, not Belum ada produk., for an empty page with a cursor", async () => {
    const { answer } = serveCatalog();
    renderWithProviders(<CatalogPage />, { path: "/" });

    answer(0, productsResponse([], "c2"));

    expect(
      await screen.findByRole("button", { name: "Muat lebih banyak" }),
    ).toBeTruthy();
    expect(screen.queryByText("Belum ada produk.")).toBeNull();
  });

  it("shows an error with Coba lagi, which loads the page again", async () => {
    const user = userEvent.setup();
    const { pages, answer } = serveCatalog();
    renderWithProviders(<CatalogPage />, { path: "/" });

    answer(0, errorResponse(500, "INTERNAL_ERROR", "req-5"));
    const alert = await within(productsSection()).findByRole("alert");
    expect(alert.textContent).toContain("Kode permintaan: req-5");
    expect(within(productsSection()).queryByRole("status")).toBeNull();

    await user.click(within(alert).getByRole("button", { name: "Coba lagi" }));

    expect(within(productsSection()).getByRole("status").textContent).toBe(
      "Memuat produk…",
    );
    expect(pages).toHaveLength(2);
    answer(1, productsResponse([product("a")], null));
    expect(await screen.findByRole("link", { name: "Produk a" })).toBeTruthy();
  });

  it("opens a product at /produk/:slug", async () => {
    const user = userEvent.setup();
    const { answer } = serveCatalog();
    renderWithProviders(<CatalogPage />, { path: "/" });
    answer(0, productsResponse([product("kaos-polos")], null));

    await user.click(
      await screen.findByRole("link", { name: "Produk kaos-polos" }),
    );

    expect(currentLocation()).toBe("/produk/kaos-polos");
  });

  it("has the page heading Katalog", () => {
    serveCatalog();
    renderWithProviders(<CatalogPage />, { path: "/" });

    expect(
      screen.getByRole("heading", { level: 1, name: "Katalog" }).tabIndex,
    ).toBe(-1);
  });
});

describe("CatalogPage's filters in the URL", () => {
  const renderAt = (url: string) =>
    renderWithProviders(<CatalogPage />, { path: "/", url });

  it("asks the API for the URL's category, search and sort", () => {
    const { pages } = serveCatalog();
    renderAt("/?kategori=kaos&q=polos&urut=termurah");

    expect(pages[0]?.query).toBe(
      "?category=kaos&q=polos&sort=price_asc&limit=12",
    );
    expect(screen.getByText("Hasil pencarian untuk “polos”.")).toBeTruthy();
  });

  it("ignores a malformed category instead of sending it", () => {
    const { pages } = serveCatalog();
    renderAt("/?kategori=Kaos%20Polos");

    expect(pages[0]?.query).toBe("?sort=newest&limit=12");
  });

  it("puts a search into the URL, keeping the category", async () => {
    const user = userEvent.setup();
    const { pages, answer } = serveCatalog();
    renderAt("/?kategori=kaos");
    answer(0, productsResponse([product("a")], null));

    await user.type(
      screen.getByRole("searchbox", { name: "Cari produk" }),
      " hitam {Enter}",
    );

    expect(currentLocation()).toBe("/?kategori=kaos&q=hitam");
    expect(pages.at(-1)?.query).toBe(
      "?category=kaos&q=hitam&sort=newest&limit=12",
    );
  });

  it("puts the sort into the URL", async () => {
    const user = userEvent.setup();
    serveCatalog();
    renderAt("/");

    await user.selectOptions(
      screen.getByRole("combobox", { name: "Urutkan" }),
      "Harga terendah",
    );

    expect(currentLocation()).toBe("/?urut=termurah");
  });

  it("says no product matches a filtered list that is empty", async () => {
    const { answer } = serveCatalog();
    renderAt("/?q=zzz");

    answer(0, productsResponse([], null));

    expect(
      await screen.findByText("Tidak ada produk yang cocok."),
    ).toBeTruthy();
    expect(screen.queryByText("Belum ada produk.")).toBeNull();
  });

  it("says a category does not exist (UNKNOWN_CATEGORY), linking to all products with the search kept", async () => {
    const user = userEvent.setup();
    const { answer } = serveCatalog();
    renderAt("/?kategori=tidak-ada&q=polos");

    answer(0, errorResponse(400, "UNKNOWN_CATEGORY"));

    expect(await screen.findByText(/Kategori ini tidak ada\./)).toBeTruthy();
    expect(within(productsSection()).queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("button", { name: "Coba lagi" })).toBeNull();
    await user.click(screen.getByRole("link", { name: "Lihat semua produk" }));
    expect(currentLocation()).toBe("/?q=polos");
  });
});

describe("CatalogPage's pages and their errors", () => {
  it("keeps the loaded products when a later page fails, and retries only that page", async () => {
    const user = userEvent.setup();
    const { pages, answer } = serveCatalog();
    renderWithProviders(<CatalogPage />, { path: "/" });
    answer(0, productsResponse([product("a")], "c2"));
    await user.click(
      await screen.findByRole("button", { name: "Muat lebih banyak" }),
    );

    answer(1, errorResponse(503, "INTERNAL_ERROR", "req-503"));

    const alert = await within(productsSection()).findByRole("alert");
    expect(alert.textContent).toContain("Kode permintaan: req-503");
    expect(screen.getByRole("link", { name: "Produk a" })).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Muat lebih banyak" }),
    ).toBeNull();

    await user.click(within(alert).getByRole("button", { name: "Coba lagi" }));

    // Only the failed page is asked for again, with its cursor.
    expect(pages.map((page) => page.query)).toEqual([
      "?sort=newest&limit=12",
      "?sort=newest&limit=12&cursor=c2",
      "?sort=newest&limit=12&cursor=c2",
    ]);
    answer(2, productsResponse([product("b")], null));
    expect(await screen.findByRole("link", { name: "Produk b" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Produk a" })).toBeTruthy();
    expect(within(productsSection()).queryByRole("alert")).toBeNull();
  });

  it("shows the whole list's error, with no grid, when no page has arrived", async () => {
    const user = userEvent.setup();
    const { pages, answer } = serveCatalog();
    renderWithProviders(<CatalogPage />, { path: "/" });

    answer(0, errorResponse(500, "INTERNAL_ERROR"));

    const alert = await within(productsSection()).findByRole("alert");
    expect(within(productsSection()).queryByRole("list")).toBeNull();
    expect(screen.queryByText("Belum ada produk.")).toBeNull();
    await user.click(within(alert).getByRole("button", { name: "Coba lagi" }));
    expect(pages.at(-1)?.query).toBe("?sort=newest&limit=12");
  });

  it("keeps the grid when a background refetch fails", async () => {
    const { pages, answer } = serveCatalog();
    const { queryClient } = renderWithProviders(<CatalogPage />, { path: "/" });
    answer(0, productsResponse([product("a")], null));
    await screen.findByRole("link", { name: "Produk a" });

    void queryClient.invalidateQueries({ queryKey: ["products"] });
    await vi.waitFor(() => {
      expect(pages).toHaveLength(2);
    });
    answer(1, errorResponse(503, "INTERNAL_ERROR"));
    await vi.waitFor(() => {
      expect(
        queryClient.getQueryState([
          "products",
          "list",
          {
            category: undefined,
            q: undefined,
            sort: "newest",
            limit: 12,
          },
        ])?.status,
      ).toBe("error");
    });

    expect(screen.getByRole("link", { name: "Produk a" })).toBeTruthy();
    expect(screen.getByText("Semua produk sudah ditampilkan.")).toBeTruthy();
    expect(within(productsSection()).queryByText("Memuat produk…")).toBeNull();
    expect(within(productsSection()).queryByRole("alert")).toBeNull();
  });
});
