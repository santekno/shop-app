// Checkout data the way the API sends it (Bab 11 artikel 02–04), for the
// tests of src/features/checkout. Each builder gives a complete, valid
// value; a test overrides only the fields it is about.
import { ApiError } from "@goshop/shared";
import type {
  Address,
  AppliedVoucher,
  CartLine,
  CheckoutPreview,
  CheckoutProblem,
  Order,
  PaymentSession,
  ShippingQuote,
} from "@goshop/shared";

const idr = (amount: number) => ({ amount, currency: "IDR" as const });

/** An address in Bandung; `is_default` false unless told otherwise. */
export const address = (id: string, overrides: Partial<Address> = {}) =>
  ({
    id,
    label: `Alamat ${id}`,
    recipient_name: "Budi Santoso",
    phone: "081234567890",
    street: `Jl. Merdeka ${id}`,
    city: "Bandung",
    province: "Jawa Barat",
    postal_code: "40111",
    is_default: false,
    created_at: "2026-10-01T00:00:00Z",
    updated_at: "2026-10-01T00:00:00Z",
    ...overrides,
  }) satisfies Address;

/** A courier service: JNE REG at Rp 18.000, "2-3 days", unless told otherwise. */
export const quote = (overrides: Partial<ShippingQuote> = {}) =>
  ({
    courier: "jne",
    courier_name: "JNE",
    service: "REG",
    service_name: "Reguler",
    price: idr(18_000),
    etd: "2-3 days",
    ...overrides,
  }) satisfies ShippingQuote;

/** The body of GET /v1/checkout/shipping-quotes. */
export const quotesResponse = (quotes: ShippingQuote[]) =>
  Response.json({ data: { weight_grams: 200, quotes } });

/** The body of GET /v1/me/addresses. */
export const addressesResponse = (addresses: Address[]) =>
  Response.json({ data: addresses });

/** The body of POST /v1/me/addresses. */
export const addressResponse = (created: Address) =>
  Response.json({ data: created }, { status: 201 });

/** A voucher: Rp 15.000 off, unless told otherwise. */
export const voucher = (overrides: Partial<AppliedVoucher> = {}) =>
  ({
    code: "POTONG15RB",
    kind: "fixed",
    value: 15_000,
    max_discount: null,
    ...overrides,
  }) satisfies AppliedVoucher;

/**
 * A preview of `lines` with the totals given (whole rupiah); shipping and
 * voucher null unless told otherwise.
 */
export const preview = (
  lines: CartLine[],
  {
    subtotal = 89_000,
    discount = 0,
    shippingFee = 0,
    total = subtotal - discount + shippingFee,
    ...rest
  }: {
    subtotal?: number;
    discount?: number;
    shippingFee?: number;
    total?: number;
  } & Partial<Pick<CheckoutPreview, "shipping" | "voucher">> = {},
): CheckoutPreview => ({
  lines,
  totals: {
    subtotal: idr(subtotal),
    discount: idr(discount),
    shipping_fee: idr(shippingFee),
    total: idr(total),
    weight_grams: 200,
  },
  shipping: null,
  voucher: null,
  ...rest,
});

/** The body of POST /v1/checkout/preview. */
export const previewResponse = (body: CheckoutPreview) =>
  Response.json({ data: body });

/** An order just placed, waiting for payment. */
export const order = (overrides: Partial<Order> = {}) =>
  ({
    id: "order-1",
    code: "GS-20261030-7KQ2M9",
    status: "pending_payment",
    cancel_reason: null,
    items: [
      {
        id: "item-1",
        variant_id: "v1",
        product_name: "Produk v1",
        variant_name: "V1",
        sku: "SKU-V1",
        unit_price: idr(89_000),
        quantity: 1,
        line_total: idr(89_000),
      },
    ],
    totals: {
      subtotal: idr(89_000),
      discount: idr(0),
      shipping_fee: idr(18_000),
      total: idr(107_000),
      weight_grams: 200,
    },
    voucher_code: null,
    shipping: {
      courier: "jne",
      service: "REG",
      tracking_number: null,
      address: {
        recipient_name: "Budi Santoso",
        phone: "081234567890",
        street: "Jl. Merdeka 1",
        city: "Bandung",
        province: "Jawa Barat",
        postal_code: "40111",
      },
    },
    latest_payment: null,
    payment_expires_at: "2026-10-31T00:00:00Z",
    paid_at: null,
    shipped_at: null,
    completed_at: null,
    cancelled_at: null,
    created_at: "2026-10-30T00:00:00Z",
    updated_at: "2026-10-30T00:00:00Z",
    ...overrides,
  }) satisfies Order;

/** The body of POST /v1/checkout (201). */
export const orderResponse = (placed: Order) =>
  Response.json({ data: placed }, { status: 201 });

/** A Snap session for `orderId`; Midtrans' sandbox unless told otherwise. */
export const paymentSession = (
  orderId: string,
  overrides: Partial<PaymentSession> = {},
) =>
  ({
    id: "payment-1",
    order_id: orderId,
    provider: "midtrans",
    status: "pending",
    amount: idr(107_000),
    token: "snap-token",
    redirect_url: "https://app.sandbox.midtrans.com/snap/v4/redirection/abc",
    client_key: "SB-Mid-client-placeholder",
    expires_at: "2026-10-31T00:00:00Z",
    created_at: "2026-10-30T00:00:00Z",
    ...overrides,
  }) satisfies PaymentSession;

/** The body of POST /v1/orders/{id}/pay. */
export const paymentResponse = (session: PaymentSession) =>
  Response.json({ data: session }, { status: 201 });

/** One line checkout refuses. */
export const problem = (
  variantId: string,
  overrides: Partial<CheckoutProblem> = {},
) =>
  ({
    variant_id: variantId,
    sku: `SKU-${variantId.toUpperCase()}`,
    problem: "unavailable",
    quantity: 2,
    available: 0,
    unit_price: idr(89_000),
    price_when_added: idr(89_000),
    ...overrides,
  }) satisfies CheckoutProblem;

/** An ApiError as the client throws it for `code`. */
export const apiError = (
  status: number,
  code: string,
  details: Record<string, unknown> = {},
) => new ApiError({ status, code, message: "boom", details });
