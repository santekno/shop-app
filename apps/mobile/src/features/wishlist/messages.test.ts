import { describe, expect, it } from "@jest/globals";
import { ApiError } from "@goshop/shared";

import {
  DEFAULT_WISHLIST_MAX,
  SIGN_IN_MESSAGE,
  SignInRequiredError,
  wishlistErrorMessage,
} from "./messages";

const api = (
  status: number,
  code: string,
  details: Record<string, unknown> = {},
) => new ApiError({ status, code, message: "x", details });

describe("wishlistErrorMessage", () => {
  it("asks to sign in when there was no token to send", () => {
    expect(new SignInRequiredError().message).toBe(SIGN_IN_MESSAGE);
    expect(wishlistErrorMessage(new SignInRequiredError())).toBe(
      "Masuk dulu untuk menyimpan wishlist",
    );
  });

  it("409 WISHLIST_LIMIT_REACHED names the limit the server sent", () => {
    expect(
      wishlistErrorMessage(api(409, "WISHLIST_LIMIT_REACHED", { max: 150 })),
    ).toBe("Wishlist penuh (maksimal 150 produk). Hapus satu produk dulu.");
  });

  it("409 without a number in details falls back to 200", () => {
    expect(DEFAULT_WISHLIST_MAX).toBe(200);
    expect(wishlistErrorMessage(api(409, "WISHLIST_LIMIT_REACHED"))).toBe(
      "Wishlist penuh (maksimal 200 produk). Hapus satu produk dulu.",
    );
    expect(
      wishlistErrorMessage(api(409, "WISHLIST_LIMIT_REACHED", { max: "lots" })),
    ).toBe("Wishlist penuh (maksimal 200 produk). Hapus satu produk dulu.");
  });

  it.each([
    [
      401,
      "UNAUTHORIZED",
      "Sesi Anda berakhir. Masuk lagi untuk mengubah wishlist.",
    ],
    [403, "FORBIDDEN", "Wishlist hanya untuk akun pembeli."],
    [404, "NOT_FOUND", "Produk ini sudah tidak tersedia."],
  ])("%i is worded for the buyer", (status, code, message) => {
    expect(wishlistErrorMessage(api(status, code))).toBe(message);
  });

  it.each([
    ["a server error", api(500, "INTERNAL_ERROR")],
    ["a network failure", api(0, "NETWORK_ERROR")],
    ["a plain Error", new Error("boom")],
    ["a string", "boom"],
  ])("says to check the connection for %s", (_name, error) => {
    expect(wishlistErrorMessage(error)).toBe(
      "Wishlist belum bisa diubah. Periksa koneksi Anda, lalu coba lagi.",
    );
  });
});
