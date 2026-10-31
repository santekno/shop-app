import { describe, expect, it } from "@jest/globals";
import { ApiError } from "@goshop/shared";

import { errorMessage, errorRequestId } from "./error-message";

const apiError = (code: string, requestId?: string) =>
  new ApiError({ status: 0, code, message: "test", requestId });

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
    ["INTERNAL", "Terjadi kesalahan saat memuat data. Coba lagi."],
    ["UNKNOWN_CATEGORY", "Terjadi kesalahan saat memuat data. Coba lagi."],
  ])("says what %s means to the buyer", (code, message) => {
    expect(errorMessage(apiError(code))).toBe(message);
  });

  it.each([
    ["a plain Error", new Error("NETWORK_ERROR")],
    ["a string", "boom"],
    ["undefined", undefined],
  ])("falls back to the general sentence for %s", (_name, error) => {
    expect(errorMessage(error)).toBe(
      "Terjadi kesalahan saat memuat data. Coba lagi.",
    );
  });
});

describe("errorRequestId", () => {
  it("is the X-Request-ID the API sent", () => {
    expect(errorRequestId(apiError("INTERNAL", "req-123"))).toBe("req-123");
  });

  it("is undefined when the API sent none, or for any other error", () => {
    expect(errorRequestId(apiError("NETWORK_ERROR"))).toBeUndefined();
    expect(errorRequestId(new Error("x"))).toBeUndefined();
    expect(errorRequestId({ requestId: "forged" })).toBeUndefined();
  });
});
