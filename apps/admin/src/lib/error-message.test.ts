import { ApiError } from "@goshop/shared";
import { describe, expect, it } from "vitest";
import { errorMessage, errorRequestId } from "./error-message.ts";

const apiError = (code: string, requestId?: string) =>
  new ApiError({ status: 0, code, message: "x", requestId });

describe("errorMessage", () => {
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
    [
      "FORBIDDEN",
      "Peran akun Anda tidak boleh membuka data ini. Jika peran Anda baru saja diubah, muat ulang halaman.",
    ],
  ])("says what to do for %s", (code, message) => {
    expect(errorMessage(apiError(code))).toBe(message);
  });

  it.each([
    ["INTERNAL_ERROR", apiError("INTERNAL_ERROR")],
    ["NOT_FOUND", apiError("NOT_FOUND")],
    ["a plain Error", new Error("boom")],
    ["a string", "boom"],
  ])("falls back to a general sentence for %s", (_name, error) => {
    expect(errorMessage(error)).toBe(
      "Terjadi kesalahan saat memuat data. Coba lagi.",
    );
  });
});

describe("errorRequestId", () => {
  it("is the API's X-Request-ID", () => {
    expect(errorRequestId(apiError("INTERNAL_ERROR", "req-42"))).toBe("req-42");
  });

  it("is undefined for an ApiError without one, or another error", () => {
    expect(errorRequestId(apiError("NETWORK_ERROR"))).toBeUndefined();
    expect(errorRequestId(new Error("boom"))).toBeUndefined();
  });
});
