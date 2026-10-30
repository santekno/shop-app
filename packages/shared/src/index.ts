// The public API of @goshop/shared. Apps import from "@goshop/shared" only,
// never from a file inside src/, so files can move without breaking them;
// this file is the package's exported surface, like the capitalised names of
// a Go package.
//
// Named exports only (no `export default`): the name is the same in every
// file that imports it, and an editor can rename it everywhere. `export type`
// marks names that exist only for the type checker; they vanish from the
// JavaScript that runs.

export { createUrlBuilder, toQueryString } from "./api/url.ts";
export type { QueryParams, QueryValue } from "./api/url.ts";

export { buildCategoryTree } from "./catalog/category-tree.ts";
export type { CategoryNode } from "./catalog/category-tree.ts";

export { retry, sleep } from "./lib/async.ts";
export { formatRupiah } from "./lib/money.ts";
export type { RetryOptions } from "./lib/async.ts";

export {
  ApiError,
  isApiError,
  isErrorBody,
  SERVER_ERROR_CODES,
} from "./api/errors.ts";
export type {
  ApiErrorCode,
  ApiErrorInit,
  ClientErrorCode,
  ServerErrorCode,
} from "./api/errors.ts";

export { createApiClient } from "./api/client.ts";
export type {
  ApiClient,
  ApiClientConfig,
  ApiClientOptions,
  HttpMethod,
  RequestOptions,
} from "./api/client.ts";

export { getProduct, listCategories, listProducts } from "./api/catalog.ts";
export type { EndpointOptions } from "./api/catalog.ts";

export {
  WEB_CLIENT_HEADERS,
  login,
  register,
  webLogin,
  webLogout,
  webClientHeaders,
  webRefresh,
} from "./api/auth.ts";
export type { WebClient, WebSessionOptions } from "./api/auth.ts";

export {
  EMAIL_MAX_LENGTH,
  NAME_MAX_LENGTH,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  loginSchema,
  registerSchema,
} from "./schemas/auth.ts";
export type { LoginInput, RegisterInput } from "./schemas/auth.ts";

export { getMe } from "./api/me.ts";

export {
  EMPTY_CART,
  addCartItem,
  getCart,
  mergeCart,
  removeCartItem,
  updateCartItem,
} from "./api/cart.ts";
export type { AddCartItemResult, CartRequestOptions } from "./api/cart.ts";

export { createAddress, listAddresses } from "./api/addresses.ts";
export {
  checkoutProblems,
  getShippingQuotes,
  previewCheckout,
} from "./api/checkout.ts";

export { listAdminProducts } from "./api/admin-products.ts";

export { getOrder, listOrders, payOrder, placeOrder } from "./api/orders.ts";
export type { ListOrdersQuery, PlaceOrderOptions } from "./api/orders.ts";

export {
  ANALYTICS_CURRENCY,
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
} from "./analytics/ecommerce.ts";
export type {
  AnalyticsItem,
  AnalyticsList,
  AnalyticsOrder,
  EcommerceEvent,
  EcommerceEventName,
} from "./analytics/ecommerce.ts";

export {
  VOUCHER_CODE_MAX_LENGTH,
  VOUCHER_CODE_MIN_LENGTH,
  voucherSchema,
} from "./schemas/voucher.ts";
export type { VoucherInput, VoucherOutput } from "./schemas/voucher.ts";

export {
  ADDRESS_LABEL_MAX_LENGTH,
  ID_PHONE_PATTERN,
  ID_POSTAL_CODE_PATTERN,
  RECIPIENT_NAME_MAX_LENGTH,
  REGION_MAX_LENGTH,
  STREET_MAX_LENGTH,
  addressSchema,
} from "./schemas/address.ts";
export type { AddressInput } from "./schemas/address.ts";

export type {
  Address,
  AddressCreate,
  AdminProductRow,
  AdminProductSort,
  AdminProductStatus,
  AdminProductTable,
  AddressDetail,
  AddressList,
  AppliedVoucher,
  Cart,
  CartAddResult,
  CartDetail,
  CartItemAdd,
  CartItemPatch,
  CartLine,
  Category,
  CategoryList,
  CheckoutPreview,
  CheckoutPreviewDetail,
  CheckoutPreviewRequest,
  CheckoutProblem,
  CheckoutRequest,
  ErrorBody,
  ListAdminProductsQuery,
  ListProductsQuery,
  LoginRequest,
  Money,
  OffsetPageInfo,
  Order,
  OrderDetail,
  OrderItem,
  OrderLatestPayment,
  OrderList,
  OrderStatus,
  OrderSummary,
  OrderTotals,
  PaymentSession,
  PaymentSessionDetail,
  PaymentStatus,
  ImageVariant,
  Product,
  ProductDetail,
  ProductImage,
  ProductList,
  ProductVariant,
  RegisterRequest,
  ShippingQuote,
  ShippingQuotes,
  ShippingQuotesDetail,
  SortOrder,
  TokenPair,
  TokenPairDetail,
  User,
  UserDetail,
  WebSession,
  WebSessionDetail,
  components,
  operations,
  paths,
} from "./api/types.ts";
