// Objects in the contract's shapes (@goshop/shared's generated types), with
// defaults a test overrides only where it matters.
import type {
  AdminProduct,
  AdminProductImage,
  AdminProductRow,
  AdminProductTable,
  AdminVariant,
  Category,
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

// --- Products (artikel 02–05) ---------------------------------------------

export const PRODUCT_ID = "11111111-1111-4111-8111-111111111111";
export const CATEGORY_ID = "22222222-2222-4222-8222-222222222222";

export const category = (
  id: string,
  name: string,
  parentId: string | null = null,
): Category => ({
  id,
  slug: name.toLowerCase().replace(/\s+/g, "-"),
  name,
  parent_id: parentId,
});

/** A variant: Rp 89.000, 12 in stock, 250 g, version 1, unless told otherwise. */
export const adminVariant = (
  n: number,
  overrides: Partial<AdminVariant> = {},
): AdminVariant => ({
  id: `33333333-3333-4333-8333-${String(n).padStart(12, "0")}`,
  sku: `KAOS-${String(n)}`,
  name: `Varian ${String(n)}`,
  price: idr(89_000),
  stock: 12,
  weight_grams: 250,
  version: 1,
  ...overrides,
});

/** A product image, ready unless told otherwise. */
export const adminImage = (
  n: number,
  overrides: Partial<AdminProductImage> = {},
): AdminProductImage => ({
  id: `44444444-4444-4444-8444-${String(n).padStart(12, "0")}`,
  status: "ready",
  position: n,
  alt: "",
  content_type: "image/jpeg",
  size_bytes: 120_000,
  url: `http://storage.test/products/${String(n)}.jpg`,
  width: 1200,
  height: 1200,
  variants: [
    {
      width: 400,
      height: 400,
      url: `http://storage.test/products/${String(n)}-400.jpg`,
    },
  ],
  created_at: "2026-10-30T03:00:00Z",
  updated_at: "2026-10-30T03:00:00Z",
  ...overrides,
});

/** A product in GET /v1/admin/products/{id}'s shape: active, one variant, version 1. */
export const adminProduct = (
  overrides: Partial<AdminProduct> = {},
): AdminProduct => ({
  id: PRODUCT_ID,
  category_id: CATEGORY_ID,
  slug: "kaos-polos",
  name: "Kaos Polos",
  description: "Kaos katun.",
  status: "active",
  price_from: idr(89_000),
  version: 1,
  variants: [adminVariant(1)],
  images: [],
  created_at: "2026-10-30T03:00:00Z",
  updated_at: "2026-10-30T03:00:00Z",
  ...overrides,
});

/** One row of the product table. */
export const productRow = (
  n: number,
  overrides: Partial<AdminProductRow> = {},
): AdminProductRow => ({
  id: `55555555-5555-4555-8555-${String(n).padStart(12, "0")}`,
  slug: `produk-${String(n)}`,
  name: `Produk ${String(n)}`,
  status: "active",
  category: { id: CATEGORY_ID, name: "Kaos" },
  price_from: idr(89_000),
  stock: 12,
  variant_count: 1,
  low_stock: false,
  thumbnail_url: null,
  created_at: "2026-10-30T03:00:00Z",
  updated_at: "2026-10-30T04:00:00Z",
  ...overrides,
});

/** A page of the product table (20 per page, threshold 5 unless told otherwise). */
export const productTable = (
  rows: AdminProductRow[],
  { page = 1, perPage = 20, total = rows.length, threshold = 5 } = {},
): AdminProductTable => ({
  data: rows,
  page: {
    page,
    per_page: perPage,
    total,
    total_pages: Math.max(1, Math.ceil(total / perPage)),
  },
  low_stock_threshold: threshold,
});
