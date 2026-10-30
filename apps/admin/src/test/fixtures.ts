// Objects in the contract's shapes (@goshop/shared's generated types), with
// defaults a test overrides only where it matters.
import type {
  Order,
  OrderSummary,
  SalesReport,
  User,
  WebSession,
} from "@goshop/shared";
import type { Session } from "@/features/auth/session-context.ts";

/** An account; a seller unless told otherwise. */
export const user = (overrides: Partial<User> = {}): User => ({
  id: "u-1",
  email: "sari@goshop.test",
  name: "Sari",
  phone: null,
  role: "seller",
  email_verified: true,
  created_at: "2026-10-01T00:00:00Z",
  ...overrides,
});

/** A logged-in session of `role`, with an access token. */
export const session = (
  role: User["role"] = "seller",
  accessToken = "token-1",
  overrides: Partial<User> = {},
): Session => ({ user: user({ role, ...overrides }), accessToken });

/** POST /v1/auth/web/login and /web/refresh's `data`. */
export const webSession = (
  accessToken: string,
  account: User = user(),
  expiresIn = 900,
): WebSession => ({
  access_token: accessToken,
  token_type: "Bearer",
  expires_in: expiresIn,
  user: account,
});

export const ORDER_ID = "0b6d2a4e-0000-4000-8000-000000000001";

const idr = (amount: number) => ({ amount, currency: "IDR" as const });

/**
 * An order in the shape of GET /v1/admin/orders/{id}: paid, two lines,
 * JNE REG, no resi yet, unless told otherwise.
 */
export const order = (overrides: Partial<Order> = {}): Order => ({
  id: ORDER_ID,
  code: "GS-20261030-7KQ2M9",
  status: "paid",
  cancel_reason: null,
  items: [
    {
      id: "item-1",
      variant_id: "v-1",
      product_name: "Kaos Polos",
      variant_name: "Hitam / M",
      sku: "KAOS-HTM-M",
      unit_price: idr(89_000),
      quantity: 2,
      line_total: idr(178_000),
    },
    {
      id: "item-2",
      variant_id: "v-2",
      product_name: "Topi Rajut",
      variant_name: "Abu",
      sku: "TOPI-ABU",
      unit_price: idr(45_000),
      quantity: 1,
      line_total: idr(45_000),
    },
  ],
  totals: {
    subtotal: idr(223_000),
    discount: idr(0),
    shipping_fee: idr(18_000),
    total: idr(241_000),
    weight_grams: 1_250,
  },
  voucher_code: null,
  shipping: {
    courier: "jne",
    service: "reg",
    tracking_number: null,
    address: {
      recipient_name: "Budi Santoso",
      phone: "081234567890",
      street: "Jl. Merdeka No. 1",
      city: "Bandung",
      province: "Jawa Barat",
      postal_code: "40111",
    },
  },
  latest_payment: null,
  payment_expires_at: "2026-10-31T03:00:00Z",
  paid_at: "2026-10-30T03:10:00Z",
  shipped_at: null,
  completed_at: null,
  cancelled_at: null,
  created_at: "2026-10-30T03:00:00Z",
  updated_at: "2026-10-30T03:10:00Z",
  ...overrides,
});

/** One row of the order queue (GET /v1/admin/orders). */
export const orderSummary = (
  n: number,
  overrides: Partial<OrderSummary> = {},
): OrderSummary => ({
  id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
  code: `GS-20261030-${String(n).padStart(6, "0")}`,
  status: "paid",
  total: idr(100_000 + n),
  payment_expires_at: "2026-10-31T03:00:00Z",
  created_at: "2026-10-30T03:00:00Z",
  updated_at: "2026-10-30T04:00:00Z",
  ...overrides,
});

type Period = SalesReport["series"][number];

/** One period of a report: `orders` orders of Rp 100.000 each. */
export const period = (
  start: string,
  orders: number,
  cumulative = 0,
): Period => ({
  period: start,
  revenue: idr(orders * 100_000),
  order_count: orders,
  average_order_value: idr(orders === 0 ? 0 : 100_000),
  cumulative_revenue: idr(cumulative),
});

/**
 * A sales report in the shape of GET /v1/admin/reports/sales: three days
 * of October, 2 + 0 + 3 orders, one top product, unless told otherwise.
 */
export const salesReport = (
  overrides: Partial<SalesReport> = {},
): SalesReport => {
  const series = overrides.series ?? [
    period("2026-10-28", 2, 200_000),
    period("2026-10-29", 0, 200_000),
    period("2026-10-30", 3, 500_000),
  ];
  const orders = series.reduce((sum, row) => sum + row.order_count, 0);
  const revenue = series.reduce((sum, row) => sum + row.revenue.amount, 0);
  return {
    from: "2026-10-28",
    to: "2026-10-30",
    group: "day",
    time_zone: "Asia/Jakarta",
    totals: {
      revenue: idr(revenue),
      order_count: orders,
      average_order_value: idr(orders === 0 ? 0 : Math.round(revenue / orders)),
    },
    series,
    top_products: [
      {
        rank: 1,
        product_id: "p-1",
        name: "Kaos Polos",
        units: 4,
        revenue: idr(356_000),
      },
    ],
    ...overrides,
  };
};
