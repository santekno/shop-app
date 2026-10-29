import { ApiError } from "@goshop/shared";
import { describe, expect, it } from "vitest";
import { cartErrorMessage, cartLineErrorMessage } from "./cart-errors.ts";

const apiError = (code: string, details: Record<string, unknown> = {}) =>
  new ApiError({ status: 409, code, message: "x", details });

describe("cartErrorMessage", () => {
  it("says how many units are available for INSUFFICIENT_STOCK", () => {
    expect(
      cartErrorMessage(apiError("INSUFFICIENT_STOCK", { available: 3 })),
    ).toBe(
      "Stok tidak cukup. Tersedia 3, termasuk yang sudah ada di keranjang Anda.",
    );
    expect(
      cartErrorMessage(apiError("INSUFFICIENT_STOCK", { available: 0 })),
    ).toBe(
      "Stok tidak cukup. Tersedia 0, termasuk yang sudah ada di keranjang Anda.",
    );
  });

  it("falls back to a general stock message without a numeric available", () => {
    expect(cartErrorMessage(apiError("INSUFFICIENT_STOCK"))).toBe(
      "Stok tidak cukup untuk jumlah ini.",
    );
    expect(
      cartErrorMessage(apiError("INSUFFICIENT_STOCK", { available: "3" })),
    ).toBe("Stok tidak cukup untuk jumlah ini.");
  });

  it.each([
    ["QUANTITY_LIMIT", "Satu barang paling banyak 99 buah per keranjang."],
    [
      "CART_FULL",
      "Keranjang sudah berisi 50 jenis barang. Hapus salah satu dulu.",
    ],
    ["VARIANT_UNAVAILABLE", "Varian ini sudah tidak dijual."],
    [
      "CART_NOT_FOUND",
      "Keranjang sebelumnya sudah tidak berlaku. Silakan tambahkan lagi.",
    ],
  ])("has its own message for %s", (code, message) => {
    expect(cartErrorMessage(apiError(code))).toBe(message);
  });

  it.each([
    [
      "NETWORK_ERROR",
      "Tidak dapat terhubung ke server GoShop. Periksa koneksi internet Anda, lalu coba lagi.",
    ],
    [
      "CLIENT_TIMEOUT",
      "Server GoShop terlalu lama merespons. Coba lagi sebentar lagi.",
    ],
    [
      "TIMEOUT",
      "Server GoShop terlalu lama merespons. Coba lagi sebentar lagi.",
    ],
    [
      "RATE_LIMITED",
      "Terlalu banyak permintaan. Tunggu sebentar, lalu coba lagi.",
    ],
  ])("uses the storefront's general message for %s", (code, message) => {
    expect(cartErrorMessage(apiError(code))).toBe(message);
  });

  it("says the session ended for UNAUTHORIZED (a logged-in add)", () => {
    expect(
      cartErrorMessage(
        new ApiError({ status: 401, code: "UNAUTHORIZED", message: "x" }),
      ),
    ).toBe("Sesi Anda sudah berakhir. Masuk lagi, lalu tambahkan barang ini.");
  });

  it.each([
    ["another API error", apiError("INTERNAL_ERROR")],
    ["a plain Error", new Error("x")],
    ["undefined", undefined],
  ])("says the item did not go in for %s", (_, error) => {
    expect(cartErrorMessage(error)).toBe(
      "Barang belum masuk ke keranjang. Coba lagi.",
    );
  });
});

describe("cartLineErrorMessage", () => {
  it("names the whole stock for INSUFFICIENT_STOCK (the quantity replaces the line's)", () => {
    expect(
      cartLineErrorMessage(apiError("INSUFFICIENT_STOCK", { available: 4 })),
    ).toBe("Stok tidak cukup. Tersedia 4.");
  });

  it("falls back to a general stock message without a numeric available", () => {
    expect(cartLineErrorMessage(apiError("INSUFFICIENT_STOCK"))).toBe(
      "Stok tidak cukup untuk jumlah ini.",
    );
  });

  it.each([
    [
      "VARIANT_UNAVAILABLE",
      409,
      "Varian ini sudah tidak dijual. Hapus dari keranjang.",
    ],
    ["NOT_FOUND", 404, "Barang ini sudah tidak ada di keranjang Anda."],
    ["CART_NOT_FOUND", 404, "Barang ini sudah tidak ada di keranjang Anda."],
    [
      "UNAUTHORIZED",
      401,
      "Sesi Anda sudah berakhir. Masuk lagi, lalu ubah keranjang Anda.",
    ],
  ])("has its own message for %s", (code, status, message) => {
    expect(
      cartLineErrorMessage(new ApiError({ status, code, message: "x" })),
    ).toBe(message);
  });

  it.each([
    [
      "NETWORK_ERROR",
      "Tidak dapat terhubung ke server GoShop. Periksa koneksi internet Anda, lalu coba lagi.",
    ],
    [
      "TIMEOUT",
      "Server GoShop terlalu lama merespons. Coba lagi sebentar lagi.",
    ],
    [
      "CLIENT_TIMEOUT",
      "Server GoShop terlalu lama merespons. Coba lagi sebentar lagi.",
    ],
    [
      "RATE_LIMITED",
      "Terlalu banyak permintaan. Tunggu sebentar, lalu coba lagi.",
    ],
  ])("uses the storefront's general message for %s", (code, message) => {
    expect(cartLineErrorMessage(apiError(code))).toBe(message);
  });

  it.each([
    ["an add-only code", apiError("QUANTITY_LIMIT")],
    ["another API error", apiError("INTERNAL_ERROR")],
    ["a plain Error", new Error("x")],
  ])("says the cart did not change for %s", (_, error) => {
    expect(cartLineErrorMessage(error)).toBe(
      "Keranjang belum berubah. Coba lagi.",
    );
  });
});
