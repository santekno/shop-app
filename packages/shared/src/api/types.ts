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
/** One product of the dashboard's product table (Bab 12), in any status. */
export type AdminProductRow = Schemas["AdminProductRow"];
/** One numbered page of the dashboard's product table, with its total. */
export type AdminProductTable = Schemas["AdminProductTable"];
/** Where an offset page sits in the whole list: page, per_page, total, total_pages. */
export type OffsetPageInfo = Schemas["OffsetPageInfo"];
/** A product's status: only `active` products are in the catalog. */
export type AdminProductStatus = AdminProductRow["status"];
/** The query of GET /v1/admin/products, every parameter optional. */
export type ListAdminProductsQuery = NonNullable<
  operations["listAdminProducts"]["parameters"]["query"]
>;
/** The columns GET /v1/admin/products can sort by. */
export type AdminProductSort = NonNullable<ListAdminProductsQuery["sort"]>;
/** A sort direction of GET /v1/admin/products. */
export type SortOrder = NonNullable<ListAdminProductsQuery["order"]>;
/** A product as the dashboard sees and edits it (Bab 12), in any status. */
export type AdminProduct = Schemas["AdminProduct"];
export type AdminProductDetail = Schemas["AdminProductDetail"];
/** A sellable variant with its `version`, which a PUT sends back. */
export type AdminVariant = Schemas["AdminVariant"];
/** A product photo as the dashboard sees it, pending uploads included. */
export type AdminProductImage = Schemas["AdminProductImage"];
export type AdminProductImageDetail = Schemas["AdminProductImageDetail"];
/** Where a photo is: pending_upload, processing, ready or failed. */
export type AdminProductImageStatus = AdminProductImage["status"];
/** The file types a photo may be uploaded as: JPEG, PNG or WebP. */
export type ProductImageContentType = AdminProductImage["content_type"];
/** The body of POST …/images/uploads: the file's type and exact size. */
export type ImageUploadRequest = Schemas["ImageUploadRequest"];
/** The pending photo and the presigned request that uploads its file. */
export type ImageUpload = Schemas["ImageUpload"];
export type ImageUploadDetail = Schemas["ImageUploadDetail"];
/** The presigned request: method, URL, headers, and when it stops working. */
export type ImageUploadTicket = ImageUpload["upload"];
/** The body of POST …/images/{image_id}/confirm: the photo's alt text. */
export type ImageConfirmRequest = Schemas["ImageConfirmRequest"];
/** The body of POST and PUT /v1/admin/products: the whole product. */
export type ProductWrite = Schemas["ProductWrite"];
/** One variant of a ProductWrite: `id` and `version` only for an existing one. */
export type VariantWrite = Schemas["VariantWrite"];
/** Where an order goes and with whom: courier, service, resi, address copy. */
export type OrderShipping = Schemas["OrderShipping"];
/** The courier the buyer chose at checkout: jne, jnt or sicepat. */
export type Courier = OrderShipping["courier"];
/** The shipping address as it was at checkout, kept on the order. */
export type ShippingAddressSnapshot = Schemas["ShippingAddressSnapshot"];
/** Why an order was cancelled, or null. */
export type OrderCancelReason = Order["cancel_reason"];
/** The query of GET /v1/admin/orders (Bab 12): status, cursor, limit. */
export type ListAdminOrdersQuery = NonNullable<
  operations["listOrdersByStatus"]["parameters"]["query"]
>;
/** The body of POST /v1/admin/orders/{id}/ship: the courier's airway bill. */
export type ShipRequest = Schemas["ShipRequest"];
/** The dashboard's sales report (Bab 12): totals, one row per period, the top 5. */
export type SalesReport = Schemas["SalesReport"];
export type SalesReportDetail = Schemas["SalesReportDetail"];
/** One period of the report: its first day, revenue, orders, average, running total. */
export type SalesReportPeriod = SalesReport["series"][number];
/** One of the report's top products, by revenue (goods only, before vouchers). */
export type SalesReportTopProduct = SalesReport["top_products"][number];
/** What one period of the report is: a day, a week (from Monday) or a month. */
export type SalesReportGroup = SalesReport["group"];
/** The query of GET /v1/admin/reports/sales: from, to, group, every one optional. */
export type SalesReportQuery = NonNullable<
  operations["getSalesReport"]["parameters"]["query"]
>;
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

/**
 * The `data` of an `order` event on GET /v1/admin/events (Bab 12,
 * ADR 0009): which order changed, its new status and total. No buyer data.
 */
export type AdminOrderEvent = Schemas["AdminOrderEvent"];
