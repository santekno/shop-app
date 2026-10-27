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

export { login, register } from "./api/auth.ts";

export {
  EMAIL_MAX_LENGTH,
  NAME_MAX_LENGTH,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  loginSchema,
  registerSchema,
} from "./schemas/auth.ts";
export type { LoginInput, RegisterInput } from "./schemas/auth.ts";

export { EMPTY_CART, addCartItem, getCart } from "./api/cart.ts";
export type { AddCartItemResult, CartRequestOptions } from "./api/cart.ts";

export type {
  Cart,
  CartAddResult,
  CartDetail,
  CartItemAdd,
  CartLine,
  Category,
  CategoryList,
  ErrorBody,
  ListProductsQuery,
  LoginRequest,
  Money,
  Product,
  ProductDetail,
  ProductList,
  ProductVariant,
  RegisterRequest,
  TokenPair,
  TokenPairDetail,
  User,
  UserDetail,
  components,
  operations,
  paths,
} from "./api/types.ts";
