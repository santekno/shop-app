// Short names for the types generated from api/openapi.yaml into
// schema.gen.ts (`pnpm --filter @goshop/shared gen`, or `make gen-types`).
// Never write an API type by hand: when the contract changes, regenerate,
// and the compiler points at every line that no longer fits.
import type { components, operations } from "./schema.gen.ts";

export type { components, operations, paths } from "./schema.gen.ts";

/** components["schemas"] is an indexed access type: the type of that property. */
type Schemas = components["schemas"];

export type Category = Schemas["Category"];
export type CategoryList = Schemas["CategoryList"];
/** Whole rupiah plus the currency, always IDR. */
export type Money = Schemas["Money"];
export type Product = Schemas["Product"];
export type ProductList = Schemas["ProductList"];
export type ProductDetail = Schemas["ProductDetail"];
export type ProductVariant = Schemas["ProductVariant"];
/** A ready product photo: the largest variant's URL and size, its alt
 *  text (may be empty) and every resized variant, for `srcset`. */
export type ProductImage = Schemas["ProductImage"];
export type ImageVariant = Schemas["ImageVariant"];
/** An account as its owner sees it (Bab 4). */
export type User = Schemas["User"];
export type UserDetail = Schemas["UserDetail"];
/** The body of POST /v1/auth/register. */
export type RegisterRequest = Schemas["RegisterRequest"];
/** The body of POST /v1/auth/login. */
export type LoginRequest = Schemas["LoginRequest"];
/** A session's tokens and the account they belong to. */
export type TokenPair = Schemas["TokenPair"];
export type TokenPairDetail = Schemas["TokenPairDetail"];
/**
 * The browser's session (Bab 10): the access token and the account. The
 * refresh token is in the httpOnly `goshop_refresh` cookie, never here.
 */
export type WebSession = Schemas["WebSession"];
export type WebSessionDetail = Schemas["WebSessionDetail"];
/** A cart (Bab 5): its lines, the number of units and the subtotal. */
export type Cart = Schemas["Cart"];
export type CartLine = Schemas["CartLine"];
export type CartDetail = Schemas["CartDetail"];
export type CartAddResult = Schemas["CartAddResult"];
/** The body of POST /v1/cart/items. */
export type CartItemAdd = Schemas["CartItemAdd"];
/** The body of PATCH /v1/cart/items/{variant_id}. */
export type CartItemPatch = Schemas["CartItemPatch"];
/** A buyer's address (Bab 4). */
export type Address = Schemas["Address"];
/** The body of POST /v1/me/addresses. */
export type AddressCreate = Schemas["AddressCreate"];
export type AddressDetail = Schemas["AddressDetail"];
export type AddressList = Schemas["AddressList"];
/** One courier service, priced for the cart (Bab 5). */
export type ShippingQuote = Schemas["ShippingQuote"];
export type ShippingQuotes = Schemas["ShippingQuotes"];
export type ShippingQuotesDetail = Schemas["ShippingQuotesDetail"];
/** The body of POST /v1/checkout/preview: what the buyer has chosen so far. */
export type CheckoutPreviewRequest = Schemas["CheckoutPreviewRequest"];
/** The cart validated and priced as checkout would (Bab 5). */
export type CheckoutPreview = Schemas["CheckoutPreview"];
export type CheckoutPreviewDetail = Schemas["CheckoutPreviewDetail"];
/** What an order charges, computed by the API in whole rupiah. */
export type OrderTotals = Schemas["OrderTotals"];
export type AppliedVoucher = Schemas["AppliedVoucher"];
/** One cart line that checkout refuses (409 CHECKOUT_PROBLEMS). */
export type CheckoutProblem = Schemas["CheckoutProblem"];
/** The body of POST /v1/checkout. */
export type CheckoutRequest = Schemas["CheckoutRequest"];
/** An order with its line snapshots, totals and address copy (Bab 5). */
export type Order = Schemas["Order"];
export type OrderDetail = Schemas["OrderDetail"];
export type OrderItem = Schemas["OrderItem"];
/** An order as the history list shows it, without its lines. */
export type OrderSummary = Schemas["OrderSummary"];
/** One page of the buyer's orders. */
export type OrderList = Schemas["OrderList"];
/** The life cycle of an order (ADR 0006). */
export type OrderStatus = Order["status"];
/**
 * The order's newest payment (Bab 11): why a `pending_payment` order still
 * waits. `null` until the buyer first starts paying.
 */
export type OrderLatestPayment = Schemas["OrderLatestPayment"];
/** What happened to that payment: open, paid, or ended without money. */
export type PaymentStatus = OrderLatestPayment["status"];
/** A Midtrans Snap transaction for an order (Bab 6, ADR 0007). */
export type PaymentSession = Schemas["PaymentSession"];
export type PaymentSessionDetail = Schemas["PaymentSessionDetail"];
/** The body of every API error: {"error":{"code","message","details"}}. */
export type ErrorBody = Schemas["Error"];

/**
 * The query parameters of GET /v1/products (category, q, sort, cursor,
 * limit), every one optional. Indexed access into the operation the
 * generator wrote: operations["listProducts"] is the operation, its
 * parameters.query the object type; NonNullable drops the `undefined` that
 * an optional property adds.
 */
export type ListProductsQuery = NonNullable<
  operations["listProducts"]["parameters"]["query"]
>;
