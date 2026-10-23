import { ApiError } from "@goshop/shared";
import { describe, expect, it } from "vitest";
import { errorMessage, errorRequestId } from "./error-message.ts";

const apiError = (code: string, requestId?: string) =>
  new ApiError({ status: 0, code, message: "developer text", requestId });

const FALLBACK = "Terjadi kesalahan saat memuat data. Coba lagi.";
const TIMEOUT =
  "Server GoShop terlalu lama merespons. Coba lagi sebentar lagi.";

describe("errorMessage", () => {
  it("has its own message for a network error", () => {
    expect(errorMessage(apiError("NETWORK_ERROR"))).toBe(
      "Tidak dapat terhubung ke server GoShop. Periksa koneksi internet Anda, lalu coba lagi.",
    );
  });

  it("gives the client's and the server's timeout the same message", () => {
    expect(errorMessage(apiError("CLIENT_TIMEOUT"))).toBe(TIMEOUT);
    expect(errorMessage(apiError("TIMEOUT"))).toBe(TIMEOUT);
  });

  it("has its own message for rate limiting", () => {
    expect(errorMessage(apiError("RATE_LIMITED"))).toBe(
      "Terlalu banyak permintaan. Tunggu sebentar, lalu coba lagi.",
    );
  });

  it.each([
    ["another API code", apiError("INTERNAL_ERROR")],
    ["an unknown API code", apiError("SOMETHING_NEW")],
    ["a plain Error", new Error("NETWORK_ERROR")],
    ["a look-alike object", { code: "NETWORK_ERROR" }],
    ["a string", "TIMEOUT"],
    ["undefined", undefined],
  ])("falls back to a general message for %s", (_, error) => {
    expect(errorMessage(error)).toBe(FALLBACK);
  });

  it("never shows the API's developer message", () => {
    expect(errorMessage(apiError("INTERNAL_ERROR"))).not.toContain(
      "developer text",
    );
  });
});

describe("errorRequestId", () => {
  it("returns the request ID of an ApiError", () => {
    expect(errorRequestId(apiError("INTERNAL_ERROR", "req-7"))).toBe("req-7");
  });

  it.each([
    ["an ApiError without one", apiError("NETWORK_ERROR")],
    ["a plain Error", new Error("x")],
    ["a look-alike object", { requestId: "req-7" }],
    ["null", null],
  ])("returns undefined for %s", (_, error) => {
    expect(errorRequestId(error)).toBeUndefined();
  });
});
