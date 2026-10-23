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
