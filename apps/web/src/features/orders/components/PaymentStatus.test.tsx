import { render, screen } from "@testing-library/react";
import type { Order, OrderLatestPayment } from "@goshop/shared";
import { describe, expect, it } from "vitest";
import { latestPayment, order } from "@/test/checkout-fixtures.ts";
import { formatDateTime } from "../format.ts";
import { PaymentStatus } from "./PaymentStatus.tsx";

const DEADLINE = Date.parse("2026-10-31T00:00:00Z");
const BEFORE = DEADLINE - 60 * 60_000;

const show = (overrides: Partial<Order>, checkedAt = BEFORE) =>
  render(<PaymentStatus order={order(overrides)} checkedAt={checkedAt} />);

const status = () => screen.getByRole("status").textContent;
/** The icon's colour: what kind of answer it is, beside the text. */
const icon = () =>
  document.querySelector("svg[aria-hidden='true']")?.getAttribute("class");

describe("PaymentStatus", () => {
  it("waits for a first payment, with the deadline", () => {
    show({});

    expect(status()).toBe("Menunggu pembayaran.");
    expect(
      screen.getByText(/^Bayar sebelum/).textContent.replace(/\s+/g, " "),
    ).toBe(
      `Bayar sebelum ${formatDateTime("2026-10-31T00:00:00Z")}. Halaman ini diperbarui sendiri begitu pembayaran Anda dikonfirmasi.`,
    );
    expect(icon()).toContain("text-muted-foreground");
  });

  it.each<[OrderLatestPayment["status"], string, string]>([
    ["pending", "Menunggu pembayaran.", "text-muted-foreground"],
    ["challenge", "Menunggu pembayaran.", "text-muted-foreground"],
    ["paid", "Pembayaran sedang dikonfirmasi…", "text-muted-foreground"],
    [
      "denied",
      "Pembayaran ditolak. Coba lagi, dengan metode pembayaran lain bila perlu.",
      "text-destructive",
    ],
    [
      "failed",
      "Pembayaran gagal diproses. Silakan coba lagi.",
      "text-destructive",
    ],
    [
      "cancelled",
      "Pembayaran dibatalkan. Anda masih bisa membayar pesanan ini.",
      "text-destructive",
    ],
    [
      "expired",
      "Sesi pembayaran sebelumnya habis waktunya. Anda masih bisa membayar pesanan ini.",
      "text-destructive",
    ],
    ["refunded", "Menunggu pembayaran.", "text-muted-foreground"],
  ])("says what became of a %s payment", (paymentStatus, text, look) => {
    show({ latest_payment: latestPayment(paymentStatus) });

    expect(status()).toBe(text);
    expect(icon()).toContain(look);
    expect(document.querySelectorAll("svg")).toHaveLength(1);
  });

  it.each([
    ["at", DEADLINE],
    ["after", DEADLINE + 60_000],
  ])(
    "waits for the final word once checked %s the deadline, whatever the last attempt",
    (_, checkedAt) => {
      show({ latest_payment: latestPayment("denied") }, checkedAt);

      expect(status()).toBe(
        "Batas waktu pembayaran sudah lewat. Menunggu konfirmasi akhir…",
      );
      expect(screen.queryByText(/^Bayar sebelum/)).toBeNull();
      expect(icon()).toContain("text-muted-foreground");
    },
  );

  it("says the payment arrived, and when", () => {
    show({ status: "paid", paid_at: "2026-10-30T03:00:00Z" });

    expect(status()).toBe("Pembayaran diterima. Terima kasih!");
    expect(screen.getByText(/^Dibayar/).textContent.replace(/\s+/g, " ")).toBe(
      `Dibayar ${formatDateTime("2026-10-30T03:00:00Z")}. Penjual akan segera memproses pesanan Anda.`,
    );
    expect(icon()).toContain("text-success");
    expect(screen.queryByText(/^Bayar sebelum/)).toBeNull();
  });

  it("reads a shipped order as paid, without paid_at when it has none", () => {
    show({ status: "shipped", paid_at: null });

    expect(status()).toBe("Pembayaran diterima. Terima kasih!");
    expect(screen.queryByText(/^Dibayar/)).toBeNull();
  });

  it("says the payment window closed for an order cancelled by expiry", () => {
    show({
      status: "cancelled",
      cancel_reason: "payment_expired",
      latest_payment: latestPayment("denied"),
    });

    expect(status()).toBe(
      "Waktu pembayaran habis. Pesanan dibatalkan dan stoknya dikembalikan.",
    );
    expect(icon()).toContain("text-destructive");
    expect(document.querySelectorAll("svg")).toHaveLength(1);
  });

  it("says an order cancelled for another reason is cancelled", () => {
    show({ status: "cancelled", cancel_reason: "buyer_cancelled" });

    expect(status()).toBe("Pesanan ini dibatalkan.");
    expect(screen.queryByText(/^Bayar sebelum/)).toBeNull();
  });
});
