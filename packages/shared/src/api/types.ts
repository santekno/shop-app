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
/** A cart (Bab 5): its lines, the number of units and the subtotal. */
export type Cart = Schemas["Cart"];
export type CartLine = Schemas["CartLine"];
export type CartDetail = Schemas["CartDetail"];
export type CartAddResult = Schemas["CartAddResult"];
/** The body of POST /v1/cart/items. */
export type CartItemAdd = Schemas["CartItemAdd"];
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
