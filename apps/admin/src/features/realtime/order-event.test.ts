import type { AdminOrderEvent } from "@goshop/shared";
import { describe, expect, it } from "vitest";
import { plain } from "@/test/text.ts";
import {
  isNewPaidOrder,
  newOrderMessage,
  parseOrderEvent,
} from "./order-event.ts";

const paid: AdminOrderEvent = {
  type: "order.paid",
  order_id: "o-1",
  code: "GS-20261023-ABC123",
  status: "paid",
  total: { amount: 117_000, currency: "IDR" },
  occurred_at: "2026-10-23T03:00:00Z",
};

describe("parseOrderEvent", () => {
  it("returns the event when it matches the contract", () => {
    expect(parseOrderEvent(JSON.stringify(paid))).toEqual(paid);
  });

  it.each([
    "order.created",
    "order.processing",
    "order.shipped",
    "order.completed",
    "order.cancelled",
  ])("accepts %s", (type) => {
    expect(parseOrderEvent(JSON.stringify({ ...paid, type }))?.type).toBe(type);
  });

  it.each([
    ["not JSON", "{"],
    ["null", "null"],
    ["a string", '"order.paid"'],
    ["an unknown type", JSON.stringify({ ...paid, type: "order.refunded" })],
    ["no total", JSON.stringify({ ...paid, total: undefined })],
    [
      "a total that is not an object",
      JSON.stringify({ ...paid, total: 117000 }),
    ],
    [
      "an amount as text",
      JSON.stringify({ ...paid, total: { amount: "117000", currency: "IDR" } }),
    ],
    ["no currency", JSON.stringify({ ...paid, total: { amount: 1 } })],
    ["no order_id", JSON.stringify({ ...paid, order_id: undefined })],
    ["a numeric code", JSON.stringify({ ...paid, code: 1 })],
    ["no status", JSON.stringify({ ...paid, status: undefined })],
    ["no occurred_at", JSON.stringify({ ...paid, occurred_at: undefined })],
  ])("is null for %s", (_name, data) => {
    expect(parseOrderEvent(data)).toBeNull();
  });
});

describe("isNewPaidOrder", () => {
  it("is true only for order.paid", () => {
    expect(isNewPaidOrder(paid)).toBe(true);
    expect(isNewPaidOrder({ ...paid, type: "order.created" })).toBe(false);
    expect(isNewPaidOrder({ ...paid, type: "order.processing" })).toBe(false);
  });
});

describe("newOrderMessage", () => {
  it("names the order and its total", () => {
    expect(plain(newOrderMessage(paid))).toBe(
      "Pesanan baru GS-20261023-ABC123 · Rp 117.000",
    );
  });
});
