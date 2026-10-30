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

export {
  archiveProduct,
  confirmProductImage,
  createProduct,
  deleteProductImage,
  getAdminProduct,
  listAdminProducts,
  startProductImageUpload,
  updateProduct,
} from "./api/admin-products.ts";

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

export {
  LOW_STOCK_THRESHOLD,
  PRODUCT_DESCRIPTION_MAX_LENGTH,
  PRODUCT_NAME_MAX_LENGTH,
  PRODUCT_SLUG_MAX_LENGTH,
  PRODUCT_SLUG_PATTERN,
  PRODUCT_STATUSES,
  PRODUCT_VARIANTS_MAX,
  VARIANT_NAME_MAX_LENGTH,
  VARIANT_PRICE_MAX,
  VARIANT_PRICE_MIN,
  VARIANT_SKU_MAX_LENGTH,
  VARIANT_STOCK_MAX,
  VARIANT_WEIGHT_MAX_GRAMS,
  VARIANT_WEIGHT_MIN_GRAMS,
  productSchema,
  stockLevel,
  toProductSlug,
  variantSchema,
} from "./schemas/product.ts";
export type {
  ProductInput,
  StockLevel,
  VariantInput,
} from "./schemas/product.ts";

export {
  PRODUCT_IMAGES_MAX,
  PRODUCT_IMAGE_MAX_BYTES,
  PRODUCT_IMAGE_MAX_PIXELS,
  PRODUCT_IMAGE_MAX_SIDE,
  PRODUCT_IMAGE_SNIFF_BYTES,
  PRODUCT_IMAGE_TYPES,
  productImageDimensionsProblem,
  productImageSizeProblem,
  productImageTypeProblem,
  sniffProductImageType,
} from "./schemas/product-image.ts";

export type {
  Address,
  AddressCreate,
  AdminProduct,
  AdminProductDetail,
  AdminProductImage,
  AdminProductImageDetail,
  AdminProductImageStatus,
  AdminProductRow,
  AdminProductSort,
  AdminProductStatus,
  AdminProductTable,
  AddressDetail,
  AddressList,
  AdminVariant,
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
  ImageConfirmRequest,
  ImageUpload,
  ImageUploadDetail,
  ImageUploadRequest,
  ImageUploadTicket,
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
  ProductImageContentType,
  ProductList,
  ProductVariant,
  ProductWrite,
  RegisterRequest,
  ShippingQuote,
  ShippingQuotes,
  ShippingQuotesDetail,
  SortOrder,
  TokenPair,
  TokenPairDetail,
  User,
  UserDetail,
  VariantWrite,
  WebSession,
  WebSessionDetail,
  components,
  operations,
  paths,
} from "./api/types.ts";
