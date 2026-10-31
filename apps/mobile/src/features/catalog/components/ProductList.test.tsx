import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import { onlineManager } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  screen,
  userEvent,
} from "@testing-library/react-native";
import { router } from "expo-router";
import { Platform } from "react-native";

import { apiError, deferred, fakeApi, json } from "@/test/fake-api";
import { product, productPage } from "@/test/fixtures";
import { isRefreshingShown, refreshControl, scrollView } from "@/test/list";
import { renderWithProviders } from "@/test/render";
import type { ProductListFilters } from "../api/products";
import { ProductList } from "./ProductList";

const NEWEST: ProductListFilters = { sort: "newest" };

const renderList = (props: Partial<Parameters<typeof ProductList>[0]> = {}) =>
  renderWithProviders(
    <ProductList
      filters={NEWEST}
      caption="Semua produk · Terbaru"
      {...props}
    />,
  );

const productRequests = () => fakeApi.requests("GET", "/v1/products");
const cursors = () =>
  productRequests().map((r) => r.url.searchParams.get("cursor"));

/** Answers the next product request with these names (and a cursor). */
const answerPage = (names: string[], nextCursor: string | null = null) => {
  fakeApi.once("GET", "/v1/products", () =>
    json(
      productPage(
        names.map((name) => product(name)),
        nextCursor,
      ),
    ),
  );
};

/**
 * TanStack Query tells components about a change on the next task
 * (notifyManager's setTimeout 0), not at once: wait for it, so the list
 * has re-rendered with the new state before the next event.
 */
const nextTask = () =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });

/**
 * Forty cards are twenty rows of the 100-dp cells FlashList's Jest setup
 * measures: more than two 900-dp screens, so the end is not near when the
 * list opens and nothing loads until the test says so.
 */
const forty = Array.from({ length: 40 }, (_, i) => `P${i + 1}`);

/** Pulls the list down, as the buyer does with a finger. */
const pull = () => fireEvent(refreshControl(), "refresh");

let push: jest.SpiedFunction<typeof router.push>;

beforeEach(() => {
  push = jest.spyOn(router, "push").mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
  onlineManager.setOnline(true);
});

describe("ProductList: the first page", () => {
  it("shows a spinner until the first page arrives, then the cards", async () => {
    const answer = deferred();
    fakeApi.once("GET", "/v1/products", answer.handler);
    await renderList();

    expect(
      screen.getByRole("progressbar", { name: "Memuat produk…" }),
    ).toBeOnTheScreen();
    expect(screen.getByText("Semua produk · Terbaru")).toBeOnTheScreen();

    await act(async () => {
      answer.resolve(json(productPage([product("Kaos"), product("Topi")])));
      await Promise.resolve();
    });

    expect(await screen.findByText("Kaos")).toBeOnTheScreen();
    expect(screen.getByText("Topi")).toBeOnTheScreen();
    expect(screen.queryByRole("progressbar")).not.toBeOnTheScreen();
    expect(
      screen.getByText("Semua produk sudah ditampilkan."),
    ).toBeOnTheScreen();
  });

  it("waits without a network instead of failing, and loads when it is back", async () => {
    onlineManager.setOnline(false);
    answerPage(["Kaos"]);
    await renderList();

    expect(
      screen.getByText(
        "Tidak ada koneksi internet. Produk dimuat begitu koneksi kembali.",
      ),
    ).toBeOnTheScreen();
    expect(screen.queryByRole("progressbar")).not.toBeOnTheScreen();
    expect(productRequests()).toHaveLength(0);

    await act(async () => {
      onlineManager.setOnline(true);
      await Promise.resolve();
    });

    expect(await screen.findByText("Kaos")).toBeOnTheScreen();
    expect(productRequests()).toHaveLength(1);
  });

  it("shows a failed first page with its request ID, and Coba lagi loads it", async () => {
    fakeApi.once("GET", "/v1/products", () =>
      apiError(500, "INTERNAL", "req-9"),
    );
    await renderList();

    expect(
      await screen.findByText("Terjadi kesalahan saat memuat data. Coba lagi."),
    ).toBeOnTheScreen();
    expect(screen.getByText("Kode permintaan: req-9")).toBeOnTheScreen();

    const retry = deferred();
    fakeApi.once("GET", "/v1/products", retry.handler);
    await userEvent.press(screen.getByRole("button", { name: "Coba lagi" }));

    // While the retry runs, the spinner replaces the old error.
    expect(
      screen.getByRole("progressbar", { name: "Memuat produk…" }),
    ).toBeOnTheScreen();
    expect(screen.queryByText("Kode permintaan: req-9")).not.toBeOnTheScreen();

    await act(async () => {
      retry.resolve(json(productPage([product("Kaos")])));
      await Promise.resolve();
    });
    expect(await screen.findByText("Kaos")).toBeOnTheScreen();
    expect(productRequests()).toHaveLength(2);
  });

  it("says an unknown category does not exist, with a way back to every product", async () => {
    fakeApi.once("GET", "/v1/products", () =>
      apiError(400, "UNKNOWN_CATEGORY"),
    );
    const onClear = jest.fn();
    await renderList({
      filters: { category: "hilang", sort: "newest" },
      category: { name: "hilang", onClear },
    });

    expect(
      await screen.findByText("Kategori ini tidak ada."),
    ).toBeOnTheScreen();
    expect(
      screen.queryByRole("button", { name: "Coba lagi" }),
    ).not.toBeOnTheScreen();

    await userEvent.press(
      screen.getByRole("button", { name: "Lihat semua produk" }),
    );
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it("treats UNKNOWN_CATEGORY as a plain error when no category is shown", async () => {
    fakeApi.once("GET", "/v1/products", () =>
      apiError(400, "UNKNOWN_CATEGORY"),
    );
    await renderList();

    expect(
      await screen.findByText("Terjadi kesalahan saat memuat data. Coba lagi."),
    ).toBeOnTheScreen();
    expect(screen.queryByText("Kategori ini tidak ada.")).not.toBeOnTheScreen();
  });

  it.each([
    ["no filter", NEWEST, "Belum ada produk."],
    ["a search", { q: "zzz", sort: "newest" }, "Tidak ada produk yang cocok."],
    [
      "a category",
      { category: "topi", sort: "newest" },
      "Tidak ada produk yang cocok.",
    ],
  ] as const)(
    "says why the list is empty with %s",
    async (_name, filters, message) => {
      answerPage([]);
      await renderList({ filters });

      expect(await screen.findByText(message)).toBeOnTheScreen();
      expect(
        screen.queryByText("Semua produk sudah ditampilkan."),
      ).not.toBeOnTheScreen();
    },
  );
});

describe("ProductList: header", () => {
  it("shows the category as a chip that clears the filter", async () => {
    answerPage(["Kaos"]);
    const onClear = jest.fn();
    await renderList({
      filters: { category: "kaos", sort: "newest" },
      category: { name: "Kaos Pria", onClear },
    });

    await screen.findByText("Kaos");
    await userEvent.press(
      screen.getByRole("button", { name: "Kategori Kaos Pria, hapus filter" }),
    );
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it("has no chip without a category", async () => {
    answerPage(["Kaos"]);
    await renderList();
    await screen.findByText("Kaos");

    expect(
      screen.queryByRole("button", { name: /hapus filter/ }),
    ).not.toBeOnTheScreen();
  });
});

describe("ProductList: a card", () => {
  it("opens the product's own screen by its slug", async () => {
    fakeApi.once("GET", "/v1/products", () =>
      json(productPage([product("Kaos Polos", { slug: "kaos-polos-hitam" })])),
    );
    await renderList();

    await userEvent.press(
      await screen.findByRole("button", { name: "Kaos Polos, Rp 89.000" }),
    );

    expect(push).toHaveBeenCalledWith({
      pathname: "/produk/[slug]",
      params: { slug: "kaos-polos-hitam" },
    });
  });
});

describe("ProductList: pull to refresh", () => {
  it("shows the spinner during the pull and the new first page after it", async () => {
    answerPage(["Kaos"]);
    await renderList();
    await screen.findByText("Kaos");
    expect(isRefreshingShown()).toBe(false);

    const answer = deferred();
    fakeApi.once("GET", "/v1/products", answer.handler);
    await pull();
    expect(isRefreshingShown()).toBe(true);

    await act(async () => {
      answer.resolve(json(productPage([product("Topi")])));
      await Promise.resolve();
    });
    expect(await screen.findByText("Topi")).toBeOnTheScreen();
    expect(isRefreshingShown()).toBe(false);
    expect(screen.queryByText("Kaos")).not.toBeOnTheScreen();
  });

  it("does not show the pull spinner for a background refetch", async () => {
    answerPage(["Kaos"]);
    const { client } = await renderList();
    await screen.findByText("Kaos");

    const background = deferred();
    fakeApi.once("GET", "/v1/products", background.handler);
    await act(async () => {
      void client.refetchQueries();
      await nextTask();
    });

    expect(productRequests()).toHaveLength(2);
    expect(isRefreshingShown()).toBe(false);
    await act(async () => {
      background.resolve(json(productPage([product("Kaos")])));
      await nextTask();
    });
  });

  it("after a failed background refetch of two pages, Coba lagi reloads the first page only", async () => {
    answerPage(["A", "B"], "c1");
    answerPage(["C"], null);
    const { client } = await renderList();
    await screen.findByText("C");

    // Back to the app: the refetch of both pages fails on the first.
    fakeApi.once("GET", "/v1/products", () => apiError(500, "INTERNAL", "r-8"));
    await act(async () => {
      void client.refetchQueries();
      await nextTask();
    });
    expect(await screen.findByText("Kode permintaan: r-8")).toBeOnTheScreen();
    expect(screen.getByText("C")).toBeOnTheScreen();

    // A full first page that still has a next one: a refetch would carry
    // on to page 2 by itself (and fail on the unanswered request), a
    // refresh stops after page 1. Forty cards keep the list's end out of
    // reach, so the list does not ask for page 2 either.
    answerPage(forty, "c1");
    await userEvent.press(screen.getByRole("button", { name: "Coba lagi" }));

    expect(await screen.findByText("P1")).toBeOnTheScreen();
    await act(nextTask);
    // refresh, not refetch: one request for page 1, not page 1 and 2.
    expect(cursors()).toEqual([null, "c1", null, null]);
  });

  it("keeps the rows after a failed pull, with the error above them and a retry", async () => {
    answerPage(["Kaos"]);
    await renderList();
    await screen.findByText("Kaos");

    fakeApi.once("GET", "/v1/products", () => apiError(500, "INTERNAL", "r-5"));
    await pull();

    expect(await screen.findByText("Kode permintaan: r-5")).toBeOnTheScreen();
    expect(screen.getByText("Kaos")).toBeOnTheScreen();

    answerPage(["Kaos", "Topi"]);
    await userEvent.press(screen.getByRole("button", { name: "Coba lagi" }));

    expect(await screen.findByText("Topi")).toBeOnTheScreen();
    expect(screen.queryByText("Kode permintaan: r-5")).not.toBeOnTheScreen();
    // The retry is a refresh: the first page only, no cursor.
    expect(cursors()).toEqual([null, null, null]);
  });

  it("does not put the refresh error over an empty list", async () => {
    answerPage([]);
    await renderList();
    await screen.findByText("Belum ada produk.");

    fakeApi.once("GET", "/v1/products", () => apiError(500, "INTERNAL", "r-6"));
    await pull();
    await act(nextTask);
    expect(isRefreshingShown()).toBe(false);

    expect(productRequests()).toHaveLength(2);
    expect(screen.queryByText("Kode permintaan: r-6")).not.toBeOnTheScreen();
    expect(screen.getByText("Belum ada produk.")).toBeOnTheScreen();
  });

  it("paints the spinner in the theme's primary colour", async () => {
    answerPage(["Kaos"]);
    await renderList();
    await screen.findByText("Kaos");

    const element = scrollView().props.refreshControl as {
      props: Record<string, unknown>;
    };
    expect(element.props.colors).toEqual(["#0b5cad"]);
    expect(element.props.tintColor).toBe("#0b5cad");
    expect(element.props.progressBackgroundColor).toBe("#ffffff");
  });
});

describe("ProductList: the next page", () => {
  it("loads the next page near the end, with a spinner below the rows", async () => {
    answerPage(["A", "B"], "c1");
    const next = deferred();
    fakeApi.once("GET", "/v1/products", next.handler);
    await renderList();

    expect(
      await screen.findByRole("progressbar", {
        name: "Memuat produk berikutnya…",
      }),
    ).toBeOnTheScreen();
    expect(screen.getByText("A")).toBeOnTheScreen();

    await act(async () => {
      next.resolve(json(productPage([product("C")], null)));
      await Promise.resolve();
    });
    expect(await screen.findByText("C")).toBeOnTheScreen();
    expect(
      screen.getByText("Semua produk sudah ditampilkan."),
    ).toBeOnTheScreen();
    expect(cursors()).toEqual([null, "c1"]);
  });

  it("asks for a page once, however often the end is reached while it loads", async () => {
    answerPage(["A", "B"], "c1");
    const next = deferred();
    fakeApi.once("GET", "/v1/products", next.handler);
    await renderList();
    await screen.findByRole("progressbar", {
      name: "Memuat produk berikutnya…",
    });

    await fireEvent(scrollView(), "endReached");
    await fireEvent(scrollView(), "endReached");

    expect(cursors()).toEqual([null, "c1"]);
    await act(async () => {
      next.resolve(json(productPage([product("C")], null)));
      await Promise.resolve();
    });
    await screen.findByText("C");
  });

  it("asks for the next page when the buyer nears the end", async () => {
    answerPage(forty, "c1");
    await renderList();
    await screen.findByText("P1");
    expect(cursors()).toEqual([null]);

    // One screen's height before the end (the threshold is in visible
    // lengths), so the page usually arrives before the buyer gets there.
    // Jest has no scrolling to measure: the value is pinned here, and
    // endReached is fired by hand.
    expect(scrollView()).toHaveProp("onEndReachedThreshold", 1);
    answerPage(["Q"], null);
    await fireEvent(scrollView(), "endReached");

    // Q is row 21, beyond what FlashList draws; the footer shows the page
    // arrived and was the last.
    expect(
      await screen.findByText("Semua produk sudah ditampilkan."),
    ).toBeOnTheScreen();
    expect(cursors()).toEqual([null, "c1"]);
  });

  it("does not ask for the next page during a background refetch", async () => {
    answerPage(forty, "c1");
    const { client } = await renderList();
    await screen.findByText("P1");

    // A refetch (focus, reconnect, stale data) is running.
    const refetch = deferred();
    fakeApi.once("GET", "/v1/products", refetch.handler);
    await act(async () => {
      void client.refetchQueries();
      await nextTask();
    });
    await fireEvent(scrollView(), "endReached");

    expect(cursors()).toEqual([null, null]);
    // The one-row list the refetch brings ends on screen, so once the
    // refetch is over its next page is asked for, and answered.
    answerPage(["R2"], null);
    await act(async () => {
      refetch.resolve(json(productPage([product("R1")], "c1")));
      await Promise.resolve();
    });
    expect(await screen.findByText("R1")).toBeOnTheScreen();
    expect(await screen.findByText("R2")).toBeOnTheScreen();
    expect(cursors()).toEqual([null, null, "c1"]);
  });

  it("does not retry a failed next page by itself; the footer's Coba lagi does", async () => {
    answerPage(["A", "B"], "c1");
    fakeApi.once("GET", "/v1/products", () =>
      apiError(502, "BAD_GATEWAY", "r-2"),
    );
    // The client retries a 502 once by itself (src/lib/api.ts).
    fakeApi.once("GET", "/v1/products", () =>
      apiError(502, "BAD_GATEWAY", "r-2"),
    );
    await renderList();

    expect(
      await screen.findByText("Kode permintaan: r-2", {}, { timeout: 3000 }),
    ).toBeOnTheScreen();
    await fireEvent(scrollView(), "endReached");
    await fireEvent(scrollView(), "endReached");
    expect(cursors()).toEqual([null, "c1", "c1"]);

    answerPage(["C"], null);
    await userEvent.press(screen.getByRole("button", { name: "Coba lagi" }));
    expect(await screen.findByText("C")).toBeOnTheScreen();
    expect(cursors()).toEqual([null, "c1", "c1", "c1"]);
    expect(screen.getByText("A")).toBeOnTheScreen();
  });

  it("ignores the end of a list with no next page", async () => {
    answerPage(["A"], null);
    await renderList();
    await screen.findByText("Semua produk sudah ditampilkan.");

    await fireEvent(scrollView(), "endReached");
    expect(productRequests()).toHaveLength(1);
  });
});

describe("ProductList: one list per filter", () => {
  it("keeps the list for the same filters, even in a new object", async () => {
    answerPage(["Kaos"]);
    await renderList({ filters: { sort: "newest" } });
    await screen.findByText("Kaos");
    const before = scrollView();

    await screen.rerender(
      <ProductList
        filters={{ sort: "newest" }}
        caption="Semua produk · Terbaru"
      />,
    );

    expect(scrollView()).toBe(before);
    expect(productRequests()).toHaveLength(1);
  });

  it("starts a new list, at the top, for another search, sort or category", async () => {
    answerPage(["Kaos"]);
    await renderList();
    await screen.findByText("Kaos");
    const before = scrollView();

    answerPage(["Topi"]);
    await screen.rerender(
      <ProductList filters={{ q: "topi", sort: "newest" }} caption="Hasil" />,
    );

    expect(await screen.findByText("Topi")).toBeOnTheScreen();
    expect(scrollView()).not.toBe(before);
    expect(productRequests()[1]?.url.searchParams.get("q")).toBe("topi");
  });
});

describe("ProductList: the keyboard", () => {
  it("follows the finger on iOS", async () => {
    answerPage(["Kaos"]);
    await renderList();
    await screen.findByText("Kaos");
    expect(scrollView()).toHaveProp("keyboardDismissMode", "interactive");
    expect(scrollView()).toHaveProp("keyboardShouldPersistTaps", "handled");
  });

  it("uses on-drag on Android", async () => {
    jest.replaceProperty(Platform, "OS", "android");
    answerPage(["Kaos"]);
    await renderList();
    await screen.findByText("Kaos");
    expect(scrollView()).toHaveProp("keyboardDismissMode", "on-drag");
  });
});
