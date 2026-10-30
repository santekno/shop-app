import { describe, expect, it } from "vitest";
import type { OrderStatus } from "@goshop/shared";
import {
  COURIER_LABEL,
  DEFAULT_QUEUE_STATUS,
  ORDER_STATUS_OPTIONS,
  QUEUE_HINT,
  courierText,
  orderStatusLabel,
  orderStatusText,
  queueHref,
  readQueueStatus,
} from "./order-status.ts";

const search = (query: string) => new URLSearchParams(query);

describe("ORDER_STATUS_OPTIONS", () => {
  it("lists the life cycle in order, each with its URL word and label", () => {
    expect(
      ORDER_STATUS_OPTIONS.map(({ value, param, label }) => [
        value,
        param,
        label,
      ]),
    ).toEqual([
      ["pending_payment", "menunggu-bayar", "Belum dibayar"],
      ["paid", "dibayar", "Dibayar"],
      ["processing", "diproses", "Diproses"],
      ["shipped", "dikirim", "Dikirim"],
      ["completed", "selesai", "Selesai"],
      ["cancelled", "dibatalkan", "Dibatalkan"],
    ]);
    expect(DEFAULT_QUEUE_STATUS).toBe("paid");
  });

  it("has a hint for every status", () => {
    for (const { value } of ORDER_STATUS_OPTIONS) {
      expect(QUEUE_HINT[value]).not.toBe("");
    }
  });
});

describe("readQueueStatus", () => {
  it.each([
    ["status=menunggu-bayar", "pending_payment"],
    ["status=dibayar", "paid"],
    ["status=diproses", "processing"],
    ["status=dikirim", "shipped"],
    ["status=selesai", "completed"],
    ["status=dibatalkan", "cancelled"],
  ])("reads ?%s as %s", (query, status) => {
    expect(readQueueStatus(search(query))).toBe(status);
  });

  it.each([
    ["no parameter", ""],
    ["an unknown word", "status=terkirim"],
    ["the API's own value", "status=shipped"],
    ["an empty value", "status="],
    ["a different case", "status=Dikirim"],
  ])("falls back to the paid queue for %s", (_name, query) => {
    expect(readQueueStatus(search(query))).toBe("paid");
  });
});

describe("queueHref", () => {
  it("is plain /pesanan for the default queue", () => {
    expect(queueHref("paid")).toBe("/pesanan");
  });

  it.each<[OrderStatus, string]>([
    ["pending_payment", "/pesanan?status=menunggu-bayar"],
    ["processing", "/pesanan?status=diproses"],
    ["shipped", "/pesanan?status=dikirim"],
    ["completed", "/pesanan?status=selesai"],
    ["cancelled", "/pesanan?status=dibatalkan"],
  ])("links %s to %s, which reads back as the same status", (status, href) => {
    expect(queueHref(status)).toBe(href);
    expect(readQueueStatus(new URL(href, "http://x").searchParams)).toBe(
      status,
    );
  });

  it("is /pesanan for a status the dashboard does not know", () => {
    expect(queueHref("returned" as OrderStatus)).toBe("/pesanan");
  });
});

describe("orderStatusLabel", () => {
  it("names a status as the tabs do", () => {
    expect(orderStatusLabel("pending_payment")).toBe("Belum dibayar");
    expect(orderStatusLabel("shipped")).toBe("Dikirim");
  });

  it("shows an unknown status as the API wrote it", () => {
    expect(orderStatusLabel("returned" as OrderStatus)).toBe("returned");
  });
});

describe("orderStatusText", () => {
  it.each([
    ["payment_expired", "Dibatalkan (waktu pembayaran habis)"],
    ["buyer_cancelled", "Dibatalkan (dibatalkan pembeli)"],
    ["seller_cancelled", "Dibatalkan (dibatalkan toko)"],
  ] as const)(
    "says why a cancelled order was cancelled: %s",
    (reason, text) => {
      expect(orderStatusText("cancelled", reason)).toBe(text);
    },
  );

  it("is the plain label for a cancelled order without a reason", () => {
    expect(orderStatusText("cancelled", null)).toBe("Dibatalkan");
  });

  it("ignores a reason on an order that is not cancelled", () => {
    expect(orderStatusText("paid", "buyer_cancelled")).toBe("Dibayar");
  });
});

describe("courierText", () => {
  it("names the courier by its brand and the service in upper case", () => {
    expect(courierText("jne", "reg")).toBe("JNE REG");
    expect(courierText("jnt", "ez")).toBe("J&T Express EZ");
    expect(courierText("sicepat", "BEST")).toBe("SiCepat BEST");
    expect(COURIER_LABEL.sicepat).toBe("SiCepat");
  });

  it("leaves no trailing space without a service", () => {
    expect(courierText("jne", "")).toBe("JNE");
  });
});
