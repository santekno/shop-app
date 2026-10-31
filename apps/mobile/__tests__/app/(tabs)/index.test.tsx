import { afterEach, describe, expect, it } from "@jest/globals";
import { onlineManager } from "@tanstack/react-query";
import { router } from "expo-router";
import {
  act,
  fireEvent,
  screen,
  userEvent,
} from "@testing-library/react-native";

import { queryClient } from "@/lib/query-client";
import { emitNetworkState, setInitialNetworkState } from "@/test/expo-network";
import { fakeApi, json } from "@/test/fake-api";
import { category, product, productPage } from "@/test/fixtures";
import { renderApp } from "@/test/router";

afterEach(() => {
  queryClient.clear();
  onlineManager.setOnline(true);
});

/** Answers every product request with the products named. */
const answerProducts = (...names: string[]) => {
  fakeApi.on("GET", "/v1/products", () =>
    json(productPage(names.map((name) => product(name)))),
  );
};

/** The query of the n-th GET /v1/products, as an object. */
const productQuery = (n: number) =>
  Object.fromEntries(
    fakeApi.requests("GET", "/v1/products")[n]?.url.searchParams ?? [],
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

// Link asChild gives the Pressable role="link", which React Native ranks
// above its accessibilityRole="button": a screen reader says "link".
describe("Beranda: the sort button", () => {
  it("opens the sort sheet with every filter, labelled with the current order", async () => {
    answerProducts("Kaos");
    const app = await renderApp("/?kategori=kaos&q=polos&urut=termahal");
    await screen.findByText("Kaos");

    await userEvent.press(
      screen.getByRole("link", { name: "Urutkan, saat ini Harga tertinggi" }),
    );

    expect(app.getPathname()).toBe("/filter");
    expect(app.getSearchParams()).toEqual({
      kategori: "kaos",
      q: "polos",
      urut: "termahal",
    });
  });

  it("passes the default order when the route has none", async () => {
    answerProducts("Kaos");
    const app = await renderApp("/");
    await screen.findByText("Kaos");

    await userEvent.press(
      screen.getByRole("link", { name: "Urutkan, saat ini Terbaru" }),
    );

    expect(app.getSearchParams()).toEqual({ urut: "terbaru" });
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
