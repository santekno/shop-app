import { describe, expect, it } from "vitest";
import {
  loadOrderDetailPage,
  loadOrdersPage,
  loadPaymentPage,
  loadPaymentReturnPage,
} from "./lazy.ts";

describe("the orders' lazy pages", () => {
  it("load the module of each page", async () => {
    expect((await loadPaymentPage()).PaymentPage).toBeTypeOf("function");
    expect((await loadPaymentReturnPage()).PaymentReturnPage).toBeTypeOf(
      "function",
    );
    expect((await loadOrdersPage()).OrdersPage).toBeTypeOf("function");
    expect((await loadOrderDetailPage()).OrderDetailPage).toBeTypeOf(
      "function",
    );
  });
});
