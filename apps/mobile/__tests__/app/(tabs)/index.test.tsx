import { afterEach, describe, expect, it } from "@jest/globals";
import { onlineManager } from "@tanstack/react-query";
import { router } from "expo-router";
import {
  act,
  fireEvent,
  screen,
  userEvent,
  waitFor,
  within,
} from "@testing-library/react-native";

import { queryClient } from "@/lib/query-client";
import { emitNetworkState, setInitialNetworkState } from "@/test/expo-network";
import { apiError, fakeApi, json } from "@/test/fake-api";
import { category, product, productPage } from "@/test/fixtures";
import { refreshControl } from "@/test/list";
import { renderApp } from "@/test/router";

afterEach(() => {
  queryClient.clear();
  onlineManager.setOnline(true);
});

/**
 * Answers the catalog with the products named. The shop window's other
 * requests (banners, categories, the featured row, which is the same path
 * with ?featured=true) get empty answers: these tests are about the list.
 */
const answerProducts = (...names: string[]) => {
  fakeApi.on("GET", "/v1/products", ({ url }) =>
    json(
      productPage(
        url.searchParams.has("featured")
          ? []
          : names.map((name) => product(name)),
      ),
    ),
  );
  fakeApi.on("GET", "/v1/banners", () => json({ data: [] }));
  fakeApi.on("GET", "/v1/categories", () => json({ data: [] }));
};

/** The query of the n-th catalog list request (not the featured row). */
const productQuery = (n: number) =>
  Object.fromEntries(
    fakeApi
      .requests("GET", "/v1/products")
      .filter((request) => !request.url.searchParams.has("featured"))[n]?.url
      .searchParams ?? [],
  );

describe("Beranda: the route is the state", () => {
  it("reads kategori, q and urut from the link into the request and the caption", async () => {
    answerProducts("Kaos Polos");
    await renderApp("/?kategori=kaos&q=polos&urut=termurah");

    expect(await screen.findByText("Kaos Polos")).toBeOnTheScreen();
    expect(productQuery(0)).toEqual({
      limit: "20",
      category: "kaos",
      q: "polos",
      sort: "price_asc",
    });
    expect(
      screen.getByText('Hasil pencarian "polos" · Harga terendah'),
    ).toBeOnTheScreen();
    expect(screen.getByDisplayValue("polos")).toBeOnTheScreen();
  });

  it("ignores what does not check out: a bad slug, an unknown order", async () => {
    answerProducts("Kaos");
    await renderApp("/?kategori=Bukan%20Slug&urut=acak");

    await screen.findByText("Kaos");
    expect(productQuery(0)).toEqual({ limit: "20", sort: "newest" });
    expect(screen.getByText("Semua produk · Terbaru")).toBeOnTheScreen();
    expect(
      screen.queryByRole("button", { name: /hapus filter/ }),
    ).not.toBeOnTheScreen();
  });

  it("names the category from the cached categories", async () => {
    queryClient.setQueryData(
      ["categories"],
      [category("pakaian", "Pakaian"), category("kaos", "Kaos Pria")],
    );
    answerProducts("Kaos");
    await renderApp("/?kategori=kaos");

    await screen.findByText("Kaos");
    expect(
      screen.getByRole("button", { name: "Kategori Kaos Pria, hapus filter" }),
    ).toBeOnTheScreen();
    // A read of the cache, not a request.
    expect(fakeApi.requests("GET", "/v1/categories")).toHaveLength(0);
  });

  it("falls back to the slug when the categories are not cached", async () => {
    answerProducts("Kaos");
    await renderApp("/?kategori=kaos");

    await screen.findByText("Kaos");
    expect(
      screen.getByRole("button", { name: "Kategori kaos, hapus filter" }),
    ).toBeOnTheScreen();
  });

  it("clearing the category keeps the search and the order", async () => {
    answerProducts("Kaos");
    const app = await renderApp("/?kategori=kaos&q=polos&urut=termahal");
    await screen.findByText("Kaos");

    await userEvent.press(
      screen.getByRole("button", { name: "Kategori kaos, hapus filter" }),
    );

    expect(app.getSearchParams()).toEqual({ q: "polos", urut: "termahal" });
    expect(
      await screen.findByText(/Hasil pencarian "polos"/),
    ).toBeOnTheScreen();
    expect(productQuery(1)).toEqual({
      limit: "20",
      q: "polos",
      sort: "price_desc",
    });
  });
});

describe("Beranda: offline at launch", () => {
  it("waits for the network instead of failing, and loads when it comes", async () => {
    // Airplane mode on before the app opens: no change event ever comes.
    // The app asks for the state when its cache starts listening
    // (src/lib/query-client.ts); in the app that is at start-up, before
    // the first screen. Here the cache's manager already ran in an
    // earlier test, so the test also puts it where start-up would.
    setInitialNetworkState({ isConnected: false });
    onlineManager.setOnline(false);
    answerProducts("Kaos");
    await renderApp("/");

    expect(
      await screen.findByText(
        "Tidak ada koneksi internet. Produk dimuat begitu koneksi kembali.",
      ),
    ).toBeOnTheScreen();
    expect(fakeApi.requests("GET", "/v1/products")).toHaveLength(0);

    await act(() => {
      emitNetworkState({ isConnected: true });
    });
    expect(await screen.findByText("Kaos")).toBeOnTheScreen();
  });
});

describe("Beranda: the search field", () => {
  it("puts a submitted search in the route, trimmed, and the list follows", async () => {
    answerProducts("Kaos");
    const app = await renderApp("/?urut=termurah");
    await screen.findByText("Kaos");

    const field = screen.getByLabelText("Cari produk");
    await userEvent.type(field, "  kaos hitam ");
    await fireEvent(field, "submitEditing");

    expect(app.getSearchParams()).toEqual({
      q: "kaos hitam",
      urut: "termurah",
    });
    expect(
      await screen.findByText('Hasil pencarian "kaos hitam" · Harga terendah'),
    ).toBeOnTheScreen();
    expect(productQuery(1)).toMatchObject({
      q: "kaos hitam",
      sort: "price_asc",
    });
  });

  it("an empty search removes q from the route", async () => {
    answerProducts("Kaos");
    const app = await renderApp("/?q=kaos");
    await screen.findByText("Kaos");

    const field = screen.getByLabelText("Cari produk");
    await userEvent.clear(field);
    await userEvent.type(field, "   ");
    await fireEvent(field, "submitEditing");

    expect(app.getSearchParams()).toEqual({});
    expect(await screen.findByText("Semua produk · Terbaru")).toBeOnTheScreen();
  });

  it("starts the field again when the route's search changes from elsewhere", async () => {
    answerProducts("Kaos");
    const app = await renderApp("/?q=kaos");
    await screen.findByText("Kaos");
    await userEvent.type(screen.getByLabelText("Cari produk"), " lagi");
    expect(screen.getByDisplayValue("kaos lagi")).toBeOnTheScreen();

    // A deep link (or any other screen) sets a new search.
    await act(() => {
      router.setParams({ q: "topi" });
    });

    expect(app.getSearchParams()).toEqual({ q: "topi" });
    expect(await screen.findByDisplayValue("topi")).toBeOnTheScreen();
  });
});

// The badge is hidden from screen readers on purpose (the button's label
// already says what is applied), so RNTL only finds it when asked to look
// at hidden elements.
const HIDDEN_TOO = { includeHiddenElements: true };

describe("Beranda: the filter button", () => {
  it("opens the filter sheet over Beranda, labelled with what is applied", async () => {
    answerProducts("Kaos");
    const app = await renderApp("/?kategori=kaos&q=polos&urut=termahal");
    await screen.findByText("Kaos");

    await userEvent.press(
      screen.getByRole("button", {
        name: "Filter dan urutan, saat ini Harga tertinggi, kategori kaos",
      }),
    );

    expect(await screen.findByText("Terapkan")).toBeOnTheScreen();
    // A sheet, not a route: the screen underneath is still Beranda.
    expect(app.getPathname()).toBe("/");
    expect(app.getSearchParams()).toEqual({
      kategori: "kaos",
      q: "polos",
      urut: "termahal",
    });
  });

  it("says the default order when the route has none, and shows no badge", async () => {
    answerProducts("Kaos");
    await renderApp("/");
    await screen.findByText("Kaos");

    const button = screen.getByRole("button", {
      name: "Filter dan urutan, saat ini Terbaru",
    });
    expect(button).toBeOnTheScreen();
    expect(within(button).queryByText("1", HIDDEN_TOO)).not.toBeOnTheScreen();
    expect(within(button).queryByText("2", HIDDEN_TOO)).not.toBeOnTheScreen();
  });

  it("shows a badge counting the filters that differ from the default", async () => {
    answerProducts("Kaos");
    await renderApp("/?kategori=kaos&urut=termurah");
    await screen.findByText("Kaos");

    const button = screen.getByRole("button", {
      name: /^Filter dan urutan, saat ini Harga terendah/,
    });
    expect(within(button).getByText("2", HIDDEN_TOO)).toBeOnTheScreen();
  });

  it("counts only the order when no category is set", async () => {
    answerProducts("Kaos");
    await renderApp("/?urut=termurah");
    await screen.findByText("Kaos");

    const button = screen.getByRole("button", {
      name: "Filter dan urutan, saat ini Harga terendah",
    });
    expect(within(button).getByText("1", HIDDEN_TOO)).toBeOnTheScreen();
  });

  it("is a button, never a link, with a 48 dp touch target", async () => {
    answerProducts("Kaos");
    await renderApp("/");
    await screen.findByText("Kaos");

    const button = screen.getByRole("button", {
      name: "Filter dan urutan, saat ini Terbaru",
    });
    expect(screen.queryByRole("link", { name: /Filter/ })).toBeNull();
    // 24 dp icon + 2 x 12 = 48 dp, Android's smallest touch target.
    expect(button).toHaveProp("hitSlop", 12);
  });
});

describe("Beranda: the top bar", () => {
  it("is a header named GoShop, clear of the status bar", async () => {
    answerProducts("Kaos");
    await renderApp("/");
    await screen.findByText("Kaos");

    const title = screen.getByRole("header", { name: "GoShop" });
    // The test renderer's safe area has no insets: 8 and 16 on top of them.
    expect(title.parent).toHaveStyle({
      paddingTop: 8,
      paddingLeft: 16,
      paddingRight: 16,
    });
  });
});

describe("Beranda: the shop window", () => {
  const featured = product("Jaket Unggulan");

  /** The three window requests with content; the catalog has one product. */
  const answerWindow = () => {
    fakeApi.on("GET", "/v1/products", ({ url }) =>
      json(
        productPage(
          url.searchParams.has("featured")
            ? [featured]
            : [product("Kaos Katalog")],
        ),
      ),
    );
    fakeApi.on("GET", "/v1/banners", () =>
      json({
        data: [
          {
            id: "00000000-0000-4000-8000-0000000000a1",
            title: "Diskon Kaos",
            subtitle: null,
            cta_label: "Lihat kaos",
            link_category_slug: "kaos",
            background_color: "#1E40AF",
          },
        ],
      }),
    );
    fakeApi.on("GET", "/v1/categories", () =>
      json({ data: [category("kaos", "Kaos"), category("celana", "Celana")] }),
    );
  };

  it("shows banners, categories and featured products above the catalog", async () => {
    answerWindow();
    await renderApp("/");

    expect(await screen.findByText("Diskon Kaos")).toBeOnTheScreen();
    expect(
      await screen.findByRole("button", { name: "Kategori Celana" }),
    ).toBeOnTheScreen();
    expect(await screen.findByText("Jaket Unggulan")).toBeOnTheScreen();
    expect(screen.getByText("Kaos Katalog")).toBeOnTheScreen();
    expect(
      screen.getByRole("header", { name: "Produk unggulan" }),
    ).toBeOnTheScreen();
  });

  it.each(["/?q=polos", "/?kategori=kaos"])(
    "is hidden when the route narrows the catalog (%s), and asks for nothing of it",
    async (url) => {
      answerWindow();
      await renderApp(url);

      await screen.findByText("Kaos Katalog");
      expect(screen.queryByText("Diskon Kaos")).not.toBeOnTheScreen();
      expect(
        screen.queryByRole("header", { name: "Produk unggulan" }),
      ).not.toBeOnTheScreen();
      expect(fakeApi.requests("GET", "/v1/banners")).toHaveLength(0);
    },
  );

  it("a category chip sets ?kategori= and keeps the order", async () => {
    answerWindow();
    const app = await renderApp("/?urut=termurah");

    await userEvent.press(
      await screen.findByRole("button", { name: "Kategori Celana" }),
    );

    expect(app.getSearchParams()).toEqual({
      kategori: "celana",
      urut: "termurah",
    });
    await waitFor(() => {
      expect(screen.queryByText("Diskon Kaos")).not.toBeOnTheScreen();
    });
  });

  it("a banner tap opens its category", async () => {
    answerWindow();
    const app = await renderApp("/");

    await userEvent.press(
      await screen.findByRole("button", {
        name: "Banner 1 dari 1. Diskon Kaos. Lihat kaos",
      }),
    );

    expect(app.getSearchParams()).toEqual({ kategori: "kaos" });
  });

  it("one failing section leaves the other two working", async () => {
    fakeApi.once("GET", "/v1/banners", () => apiError(500, "INTERNAL", "r-9"));
    answerWindow();
    await renderApp("/");

    expect(
      await screen.findByRole("button", { name: "Coba lagi" }),
    ).toBeOnTheScreen();
    expect(
      await screen.findByRole("button", { name: "Kategori Celana" }),
    ).toBeOnTheScreen();
    expect(await screen.findByText("Jaket Unggulan")).toBeOnTheScreen();
  });

  it("pull to refresh refetches the banners, categories and featured row with the list", async () => {
    answerWindow();
    await renderApp("/");
    await screen.findByText("Jaket Unggulan");
    await screen.findByText("Diskon Kaos");
    const before = (path: string) => fakeApi.requests("GET", path).length;
    const banners = before("/v1/banners");
    const categories = before("/v1/categories");
    const products = before("/v1/products");

    await act(() => {
      fireEvent(refreshControl(), "refresh");
    });

    await waitFor(() => {
      expect(before("/v1/banners")).toBe(banners + 1);
    });
    expect(before("/v1/categories")).toBe(categories + 1);
    // The list's first page and the featured row.
    expect(before("/v1/products")).toBe(products + 2);
  });
});

describe("Beranda: applying the filter sheet", () => {
  const openSheet = async () => {
    await userEvent.press(
      screen.getByRole("button", { name: /^Filter dan urutan, saat ini/ }),
    );
    await screen.findByText("Terapkan");
  };

  it("writes ?kategori= and ?urut= to the route and keeps the search", async () => {
    fakeApi.on("GET", "/v1/categories", () =>
      json({ data: [category("kaos", "Kaos")] }),
    );
    answerProducts("Kaos");
    const app = await renderApp("/?q=polos");
    await screen.findByText("Kaos");
    await openSheet();

    await userEvent.press(await screen.findByRole("radio", { name: "Kaos" }));
    await userEvent.press(screen.getByRole("radio", { name: "Harga terendah" }));
    await userEvent.press(screen.getByRole("button", { name: "Terapkan" }));

    expect(app.getSearchParams()).toEqual({
      q: "polos",
      kategori: "kaos",
      urut: "termurah",
    });
  });

  it("leaves urut out of the route when the order is the default", async () => {
    answerProducts("Kaos");
    const app = await renderApp("/?urut=termahal");
    await screen.findByText("Kaos");
    await openSheet();

    await userEvent.press(screen.getByRole("radio", { name: "Terbaru" }));
    await userEvent.press(screen.getByRole("button", { name: "Terapkan" }));

    expect(app.getSearchParams()).toEqual({});
  });
});
