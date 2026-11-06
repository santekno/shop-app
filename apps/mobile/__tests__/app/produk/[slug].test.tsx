import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { onlineManager } from "@tanstack/react-query";
import { act, screen, userEvent } from "@testing-library/react-native";
import { AccessibilityInfo } from "react-native";
import { formatRupiah } from "@goshop/shared";

import { useRecentStore } from "@/features/recent/store";
import { queryClient } from "@/lib/query-client";
import { emitNetworkState, setInitialNetworkState } from "@/test/expo-network";
import { apiError, deferred, fakeApi, json } from "@/test/fake-api";
import { product } from "@/test/fixtures";
import { answerEmptyCatalog, headerTitles, renderApp } from "@/test/router";

afterEach(() => {
  useRecentStore.setState({ items: [] });
  queryClient.clear();
  onlineManager.setOnline(true);
  setInitialNetworkState({ isConnected: true, isInternetReachable: true });
});

/** A product with a cheap M in stock, an XL that costs more, and a sold-out S. */
const kaos = () => {
  const base = product("Kaos Polos Hitam", { slug: "kaos-polos-hitam" });
  const variant = (
    id: string,
    name: string,
    amount: number,
    stock: number,
  ) => ({
    id,
    sku: `kaos-${name}`,
    name,
    price: { amount, currency: "IDR" as const },
    stock,
  });
  return {
    ...base,
    price_from: { amount: 89_000, currency: "IDR" as const },
    variants: [
      variant("00000000-0000-4000-8000-0000000000a1", "S", 89_000, 0),
      variant("00000000-0000-4000-8000-0000000000a2", "M", 89_000, 3),
      variant("00000000-0000-4000-8000-0000000000a3", "XL", 99_000, 20),
    ],
  };
};

const answerProduct = (slug: string, body: unknown) => {
  fakeApi.on("GET", `/v1/products/${slug}`, () => json({ data: body }));
};

describe("the product screen: states", () => {
  it("draws the page's outline while the product loads", async () => {
    answerEmptyCatalog();
    const answer = deferred();
    fakeApi.on("GET", "/v1/products/kaos-polos-hitam", answer.handler);
    await renderApp("/produk/kaos-polos-hitam");

    expect(
      screen.getByRole("progressbar", { name: "Memuat produk…" }),
    ).toBeOnTheScreen();
    expect(headerTitles()).toEqual(["Produk"]);

    await act(async () => {
      answer.resolve(json({ data: kaos() }));
      await Promise.resolve();
    });
    expect(
      await screen.findByRole("header", { name: "Kaos Polos Hitam" }),
    ).toBeOnTheScreen();
    expect(screen.queryByRole("progressbar")).not.toBeOnTheScreen();
  });

  it("asks the API for the slug, decoded from the link and encoded in the path", async () => {
    answerEmptyCatalog();
    answerProduct("kaos%20polos", kaos());
    await renderApp("/produk/kaos%20polos");

    await screen.findByRole("header", { name: "Kaos Polos Hitam" });
    expect(fakeApi.requests("GET", "/v1/products/kaos%20polos")).toHaveLength(
      1,
    );
  });

  it("says the product was not found, without a retry that would fail the same way", async () => {
    answerEmptyCatalog();
    fakeApi.on("GET", "/v1/products/hilang", () => apiError(404, "NOT_FOUND"));
    await renderApp("/produk/hilang");

    expect(
      await screen.findByText("Produk tidak ditemukan."),
    ).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: "Coba lagi" })).toBeNull();
    expect(headerTitles()).toEqual(["Produk"]);
  });

  it("shows other failures with the request ID, and Coba lagi loads the product", async () => {
    answerEmptyCatalog();
    fakeApi.once("GET", "/v1/products/kaos-polos-hitam", () =>
      apiError(500, "INTERNAL", "req-77"),
    );
    answerProduct("kaos-polos-hitam", kaos());
    await renderApp("/produk/kaos-polos-hitam");

    expect(
      await screen.findByText("Terjadi kesalahan saat memuat data. Coba lagi."),
    ).toBeOnTheScreen();
    expect(screen.getByText("Kode permintaan: req-77")).toBeOnTheScreen();

    await userEvent.press(screen.getByRole("button", { name: "Coba lagi" }));

    expect(
      await screen.findByRole("header", { name: "Kaos Polos Hitam" }),
    ).toBeOnTheScreen();
    expect(screen.queryByText("Kode permintaan: req-77")).toBeNull();
    expect(
      fakeApi.requests("GET", "/v1/products/kaos-polos-hitam"),
    ).toHaveLength(2);
  });

  it("waits for the network instead of failing, and loads when it is back", async () => {
    setInitialNetworkState({ isConnected: false });
    onlineManager.setOnline(false);
    answerEmptyCatalog();
    answerProduct("kaos-polos-hitam", kaos());
    await renderApp("/produk/kaos-polos-hitam");

    expect(
      await screen.findByText(
        "Tidak ada koneksi internet. Produk dimuat begitu koneksi kembali.",
      ),
    ).toBeOnTheScreen();
    expect(
      fakeApi.requests("GET", "/v1/products/kaos-polos-hitam"),
    ).toHaveLength(0);

    await act(() => {
      emitNetworkState({ isConnected: true });
    });
    expect(
      await screen.findByRole("header", { name: "Kaos Polos Hitam" }),
    ).toBeOnTheScreen();
  });
});

describe("the product screen: the loaded product", () => {
  it("shows the name, category, the first buyable variant's price and stock, and the description", async () => {
    answerEmptyCatalog();
    answerProduct("kaos-polos-hitam", kaos());
    await renderApp("/produk/kaos-polos-hitam");

    await screen.findByRole("header", { name: "Kaos Polos Hitam" });
    expect(screen.getByText("Kaos")).toBeOnTheScreen();
    // S is sold out, so M is the one on screen.
    expect(
      screen.getByLabelText("Rp 89.000, Stok tinggal 3"),
    ).toBeOnTheScreen();
    expect(screen.getByText("Kaos Polos Hitam.")).toBeOnTheScreen();
    expect(headerTitles()).toEqual(["Kaos Polos Hitam"]);
  });

  it("choosing a variant changes the price and stock, and tells VoiceOver on iOS", async () => {
    answerEmptyCatalog();
    answerProduct("kaos-polos-hitam", kaos());
    const announce = jest
      .spyOn(AccessibilityInfo, "announceForAccessibility")
      .mockClear();
    await renderApp("/produk/kaos-polos-hitam");
    await screen.findByRole("header", { name: "Kaos Polos Hitam" });
    announce.mockClear();

    await userEvent.press(screen.getByRole("radio", { name: "XL, Rp 99.000" }));

    expect(screen.getByRole("radio", { name: "XL, Rp 99.000" })).toBeChecked();
    expect(
      screen.getByRole("radio", { name: "M, Rp 89.000" }),
    ).not.toBeChecked();
    expect(screen.getByLabelText("Rp 99.000, Stok tersedia")).toBeOnTheScreen();
    expect(announce).toHaveBeenCalledTimes(1);
    // formatRupiah puts a non-breaking space after "Rp".
    expect(announce).toHaveBeenCalledWith(
      `XL, ${formatRupiah({ amount: 99_000, currency: "IDR" })}, Stok tersedia`,
    );
  });

  it("does nothing when a sold-out variant is pressed", async () => {
    answerEmptyCatalog();
    answerProduct("kaos-polos-hitam", kaos());
    const announce = jest.spyOn(AccessibilityInfo, "announceForAccessibility");
    await renderApp("/produk/kaos-polos-hitam");
    await screen.findByRole("header", { name: "Kaos Polos Hitam" });
    announce.mockClear();

    await userEvent.press(
      screen.getByRole("radio", { name: "S, Rp 89.000, stok habis" }),
    );

    expect(screen.getByRole("radio", { name: "M, Rp 89.000" })).toBeChecked();
    expect(announce).not.toHaveBeenCalled();
  });

  it("records the product in Terakhir dilihat only after it loaded", async () => {
    answerEmptyCatalog();
    fakeApi.on("GET", "/v1/products/hilang", () => apiError(404, "NOT_FOUND"));
    await renderApp("/produk/hilang");
    await screen.findByText("Produk tidak ditemukan.");

    expect(useRecentStore.getState().items).toEqual([]);
  });

  it("records a loaded product as the newest in Terakhir dilihat", async () => {
    answerEmptyCatalog();
    answerProduct("kaos-polos-hitam", kaos());
    await renderApp("/produk/kaos-polos-hitam");
    await screen.findByRole("header", { name: "Kaos Polos Hitam" });

    expect(useRecentStore.getState().items.map((item) => item.slug)).toEqual([
      "kaos-polos-hitam",
    ]);
  });
});
