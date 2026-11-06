import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import { onlineManager } from "@tanstack/react-query";
import { fireEvent, screen, userEvent } from "@testing-library/react-native";
import { router } from "expo-router";

import { apiError, deferred, fakeApi, json } from "@/test/fake-api";
import { product, productPage } from "@/test/fixtures";
import { scrollView } from "@/test/list";
import { renderWithProviders } from "@/test/render";
import { getAccessToken } from "../auth-seam";
import { WishlistScreenView } from "./WishlistScreenView";

jest.mock("../auth-seam", () => ({ getAccessToken: jest.fn(() => null) }));

const signIn = () => {
  jest.mocked(getAccessToken).mockReturnValue("t");
};

beforeEach(() => {
  jest.spyOn(router, "push").mockImplementation(() => undefined);
});

afterEach(() => {
  jest.mocked(getAccessToken).mockReturnValue(null);
  jest.restoreAllMocks();
  onlineManager.setOnline(true);
});

// The hearts on the cards ask for the saved slugs too (limit 100); these
// are the screen's own pages (limit 20).
const pagesAsked = () =>
  fakeApi
    .requests("GET", "/v1/me/wishlist")
    .filter((request) => request.url.searchParams.get("limit") === "20")
    .map((request) => request.url.searchParams.get("cursor"));

describe("WishlistScreenView", () => {
  it("signed out: asks to sign in and calls no API", async () => {
    await renderWithProviders(<WishlistScreenView />);

    expect(
      screen.getByText("Masuk dulu untuk menyimpan wishlist."),
    ).toBeTruthy();
    expect(fakeApi.requests()).toHaveLength(0);
  });

  it("shows a loading state until the first page arrives", async () => {
    signIn();
    const answer = deferred();
    fakeApi.on("GET", "/v1/me/wishlist", answer.handler);
    await renderWithProviders(<WishlistScreenView />);

    expect(
      screen.getByRole("progressbar", { name: "Memuat wishlist…" }),
    ).toBeTruthy();

    answer.resolve(json(productPage([product("Kaos Polos")])));
    expect(await screen.findByText("Kaos Polos")).toBeTruthy();
    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  it("lists the saved products, newest first, and opens one on tap", async () => {
    signIn();
    fakeApi.on("GET", "/v1/me/wishlist", () =>
      json(productPage([product("Kaos Polos"), product("Celana Chino")])),
    );
    await renderWithProviders(<WishlistScreenView />);

    await userEvent.press(await screen.findByText("Celana Chino"));

    expect(screen.getByText("Kaos Polos")).toBeTruthy();
    expect(router.push).toHaveBeenCalledWith({
      pathname: "/produk/[slug]",
      params: { slug: "celana-chino" },
    });
    expect(
      fakeApi
        .requests("GET", "/v1/me/wishlist")[0]
        ?.url.searchParams.get("limit"),
    ).toBe("20");
  });

  it("says how to save something when the list is empty", async () => {
    signIn();
    fakeApi.on("GET", "/v1/me/wishlist", () => json(productPage([])));
    await renderWithProviders(<WishlistScreenView />);

    expect(
      await screen.findByText(
        "Belum ada produk di wishlist. Ketuk ikon hati pada produk untuk menyimpannya.",
      ),
    ).toBeTruthy();
  });

  it("failed: shows the error and retries on 'Coba lagi'", async () => {
    signIn();
    fakeApi.once("GET", "/v1/me/wishlist", () =>
      apiError(500, "INTERNAL_ERROR", "req-77"),
    );
    fakeApi.on("GET", "/v1/me/wishlist", () =>
      json(productPage([product("Kaos Polos")])),
    );
    await renderWithProviders(<WishlistScreenView />);

    expect(
      await screen.findByText("Terjadi kesalahan saat memuat data. Coba lagi."),
    ).toBeTruthy();
    expect(screen.getByText("Kode permintaan: req-77")).toBeTruthy();
    await userEvent.press(screen.getByRole("button", { name: "Coba lagi" }));

    expect(await screen.findByText("Kaos Polos")).toBeTruthy();
    expect(screen.queryByText("Kode permintaan: req-77")).toBeNull();
  });

  it("offline at the first load: says it loads when the connection returns", async () => {
    signIn();
    onlineManager.setOnline(false);
    fakeApi.on("GET", "/v1/me/wishlist", () =>
      json(productPage([product("Kaos Polos")])),
    );
    await renderWithProviders(<WishlistScreenView />);

    expect(
      await screen.findByText(
        "Tidak ada koneksi internet. Wishlist dimuat begitu koneksi kembali.",
      ),
    ).toBeTruthy();
    expect(fakeApi.requests()).toHaveLength(0);

    onlineManager.setOnline(true);
    expect(await screen.findByText("Kaos Polos")).toBeTruthy();
  });

  it("near the end of the list, loads the next page with the cursor", async () => {
    signIn();
    fakeApi.on("GET", "/v1/me/wishlist", ({ url }) =>
      url.searchParams.get("cursor") === "c2"
        ? json(productPage([product("Topi")], null))
        : json(productPage([product("Kaos Polos")], "c2")),
    );
    await renderWithProviders(<WishlistScreenView />);
    await screen.findByText("Kaos Polos");

    await fireEvent(scrollView(), "onEndReached");

    expect(await screen.findByText("Topi")).toBeTruthy();
    expect(pagesAsked()).toEqual([null, "c2"]);
  });

  it("at the end of the last page, asks for nothing more", async () => {
    signIn();
    fakeApi.on("GET", "/v1/me/wishlist", () =>
      json(productPage([product("Kaos Polos")], null)),
    );
    await renderWithProviders(<WishlistScreenView />);
    await screen.findByText("Kaos Polos");

    await fireEvent(scrollView(), "onEndReached");
    await Promise.resolve();

    expect(pagesAsked()).toEqual([null]);
  });
});
