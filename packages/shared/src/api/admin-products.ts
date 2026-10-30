import type { ApiClient } from "./client.ts";
import type { EndpointOptions } from "./catalog.ts";
import type {
  AdminProduct,
  AdminProductDetail,
  AdminVariant,
  AdminVariantDetail,
  AdminProductImage,
  AdminProductImageDetail,
  AdminProductTable,
  ImageConfirmRequest,
  ImageUpload,
  ImageUploadDetail,
  ImageUploadRequest,
  ListAdminProductsQuery,
  ProductWrite,
  StockAdjustment,
} from "./types.ts";

/**
 * GET /v1/admin/products: one numbered page of the dashboard's product
 * table, every status, with the total on every page. Returns the whole
 * body, `{ data, page }`: the table needs `page.total` and
 * `page.total_pages` for "Halaman 2 dari 5".
 *
 * Staff only, so `api` must be a client that sends the access token (the
 * dashboard's `authApi`); the plain client gets 401. Throws
 * VALIDATION_FAILED for a query the contract refuses (an unknown sort, a
 * `page` above 10000, a `q` longer than 100 characters), UNAUTHORIZED, or
 * FORBIDDEN for a buyer.
 *
 * Offset pages, unlike the catalog's cursors: a table jumps to page N and
 * sorts by any column. A page past the last one is an empty `data` with
 * the real `page.total`.
 *
 * @example
 *   const table = await listAdminProducts(authApi, {
 *     status: "active",
 *     sort: "price_from",
 *     order: "asc",
 *     page: 2,
 *     per_page: 20,
 *   });
 *   table.page.total_pages; // 5
 */
export const listAdminProducts = (
  api: ApiClient,
  query: ListAdminProductsQuery = {},
  { signal }: EndpointOptions = {},
): Promise<AdminProductTable> =>
  api.request<AdminProductTable>("/v1/admin/products", { query, signal });

/** The path of one product; the ID is escaped, so a pasted URL stays a path. */
const productPath = (id: string) =>
  `/v1/admin/products/${encodeURIComponent(id)}`;

/**
 * GET /v1/admin/products/{id}: one product in any status, with its
 * sellable variants (each with the `version` a PUT must send back) and
 * every photo. Returns the product itself, not the `{ data }` envelope.
 * Throws NOT_FOUND for an unknown ID (or one that is not a UUID).
 */
export const getAdminProduct = async (
  api: ApiClient,
  id: string,
  { signal }: EndpointOptions = {},
): Promise<AdminProduct> => {
  const body = await api.request<AdminProductDetail>(productPath(id), {
    signal,
  });
  return body.data;
};

/**
 * POST /v1/admin/products: creates the product and its variants in one
 * transaction and returns it as stored (SKUs upper-cased, `price_from`
 * computed). Variants must not carry an `id`. Throws VALIDATION_FAILED
 * (one entry per field, such as `variants[0].price`), UNKNOWN_CATEGORY,
 * SLUG_TAKEN or SKU_TAKEN.
 *
 * Never retried, like every POST: a second create after a lost answer
 * would be refused as SLUG_TAKEN at best.
 */
export const createProduct = async (
  api: ApiClient,
  body: ProductWrite,
  { signal }: EndpointOptions = {},
): Promise<AdminProduct> => {
  const response = await api.request<AdminProductDetail>("/v1/admin/products", {
    method: "POST",
    body,
    signal,
  });
  return response.data;
};

/**
 * PUT /v1/admin/products/{id}: saves the whole product. The body carries
 * the product's `version` as it was loaded (required: 400 without it), and
 * a variant with an `id` is updated and must carry the `version` it was
 * loaded with; one without is added; a sellable variant left out is
 * archived. Throws what createProduct throws, NOT_FOUND, and, with nothing
 * saved:
 *
 * - VERSION_CONFLICT with `details.product_id`: the product changed since
 *   (another admin's save, which may have added or archived variants, or
 *   an archive). Checked first;
 * - VERSION_CONFLICT with `details.variant_id`: a variant changed since
 *   (a checkout, a cancel, a stock adjustment), the first stale one;
 * - VARIANT_ARCHIVED (`details.variant_id`): the body names a variant
 *   that is archived. A fallback, not the race: every archive goes
 *   through a save, which bumps the product's version, so a form that
 *   loaded the product before another admin archived a variant gets
 *   VERSION_CONFLICT with `details.product_id` first. This one answers a
 *   body that carries the current product version with a variant that
 *   was already archived when the variants were read.
 */
export const updateProduct = async (
  api: ApiClient,
  id: string,
  body: ProductWrite,
  { signal }: EndpointOptions = {},
): Promise<AdminProduct> => {
  const response = await api.request<AdminProductDetail>(productPath(id), {
    method: "PUT",
    body,
    signal,
  });
  return response.data;
};

/**
 * POST /v1/admin/products/{id}/variants/{variant_id}/stock-adjustments:
 * changes one sellable variant's stock in one guarded statement, without
 * sending the whole product back (Bab 12 artikel 05). Returns the variant
 * after the change, its `version` bumped (the product's `version` does
 * not move).
 *
 * - `{ delta }`: added to the stock as it is when the change runs, so a
 *   sale in between is kept. Throws STOCK_OUT_OF_RANGE (409,
 *   `details.stock`, `min`, `max`) when the result would go below 0, or
 *   when an increase would take it above 1,000,000. A decrease is never
 *   capped: a cancellation can restore stock above the maximum, and
 *   lowering it from there must still work.
 * - `{ set, expected }`: a count, written only while the stock is still
 *   `expected`. Throws STOCK_CHANGED (409, `details.stock`, the stock now)
 *   otherwise.
 *
 * Also throws VARIANT_ARCHIVED (409), NOT_FOUND (a variant of another
 * product, or an unknown ID) and VALIDATION_FAILED. Never retried, like
 * every POST: a delta sent twice would count twice.
 */
export const adjustVariantStock = async (
  api: ApiClient,
  productId: string,
  variantId: string,
  body: StockAdjustment,
  { signal }: EndpointOptions = {},
): Promise<AdminVariant> => {
  const response = await api.request<AdminVariantDetail>(
    `${productPath(productId)}/variants/${encodeURIComponent(variantId)}/stock-adjustments`,
    { method: "POST", body, signal },
  );
  return response.data;
};

/**
 * DELETE /v1/admin/products/{id}: archives the product (takes it off the
 * storefront). Nothing is deleted; saving it again with another status
 * restores it. Archiving an archived product succeeds too. Throws
 * NOT_FOUND for an unknown ID.
 */
export const archiveProduct = async (
  api: ApiClient,
  id: string,
  { signal }: EndpointOptions = {},
): Promise<void> => {
  await api.request<undefined>(productPath(id), { method: "DELETE", signal });
};

/** The path of one photo of one product, both IDs escaped. */
const imagePath = (productId: string, imageId: string) =>
  `${productPath(productId)}/images/${encodeURIComponent(imageId)}`;

/**
 * POST /v1/admin/products/{id}/images/uploads: records a pending photo
 * (`pending_upload`) and returns it with a presigned request that uploads
 * its file straight to the storage, never through the API (ADR 0007).
 *
 * The request works for 15 minutes (`upload.expires_at`), only with
 * exactly the declared `content_type` and `size_bytes`: both are in the
 * signature, as the `Content-Type` and `Content-Length` headers. Send the
 * file with `upload.method`, `upload.url` and `upload.headers`, then call
 * confirmProductImage.
 *
 * Throws VALIDATION_FAILED (a type other than JPEG, PNG or WebP, a size
 * above 5 MiB), NOT_FOUND, IMAGE_LIMIT_REACHED (`details.max`: 10 photos
 * per product, pending ones included) or STORAGE_DISABLED (503). Never
 * retried: a second call after a lost answer would record a second
 * pending photo.
 */
export const startProductImageUpload = async (
  api: ApiClient,
  productId: string,
  body: ImageUploadRequest,
  { signal }: EndpointOptions = {},
): Promise<ImageUpload> => {
  const response = await api.request<ImageUploadDetail>(
    `${productPath(productId)}/images/uploads`,
    { method: "POST", body, signal },
  );
  return response.data;
};

/**
 * POST /v1/admin/products/{id}/images/{image_id}/confirm: tells the API
 * the file is in the storage. The API checks what arrived (the declared
 * size and type, the first bytes really that format, at most 6000 pixels
 * a side and 24 megapixels) and answers the photo, now `processing`: the
 * worker makes its 400 and 800 pixel JPEGs, and then it is `ready`.
 * Confirming a confirmed photo answers it again, so a confirm whose answer
 * was lost may be sent again.
 *
 * Throws UPLOAD_MISSING (409: nothing was uploaded yet), UPLOAD_INVALID
 * (422, `details.reason`: the file and the pending photo were deleted;
 * start a new upload), NOT_FOUND or STORAGE_DISABLED.
 */
export const confirmProductImage = async (
  api: ApiClient,
  productId: string,
  imageId: string,
  body: ImageConfirmRequest = { alt: "" },
  { signal }: EndpointOptions = {},
): Promise<AdminProductImage> => {
  const response = await api.request<AdminProductImageDetail>(
    `${imagePath(productId, imageId)}/confirm`,
    { method: "POST", body, signal },
  );
  return response.data;
};

/**
 * DELETE /v1/admin/products/{id}/images/{image_id}: deletes the photo, in
 * any status (a pending upload too), and its files. Throws NOT_FOUND when
 * there is no such photo (already deleted, or an upload the API refused).
 */
export const deleteProductImage = async (
  api: ApiClient,
  productId: string,
  imageId: string,
  { signal }: EndpointOptions = {},
): Promise<void> => {
  await api.request<undefined>(imagePath(productId, imageId), {
    method: "DELETE",
    signal,
  });
};
