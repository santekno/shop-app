import { afterEach, describe, expect, it } from "@jest/globals";
import { onlineManager } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  screen,
  userEvent,
} from "@testing-library/react-native";

import { queryClient } from "@/lib/query-client";
import { apiError, deferred, fakeApi, json } from "@/test/fake-api";
import { emitNetworkState, setInitialNetworkState } from "@/test/expo-network";
import { category } from "@/test/fixtures";
import { isRefreshingShown, refreshControl } from "@/test/list";
import {
  answerEmptyCatalog,
  flushQueryNotifications,
  renderApp,
} from "@/test/router";

afterEach(() => {
  queryClient.clear();
  onlineManager.setOnline(true);
});

const CATEGORIES = [
  category("pakaian", "Pakaian", null, "p"),
  category("kaos", "Kaos", "p", "k"),
  category("topi", "Topi", null, "t"),
];

const answerCategories = () => {
  fakeApi.once("GET", "/v1/categories", () => json({ data: CATEGORIES }));
};

const categoryRequests = () => fakeApi.requests("GET", "/v1/categories");

/** Opens the Kategori tab (Beranda is mounted under it by the anchor). */
const openKategori = async () => {
  answerEmptyCatalog();
  return renderApp("/kategori");
};

describe("Kategori: before the first list", () => {
  it("shows a spinner while the categories load", async () => {
    const answer = deferred();
    fakeApi.once("GET", "/v1/categories", answer.handler);
    await openKategori();

    expect(screen.getByLabelText("Memuat kategori")).toBeBusy();
    await act(() => {
      answer.resolve(json({ data: CATEGORIES }));
    });
    expect(
      await screen.findByRole("button", { name: "Pakaian" }),
    ).toBeOnTheScreen();
  });

  it("says it waits for the network when the phone is offline, then loads", async () => {
    // Offline before the app opens.
    // The app asks for the state when its cache starts listening
    // (src/lib/query-client.ts); in the app that is at start-up, before
    // the first screen. Here the cache's manager already ran in an
    // earlier test, so the test also puts it where start-up would.
    setInitialNetworkState({ isConnected: false });
    onlineManager.setOnline(false);
    answerCategories();
    await openKategori();

    expect(
      screen.getByText(
        "Tidak ada koneksi internet. Kategori dimuat begitu koneksi kembali.",
      ),
    ).toBeOnTheScreen();
    expect(screen.queryByLabelText("Memuat kategori")).not.toBeOnTheScreen();
    expect(categoryRequests()).toHaveLength(0);

    await act(() => {
      emitNetworkState({ isConnected: true });
    });
    expect(
      await screen.findByRole("button", { name: "Topi" }),
    ).toBeOnTheScreen();
  });

  it("shows a failed load with its request ID; Coba lagi loads the list", async () => {
    fakeApi.once("GET", "/v1/categories", () =>
      apiError(500, "INTERNAL", "req-3"),
    );
    await openKategori();

    expect(await screen.findByText("Kode permintaan: req-3")).toBeOnTheScreen();
    expect(
      screen.getByText("Terjadi kesalahan saat memuat kategori. Coba lagi."),
    ).toBeOnTheScreen();

    const retry = deferred();
    fakeApi.once("GET", "/v1/categories", retry.handler);
    await userEvent.press(screen.getByRole("button", { name: "Coba lagi" }));

    // The retry shows the spinner, not the old error.
    expect(await screen.findByLabelText("Memuat kategori")).toBeOnTheScreen();
    expect(screen.queryByText("Kode permintaan: req-3")).not.toBeOnTheScreen();

    await act(() => {
      retry.resolve(json({ data: CATEGORIES }));
    });
    expect(
      await screen.findByRole("button", { name: "Kaos" }),
    ).toBeOnTheScreen();
    expect(categoryRequests()).toHaveLength(2);
  });
});

describe("Kategori: the list", () => {
  it("keeps the list after a failed refresh, with a note above it", async () => {
    answerCategories();
    await openKategori();
    await screen.findByRole("button", { name: "Pakaian" });

    fakeApi.once("GET", "/v1/categories", () => apiError(500, "INTERNAL"));
    await fireEvent(refreshControl(), "refresh");

    expect(
      await screen.findByText(
        "Gagal memperbarui kategori. Daftar di bawah mungkin belum yang terbaru.",
      ),
    ).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "Pakaian" })).toBeOnTheScreen();
    expect(
      screen.queryByRole("button", { name: "Coba lagi" }),
    ).not.toBeOnTheScreen();

    // The next pull clears the note while it runs, and for good when it
    // succeeds.
    const retry = deferred();
    fakeApi.once("GET", "/v1/categories", retry.handler);
    await fireEvent(refreshControl(), "refresh");
    await flushQueryNotifications();
    expect(
      screen.queryByText(/Gagal memperbarui kategori/),
    ).not.toBeOnTheScreen();
    await act(() => {
      retry.resolve(json({ data: CATEGORIES }));
    });
    await flushQueryNotifications();
    expect(
      screen.queryByText(/Gagal memperbarui kategori/),
    ).not.toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "Pakaian" })).toBeOnTheScreen();
  });

  it("shows the pull spinner during a pull, not during a background refetch", async () => {
    answerCategories();
    await openKategori();
    await screen.findByRole("button", { name: "Pakaian" });

    const background = deferred();
    fakeApi.once("GET", "/v1/categories", background.handler);
    await act(async () => {
      void queryClient.refetchQueries({ queryKey: ["categories"] });
      await Promise.resolve();
    });
    await flushQueryNotifications();
    expect(categoryRequests()).toHaveLength(2);
    expect(isRefreshingShown()).toBe(false);
    await act(() => {
      background.resolve(json({ data: CATEGORIES }));
    });

    const pull = deferred();
    fakeApi.once("GET", "/v1/categories", pull.handler);
    await fireEvent(refreshControl(), "refresh");
    expect(isRefreshingShown()).toBe(true);

    await act(() => {
      pull.resolve(json({ data: CATEGORIES }));
    });
    expect(isRefreshingShown()).toBe(false);
    expect(categoryRequests()).toHaveLength(3);
  });

  it("the pull spinner stops when the pull fails too", async () => {
    answerCategories();
    await openKategori();
    await screen.findByRole("button", { name: "Pakaian" });

    fakeApi.once("GET", "/v1/categories", () => apiError(500, "INTERNAL"));
    await fireEvent(refreshControl(), "refresh");

    await screen.findByText(/Gagal memperbarui kategori/);
    expect(isRefreshingShown()).toBe(false);
  });

  it("opens Beranda filtered by the tapped category", async () => {
    answerCategories();
    const app = await openKategori();

    await userEvent.press(await screen.findByRole("button", { name: "Kaos" }));

    expect(app.getPathname()).toBe("/");
    expect(app.getSearchParams()).toEqual({ kategori: "kaos" });
    // The chip names the category from the cache the tab just filled.
    expect(
      await screen.findByRole("button", {
        name: "Kategori Kaos, hapus filter",
      }),
    ).toBeOnTheScreen();
  });

  it("keeps Beranda's search and order when a category is chosen", async () => {
    answerEmptyCatalog();
    const app = await renderApp("/?q=polos&urut=termurah");
    await screen.findByText('Hasil pencarian "polos" · Harga terendah');

    answerCategories();
    await userEvent.press(
      screen.getByRole("button", { name: "Kategori, tab, 2 of 4" }),
    );
    await userEvent.press(await screen.findByRole("button", { name: "Topi" }));

    expect(app.getPathname()).toBe("/");
    expect(app.getSearchParams()).toEqual({
      q: "polos",
      urut: "termurah",
      kategori: "topi",
    });
    expect(
      await screen.findByText('Hasil pencarian "polos" · Harga terendah'),
    ).toBeOnTheScreen();
    const last = fakeApi.requests("GET", "/v1/products").at(-1);
    expect(Object.fromEntries(last?.url.searchParams ?? [])).toEqual({
      limit: "20",
      category: "topi",
      q: "polos",
      sort: "price_asc",
    });
  });
});
