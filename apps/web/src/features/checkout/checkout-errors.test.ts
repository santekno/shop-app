import { describe, expect, it } from "vitest";
import { apiError } from "@/test/checkout-fixtures.ts";
import { rupiah } from "@/test/fake-api.ts";
import {
  checkoutErrorMessage,
  voucherErrorMessage,
} from "./checkout-errors.ts";

describe("checkoutErrorMessage", () => {
  it.each([
    [
      "SHIPPING_UNAVAILABLE",
      "Tidak ada kurir yang melayani kode pos alamat ini. Pilih atau tambahkan alamat lain.",
    ],
    [
      "UPSTREAM_UNAVAILABLE",
      "Layanan ongkos kirim sedang tidak menjawab. Coba lagi sebentar lagi.",
    ],
    ["CART_EMPTY", "Keranjang Anda kosong. Tambahkan barang dulu."],
    [
      "CART_CHANGED",
      "Keranjang Anda berubah saat pesanan dibuat (misalnya dari perangkat lain). Periksa ringkasan di bawah, lalu coba lagi.",
    ],
    [
      "CHECKOUT_PROBLEMS",
      "Ada barang yang tidak bisa dibeli seperti sekarang. Perbaiki di keranjang, lalu kembali ke sini.",
    ],
    [
      "EMAIL_UNVERIFIED",
      "Verifikasi email Anda dulu sebelum membuat pesanan. Buka tautan verifikasi yang kami kirim ke email Anda.",
    ],
    [
      "TOO_MANY_PENDING_ORDERS",
      "Anda sudah punya 5 pesanan yang belum dibayar. Bayar atau batalkan salah satunya dulu.",
    ],
    [
      "VALIDATION_FAILED",
      "Alamat atau layanan kurir yang dipilih sudah tidak berlaku. Pilih lagi.",
    ],
    ["UNAUTHORIZED", "Sesi Anda sudah berakhir. Masuk lagi untuk melanjutkan."],
  ])("explains %s", (code, expected) => {
    expect(checkoutErrorMessage(apiError(409, code))).toBe(expected);
  });

  it("gives a refused voucher's reason", () => {
    expect(
      checkoutErrorMessage(
        apiError(409, "VOUCHER_NOT_APPLICABLE", { reason: "expired" }),
      ),
    ).toBe("Voucher ini sudah tidak berlaku.");
  });

  it("falls back to the storefront's general text", () => {
    expect(checkoutErrorMessage(apiError(429, "RATE_LIMITED"))).toBe(
      "Terlalu banyak permintaan. Tunggu sebentar, lalu coba lagi.",
    );
    expect(checkoutErrorMessage(new Error("x"))).toBe(
      "Terjadi kesalahan saat memuat data. Coba lagi.",
    );
  });
});

describe("voucherErrorMessage", () => {
  const refused = (details: Record<string, unknown>) =>
    apiError(409, "VOUCHER_NOT_APPLICABLE", details);

  it.each([
    ["expired", "Voucher ini sudah tidak berlaku."],
    ["exhausted", "Kuota voucher ini sudah habis."],
    [
      "per_user_limit",
      "Anda sudah memakai voucher ini sebanyak batas yang boleh.",
    ],
    ["not_found", "Kode voucher tidak ditemukan."],
    ["not_started", "Kode voucher tidak ditemukan."],
  ])("explains the reason %s", (reason, expected) => {
    expect(voucherErrorMessage(refused({ reason }))).toBe(expected);
  });

  it("names the minimum spend when the API sends it", () => {
    expect(
      voucherErrorMessage(
        refused({
          reason: "min_spend",
          min_spend: { amount: 150_000, currency: "IDR" },
        }),
      ),
    ).toBe(`Voucher ini berlaku untuk belanja minimal ${rupiah(150_000)}.`);
  });

  it.each([
    ["missing", undefined],
    ["null", null],
    ["without an amount", { currency: "IDR" }],
    ["with a text amount", { amount: "150000" }],
  ])("says only 'below the minimum' when min_spend is %s", (_, minSpend) => {
    expect(
      voucherErrorMessage(
        refused({ reason: "min_spend", min_spend: minSpend }),
      ),
    ).toBe("Belanja Anda belum mencapai minimum voucher ini.");
  });

  it("hands any other error to checkoutErrorMessage", () => {
    expect(voucherErrorMessage(apiError(409, "CART_EMPTY"))).toBe(
      "Keranjang Anda kosong. Tambahkan barang dulu.",
    );
  });
});
