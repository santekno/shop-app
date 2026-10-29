import type {
  Cart,
  CartLine,
  Order,
  OrderItem,
  Product,
  ShippingQuote,
} from "../api/types.ts";

/*
 * The e-commerce events GoShop sends to Google Analytics 4 (Bab 11
 * artikel 13), as types and as functions that build them from the API's
 * own types. The web storefront sends them now; the mobile app (Bab 17)
 * sends the same events with the same parameters, so one GA4 report
 * covers both.
 *
 * The names and parameters are GA4's recommended e-commerce events
 * (developers.google.com/analytics/devguides/collection/ga4/ecommerce):
 * GA4 builds its funnel and item reports from exactly these names.
 *
 * **Never personal data.** Google's terms forbid sending anything that
 * identifies a person (a name, an email, a phone number, an address), and
 * a GA4 property is read by more people than the order database. Every
 * parameter below is catalog data (a product name, a SKU, a price) or an
 * order's code, and the types are closed: a builder cannot be handed a
 * user, an address or a token, and an event cannot carry a field that is
 * not listed here.
 */

/** Every amount is in rupiah: the API's Money is always IDR. */
export const ANALYTICS_CURRENCY = "IDR";

/**
 * One product in an event: GA4's `items[]` entry.
 *
 * - `item_name` is the product's name in every event, so GA4 can follow
 *   one product from the list to the purchase.
 * - `item_id` is the variant's SKU, present only once a variant is known
 *   (in the cart, the checkout and the order). A list or a product page
 *   shows a product, not a variant, and GA4 needs one of the two fields,
 *   not both.
 * - `price` is the unit price in whole rupiah, as the API sends it: an
 *   integer, never formatted ("Rp 89.000" is for people).
 */
export interface AnalyticsItem {
  item_id?: string;
  item_name: string;
  item_variant?: string;
  item_category?: string;
  price: number;
  quantity: number;
  /** The product's position in a list, from 0. */
  index?: number;
  item_list_id?: string;
  item_list_name?: string;
}

/** The parameters every money-carrying event has. */
interface ValueParams {
  currency: typeof ANALYTICS_CURRENCY;
  /** Whole rupiah. */
  value: number;
  items: AnalyticsItem[];
}

/** A voucher code, only when the order or the choice has one. */
interface CouponParam {
  coupon?: string;
}

/** Which list a buyer saw: the catalog, a category, or a search. */
export interface AnalyticsList {
  item_list_id: string;
  item_list_name: string;
}

/**
 * Every event the storefront sends, a union discriminated by `name`, the
 * way a Go switch over a typed constant is exhaustive: `track` accepts
 * nothing else, and a new event is added here first.
 */
export type EcommerceEvent =
  | {
      name: "view_item_list";
      params: AnalyticsList & { items: AnalyticsItem[] };
    }
  | { name: "view_item"; params: ValueParams }
  | { name: "add_to_cart"; params: ValueParams }
  | { name: "remove_from_cart"; params: ValueParams }
  | { name: "begin_checkout"; params: ValueParams & CouponParam }
  | {
      name: "add_shipping_info";
      params: ValueParams & CouponParam & { shipping_tier: string };
    }
  | {
      name: "add_payment_info";
      params: ValueParams & CouponParam & { payment_type: string };
    }
  | {
      name: "purchase";
      params: ValueParams &
        CouponParam & {
          /** The order's code (GS-…): what the buyer and the admin see. */
          transaction_id: string;
          /** The shipping fee, whole rupiah. */
          shipping: number;
        };
    };

export type EcommerceEventName = EcommerceEvent["name"];

/** `{ coupon }` when there is a code, `{}` when there is none. */
const coupon = (code: string | null | undefined): CouponParam =>
  code === null || code === undefined || code === "" ? {} : { coupon: code };

/**
 * A product as a list or its own page shows it: no variant chosen yet, so
 * no SKU, and the lowest price ("from Rp 89.000").
 */
export const productItem = (product: Product): AnalyticsItem => ({
  item_name: product.name,
  item_category: product.category.name,
  price: product.price_from.amount,
  quantity: 1,
});

/** A cart line (or a checkout preview's line), `quantity` units of it. */
export const cartLineItem = (
  line: CartLine,
  quantity: number = line.quantity,
): AnalyticsItem => ({
  item_id: line.sku,
  item_name: line.product_name,
  item_variant: line.variant_name,
  price: line.unit_price.amount,
  quantity,
});

/** One line of a placed order: the order's own copy, not today's price. */
export const orderLineItem = (item: OrderItem): AnalyticsItem => ({
  item_id: item.sku,
  item_name: item.product_name,
  item_variant: item.variant_name,
  price: item.unit_price.amount,
  quantity: item.quantity,
});

/** Σ price × quantity, for events whose value is their items'. */
const itemsValue = (items: readonly AnalyticsItem[]): number =>
  items.reduce((sum, item) => sum + item.price * item.quantity, 0);

/**
 * view_item_list: the first page of a list (the catalog, a category, a
 * search), each product with its position.
 */
export const viewItemListEvent = (
  list: AnalyticsList,
  products: readonly Product[],
): EcommerceEvent => ({
  name: "view_item_list",
  params: {
    ...list,
    items: products.map((product, index) => ({
      ...productItem(product),
      index,
      ...list,
    })),
  },
});

/** view_item: a product's page. */
export const viewItemEvent = (product: Product): EcommerceEvent => {
  const items = [productItem(product)];
  return {
    name: "view_item",
    params: { currency: ANALYTICS_CURRENCY, value: itemsValue(items), items },
  };
};

/**
 * add_to_cart: `quantity` units of the line the API answered with (its
 * price is the API's, not the one on screen).
 */
export const addToCartEvent = (
  line: CartLine,
  quantity: number,
): EcommerceEvent => {
  const items = [cartLineItem(line, quantity)];
  return {
    name: "add_to_cart",
    params: { currency: ANALYTICS_CURRENCY, value: itemsValue(items), items },
  };
};

/** remove_from_cart: a whole line, removed. */
export const removeFromCartEvent = (line: CartLine): EcommerceEvent => {
  const items = [cartLineItem(line)];
  return {
    name: "remove_from_cart",
    params: { currency: ANALYTICS_CURRENCY, value: itemsValue(items), items },
  };
};

/** begin_checkout: the cart as checkout starts, valued at its subtotal. */
export const beginCheckoutEvent = (cart: Cart): EcommerceEvent => ({
  name: "begin_checkout",
  params: {
    currency: ANALYTICS_CURRENCY,
    value: cart.subtotal.amount,
    items: cart.lines.map((line) => cartLineItem(line)),
  },
});

/**
 * The courier and service as one stable label, "JNE REG": the codes, not
 * the display names, so a renamed service stays one row in the report.
 */
export const shippingTier = (
  quote: Pick<ShippingQuote, "courier" | "service">,
): string => `${quote.courier.toUpperCase()} ${quote.service.toUpperCase()}`;

/** add_shipping_info: a courier service chosen for the cart. */
export const addShippingInfoEvent = (
  cart: Cart,
  quote: Pick<ShippingQuote, "courier" | "service">,
  voucherCode?: string | null,
): EcommerceEvent => ({
  name: "add_shipping_info",
  params: {
    currency: ANALYTICS_CURRENCY,
    value: cart.subtotal.amount,
    items: cart.lines.map((line) => cartLineItem(line)),
    shipping_tier: shippingTier(quote),
    ...coupon(voucherCode),
  },
});

/** What these two events read from an order. */
export type AnalyticsOrder = Pick<
  Order,
  "code" | "items" | "totals" | "voucher_code"
>;

/**
 * add_payment_info: a payment started for the order. `paymentType` is the
 * gateway ("midtrans_snap"): the method (a virtual account, a card, QRIS)
 * is chosen later, on Midtrans' page, and GoShop never learns it here.
 */
export const addPaymentInfoEvent = (
  order: AnalyticsOrder,
  paymentType: string,
): EcommerceEvent => ({
  name: "add_payment_info",
  params: {
    currency: ANALYTICS_CURRENCY,
    value: order.totals.total.amount,
    items: order.items.map(orderLineItem),
    payment_type: paymentType,
    ...coupon(order.voucher_code),
  },
});

/**
 * purchase: a paid order, from the order the API returned. The value is
 * what the buyer paid (the total, after the discount, with shipping), and
 * the items are the order's own lines.
 */
export const purchaseEvent = (order: AnalyticsOrder): EcommerceEvent => ({
  name: "purchase",
  params: {
    currency: ANALYTICS_CURRENCY,
    transaction_id: order.code,
    value: order.totals.total.amount,
    shipping: order.totals.shipping_fee.amount,
    items: order.items.map(orderLineItem),
    ...coupon(order.voucher_code),
  },
});
