import { describe, expect, it } from "vitest";
import type { Cart, CartLine, OrderItem, Product } from "../api/types.ts";
import {
  addPaymentInfoEvent,
  addShippingInfoEvent,
  addToCartEvent,
  beginCheckoutEvent,
  cartLineItem,
  orderLineItem,
  productItem,
  purchaseEvent,
  removeFromCartEvent,
  shippingTier,
  viewItemEvent,
  viewItemListEvent,
} from "./ecommerce.ts";
import type { AnalyticsOrder } from "./ecommerce.ts";

const idr = (amount: number) => ({ amount, currency: "IDR" as const });

const product = (name: string, priceFrom: number): Product => ({
  id: `id-${name}`,
  slug: name.toLowerCase(),
  name,
  description: "Katun.",
  category: { id: "c1", slug: "kaos", name: "Kaos", parent_id: null },
  price_from: idr(priceFrom),
  in_stock: true,
  variants: [],
  images: [],
  created_at: "2026-10-01T00:00:00Z",
  updated_at: "2026-10-01T00:00:00Z",
});

const line = (sku: string, quantity: number, unitPrice: number): CartLine => ({
  variant_id: `v-${sku}`,
  product_id: "p1",
  product_slug: "kaos-polos",
  product_name: "Kaos Polos",
  variant_name: sku.slice(-1),
  sku,
  quantity,
  unit_price: idr(unitPrice),
  price_when_added: idr(unitPrice),
  line_total: idr(unitPrice * quantity),
  stock: 10,
  weight_grams: 200,
  problem: null,
});

const cart: Cart = {
  lines: [line("KP-M", 2, 89_000), line("KP-L", 1, 99_000)],
  item_count: 3,
  subtotal: idr(277_000),
};

const orderItem = (
  sku: string,
  quantity: number,
  unitPrice: number,
): OrderItem => ({
  id: `item-${sku}`,
  variant_id: `v-${sku}`,
  product_name: "Kaos Polos",
  variant_name: sku.slice(-1),
  sku,
  unit_price: idr(unitPrice),
  quantity,
  line_total: idr(unitPrice * quantity),
});

const order = (voucherCode: string | null): AnalyticsOrder => ({
  code: "GS-20261030-7KQ2M9",
  items: [orderItem("KP-M", 2, 85_000)],
  totals: {
    subtotal: idr(170_000),
    discount: idr(10_000),
    shipping_fee: idr(18_000),
    total: idr(178_000),
    weight_grams: 400,
  },
  voucher_code: voucherCode,
});

describe("items", () => {
  it("productItem: the product's name, category and lowest price, no SKU", () => {
    expect(productItem(product("Kaos Polos", 89_000))).toEqual({
      item_name: "Kaos Polos",
      item_category: "Kaos",
      price: 89_000,
      quantity: 1,
    });
  });

  it("cartLineItem: the variant's SKU and unit price, the line's quantity by default", () => {
    const kaos = line("KP-M", 2, 89_000);

    expect(cartLineItem(kaos)).toEqual({
      item_id: "KP-M",
      item_name: "Kaos Polos",
      item_variant: "M",
      price: 89_000,
      quantity: 2,
    });
    expect(cartLineItem(kaos, 5).quantity).toBe(5);
  });

  it("orderLineItem: the order's own price, not today's", () => {
    expect(orderLineItem(orderItem("KP-M", 2, 85_000))).toEqual({
      item_id: "KP-M",
      item_name: "Kaos Polos",
      item_variant: "M",
      price: 85_000,
      quantity: 2,
    });
  });
});

describe("view events", () => {
  it("view_item_list gives each product its position and the list", () => {
    const list = { item_list_id: "kaos", item_list_name: "Kaos" };

    const event = viewItemListEvent(list, [
      product("A", 10_000),
      product("B", 20_000),
    ]);

    expect(event).toEqual({
      name: "view_item_list",
      params: {
        item_list_id: "kaos",
        item_list_name: "Kaos",
        items: [
          { ...productItem(product("A", 10_000)), index: 0, ...list },
          { ...productItem(product("B", 20_000)), index: 1, ...list },
        ],
      },
    });
  });

  it("view_item is valued at the product's lowest price", () => {
    expect(viewItemEvent(product("A", 45_000))).toEqual({
      name: "view_item",
      params: {
        currency: "IDR",
        value: 45_000,
        items: [productItem(product("A", 45_000))],
      },
    });
  });
});

describe("cart events", () => {
  it("add_to_cart is valued at the quantity added, not the whole line", () => {
    const event = addToCartEvent(line("KP-M", 5, 89_000), 2);

    expect(event.name).toBe("add_to_cart");
    expect(event.params).toMatchObject({ currency: "IDR", value: 178_000 });
    expect(event.params.items).toEqual([
      { ...cartLineItem(line("KP-M", 5, 89_000)), quantity: 2 },
    ]);
  });

  it("remove_from_cart carries the whole line", () => {
    const event = removeFromCartEvent(line("KP-L", 3, 99_000));

    expect(event).toEqual({
      name: "remove_from_cart",
      params: {
        currency: "IDR",
        value: 297_000,
        items: [cartLineItem(line("KP-L", 3, 99_000))],
      },
    });
  });

  it("begin_checkout is valued at the cart's subtotal, with every line", () => {
    expect(beginCheckoutEvent(cart)).toEqual({
      name: "begin_checkout",
      params: {
        currency: "IDR",
        value: 277_000,
        items: cart.lines.map((each) => cartLineItem(each)),
      },
    });
  });
});

describe("shippingTier", () => {
  it("joins the courier and service codes in capitals", () => {
    expect(shippingTier({ courier: "jne", service: "reg" })).toBe("JNE REG");
  });
});

describe("add_shipping_info", () => {
  it("names the tier and the voucher", () => {
    const event = addShippingInfoEvent(
      cart,
      { courier: "jne", service: "REG" },
      "HEMAT10",
    );

    expect(event).toEqual({
      name: "add_shipping_info",
      params: {
        currency: "IDR",
        value: 277_000,
        items: cart.lines.map((each) => cartLineItem(each)),
        shipping_tier: "JNE REG",
        coupon: "HEMAT10",
      },
    });
  });

  it.each([
    ["no voucher", undefined],
    ["null", null],
    ["an empty code", ""],
  ])("has no coupon with %s", (_, code) => {
    const event = addShippingInfoEvent(
      cart,
      { courier: "sicepat", service: "best" },
      code,
    );

    expect(event.params).not.toHaveProperty("coupon");
    expect(event.params).toHaveProperty("shipping_tier", "SICEPAT BEST");
  });
});

describe("order events", () => {
  it("add_payment_info: the order's total and lines, the gateway, the voucher", () => {
    expect(addPaymentInfoEvent(order("HEMAT10"), "midtrans_snap")).toEqual({
      name: "add_payment_info",
      params: {
        currency: "IDR",
        value: 178_000,
        items: [orderLineItem(orderItem("KP-M", 2, 85_000))],
        payment_type: "midtrans_snap",
        coupon: "HEMAT10",
      },
    });
  });

  it("purchase: the code as transaction_id, the total paid and the shipping fee", () => {
    expect(purchaseEvent(order(null))).toEqual({
      name: "purchase",
      params: {
        currency: "IDR",
        transaction_id: "GS-20261030-7KQ2M9",
        value: 178_000,
        shipping: 18_000,
        items: [orderLineItem(orderItem("KP-M", 2, 85_000))],
      },
    });
  });

  it("purchase carries the voucher code as coupon", () => {
    expect(purchaseEvent(order("HEMAT10")).params).toHaveProperty(
      "coupon",
      "HEMAT10",
    );
  });

  it("never copies the buyer's details from a whole order", () => {
    // The payment page hands over the API's whole Order, address included.
    const whole = {
      ...order("X"),
      shipping: {
        address: { recipient_name: "Budi Santoso", phone: "081234567890" },
      },
    };

    for (const event of [
      purchaseEvent(whole),
      addPaymentInfoEvent(whole, "fake_gateway"),
    ]) {
      expect(JSON.stringify(event)).not.toMatch(/Budi|0812|address/);
    }
  });
});
