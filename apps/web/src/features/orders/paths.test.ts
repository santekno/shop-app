import { describe, expect, it } from "vitest";
import { matchPattern } from "@/test/app-routes.ts";
import {
  ORDER_ROUTE,
  PAYMENT_RETURN_PATH,
  PAYMENT_ROUTE,
  orderPath,
  paymentPath,
} from "./paths.ts";

describe("order paths", () => {
  it("puts the order id in one path segment", () => {
    expect(orderPath("order-1")).toBe("/pesanan/order-1");
    expect(paymentPath("order-1")).toBe("/pesanan/order-1/pembayaran");
  });

  it("encodes an id that would add segments or a query", () => {
    expect(orderPath("a/b?c")).toBe("/pesanan/a%2Fb%3Fc");
    expect(paymentPath("../x")).toBe("/pesanan/..%2Fx/pembayaran");
  });

  it("matches the route patterns the pages read their id from", () => {
    const pattern = (route: string) => route.replace(":id", "[id]");
    expect(matchPattern(pattern(ORDER_ROUTE), orderPath("a/b"))).toEqual({
      id: "a/b",
    });
    expect(matchPattern(pattern(PAYMENT_ROUTE), paymentPath("o-1"))).toEqual({
      id: "o-1",
    });
    expect(PAYMENT_RETURN_PATH).toBe("/pembayaran/selesai");
  });
});
