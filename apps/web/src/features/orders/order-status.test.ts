import type { OrderLatestPayment, OrderStatus } from "@goshop/shared";
import { describe, expect, it } from "vitest";
import { latestPayment, order } from "@/test/checkout-fixtures.ts";
import {
  ORDER_STATUS_LABEL,
  canStartPayment,
  orderStatusText,
  payButtonText,
  paymentAttempt,
  paymentEndedUnpaid,
  paymentOutcome,
} from "./order-status.ts";
import type { PaymentAttempt } from "./order-status.ts";

const DEADLINE = Date.parse("2026-10-31T00:00:00Z");
const MINUTE = 60_000;

describe("orderStatusText", () => {
  it.each<[OrderStatus, string]>([
    ["pending_payment", "Menunggu pembayaran"],
    ["paid", "Dibayar"],
    ["processing", "Diproses penjual"],
    ["shipped", "Dikirim"],
    ["completed", "Selesai"],
    ["cancelled", "Dibatalkan"],
  ])("reads %s as %s", (status, text) => {
    expect(ORDER_STATUS_LABEL[status]).toBe(text);
    expect(orderStatusText({ status, cancel_reason: null })).toBe(text);
  });

  it.each([
    ["payment_expired", "Dibatalkan: waktu pembayaran habis"],
    ["buyer_cancelled", "Dibatalkan: dibatalkan oleh anda"],
    ["seller_cancelled", "Dibatalkan: dibatalkan oleh penjual"],
  ] as const)(
    "says why a cancelled order was cancelled (%s)",
    (reason, text) => {
      expect(
        orderStatusText({ status: "cancelled", cancel_reason: reason }),
      ).toBe(text);
    },
  );
});

describe("paymentOutcome", () => {
  it.each<[OrderStatus, string]>([
    ["pending_payment", "pending"],
    ["paid", "paid"],
    ["processing", "paid"],
    ["shipped", "paid"],
    ["completed", "paid"],
  ])("reads %s as %s", (status, outcome) => {
    expect(paymentOutcome({ status, cancel_reason: null })).toBe(outcome);
  });

  it("tells an expired payment from another cancellation", () => {
    expect(
      paymentOutcome({ status: "cancelled", cancel_reason: "payment_expired" }),
    ).toBe("expired");
    expect(
      paymentOutcome({ status: "cancelled", cancel_reason: "buyer_cancelled" }),
    ).toBe("cancelled");
    expect(paymentOutcome({ status: "cancelled", cancel_reason: null })).toBe(
      "cancelled",
    );
  });
});

describe("paymentAttempt", () => {
  it("is none before the first payment", () => {
    expect(paymentAttempt({ latest_payment: null })).toBe("none");
  });

  it.each<[OrderLatestPayment["status"], PaymentAttempt]>([
    ["pending", "open"],
    ["challenge", "open"],
    ["paid", "confirming"],
    ["denied", "denied"],
    ["failed", "failed"],
    ["cancelled", "cancelled"],
    ["expired", "expired"],
    ["refunded", "none"],
    ["partially_refunded", "none"],
  ])("reads a %s payment as %s", (status, attempt) => {
    expect(paymentAttempt({ latest_payment: latestPayment(status) })).toBe(
      attempt,
    );
  });
});

describe("paymentEndedUnpaid", () => {
  it.each<[PaymentAttempt, boolean]>([
    ["none", false],
    ["open", false],
    ["confirming", false],
    ["denied", true],
    ["failed", true],
    ["cancelled", true],
    ["expired", true],
  ])("%s → %s", (attempt, ended) => {
    expect(paymentEndedUnpaid(attempt)).toBe(ended);
  });
});

describe("canStartPayment", () => {
  it("allows a waiting order with more than two minutes left", () => {
    expect(canStartPayment(order(), DEADLINE - 2 * MINUTE - 1)).toBe(true);
  });

  it("refuses at two minutes or less before the deadline, and after it", () => {
    expect(canStartPayment(order(), DEADLINE - 2 * MINUTE)).toBe(false);
    expect(canStartPayment(order(), DEADLINE - MINUTE)).toBe(false);
    expect(canStartPayment(order(), DEADLINE + MINUTE)).toBe(false);
  });

  it("refuses an order that no longer waits for payment", () => {
    for (const status of ["paid", "cancelled", "shipped"] as const) {
      expect(canStartPayment(order({ status }), DEADLINE - 60 * MINUTE)).toBe(
        false,
      );
    }
  });

  it("refuses while Midtrans has said paid and the order catches up", () => {
    const confirming = order({ latest_payment: latestPayment("paid") });
    expect(canStartPayment(confirming, DEADLINE - 60 * MINUTE)).toBe(false);
  });

  it("allows paying again after a refused payment", () => {
    const denied = order({ latest_payment: latestPayment("denied") });
    expect(canStartPayment(denied, DEADLINE - 60 * MINUTE)).toBe(true);
  });
});

describe("payButtonText", () => {
  it.each<[OrderLatestPayment["status"] | null, string]>([
    [null, "Bayar sekarang"],
    ["pending", "Lanjutkan pembayaran"],
    ["challenge", "Lanjutkan pembayaran"],
    ["denied", "Coba bayar lagi"],
    ["failed", "Coba bayar lagi"],
    ["cancelled", "Coba bayar lagi"],
    ["expired", "Coba bayar lagi"],
    ["refunded", "Bayar sekarang"],
  ])("a %s payment reads %s", (status, text) => {
    expect(
      payButtonText({
        latest_payment: status === null ? null : latestPayment(status),
      }),
    ).toBe(text);
  });
});
