import { ApiError } from "@goshop/shared";
import { describe, expect, it } from "vitest";
import { authErrorMessage } from "./auth-errors.ts";

const apiError = (code: string) =>
  new ApiError({ status: 400, code, message: "x" });

describe("authErrorMessage", () => {
  it("names neither field for INVALID_CREDENTIALS", () => {
    expect(authErrorMessage(apiError("INVALID_CREDENTIALS"))).toBe(
      "Email atau kata sandi salah.",
    );
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
    expect(authErrorMessage(apiError(code))).toBe(message);
  });

  it.each([
    ["VALIDATION_FAILED", apiError("VALIDATION_FAILED")],
    ["INTERNAL_ERROR", apiError("INTERNAL_ERROR")],
    ["a plain Error", new Error("x")],
  ])("asks to check the input for %s", (_, error) => {
    expect(authErrorMessage(error)).toBe(
      "Permintaan tidak berhasil. Periksa isian Anda, lalu coba lagi.",
    );
  });
});
