import { describe, expect, it } from "vitest";
import { apiError } from "@/test/checkout-fixtures.ts";
import { payErrorMessage } from "./payment-errors.ts";

describe("payErrorMessage", () => {
  it.each([
    [
      503,
      "PAYMENTS_DISABLED",
      "Pembayaran sedang tidak tersedia di toko ini. Coba lagi nanti.",
    ],
    [
      409,
      "PAYMENT_WINDOW_CLOSED",
      "Batas waktu pembayaran pesanan ini sudah terlalu dekat, jadi pembayaran tidak bisa dimulai lagi.",
    ],
    [409, "INVALID_TRANSITION", "Pesanan ini sudah tidak menunggu pembayaran."],
    [
      503,
      "UPSTREAM_UNAVAILABLE",
      "Layanan pembayaran sedang tidak menjawab. Coba lagi sebentar lagi.",
    ],
    [
      200,
      "INVALID_RESPONSE",
      "Halaman pembayaran yang diterima tidak valid. Coba lagi, atau hubungi kami bila terus terjadi.",
    ],
    [
      401,
      "UNAUTHORIZED",
      "Sesi Anda sudah berakhir. Masuk lagi untuk membayar.",
    ],
  ])("explains %i %s", (status, code, message) => {
    expect(payErrorMessage(apiError(status, code))).toBe(message);
  });

  it("falls back to the storefront's general messages", () => {
    expect(payErrorMessage(apiError(429, "RATE_LIMITED"))).toBe(
      "Terlalu banyak permintaan. Tunggu sebentar, lalu coba lagi.",
    );
    expect(payErrorMessage(new Error("boom"))).toBe(
      "Terjadi kesalahan saat memuat data. Coba lagi.",
    );
  });
});
