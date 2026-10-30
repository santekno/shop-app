// The staff product endpoints (Bab 12 artikel 02–05) and the categories
// the product form reads, plus the object storage a photo is PUT to.
// Typed with the generated contract types, like every handler here.
import { http, HttpResponse } from "msw";
import type {
  AdminProduct,
  AdminProductDetail,
  AdminProductImage,
  AdminProductImageDetail,
  AdminProductTable,
  AdminVariant,
  AdminVariantDetail,
  CategoryList,
  ErrorBody,
  ImageUpload,
  ImageUploadDetail,
  ImageUploadRequest,
  ProductWrite,
  StockAdjustment,
} from "@goshop/shared";
import { noContent } from "./answers.ts";
import type { Answer } from "./answers.ts";
import { apiUrl } from "./http.ts";

export const productTableResponse = (table: AdminProductTable) =>
  HttpResponse.json<AdminProductTable>(table);

export const productResponse = (value: AdminProduct, status = 200) =>
  HttpResponse.json<AdminProductDetail>({ data: value }, { status });

export const variantResponse = (value: AdminVariant) =>
  HttpResponse.json<AdminVariantDetail>({ data: value });

export const imageResponse = (value: AdminProductImage) =>
  HttpResponse.json<AdminProductImageDetail>({ data: value });

export const uploadResponse = (value: ImageUpload) =>
  HttpResponse.json<ImageUploadDetail>({ data: value }, { status: 201 });

export const categoriesResponse = (categories: CategoryList["data"]) =>
  HttpResponse.json<CategoryList>({ data: categories });

const answerOr =
  <T>(answer: Answer | T, respond: (value: T) => Response) =>
  ({ request }: { request: Request }) =>
    typeof answer === "function"
      ? (answer as Answer)(request)
      : respond(answer);

/** GET /v1/admin/products: one table page for every request, or per request. */
export const productTableHandler = (answer: Answer | AdminProductTable) =>
  http.get<never, never, AdminProductTable | ErrorBody>(
    apiUrl("/v1/admin/products"),
    answerOr(answer, productTableResponse),
  );

/** GET /v1/admin/products/{id}: this product for its own ID, 404 otherwise. */
export const productDetailHandler = (answer: Answer | AdminProduct) =>
  http.get<{ id: string }, never, AdminProductDetail | ErrorBody>(
    apiUrl("/v1/admin/products/{id}"),
    ({ request, params }) => {
      if (typeof answer === "function") return answer(request);
      return params.id === answer.id
        ? productResponse(answer)
        : HttpResponse.json<ErrorBody>(
            { error: { code: "NOT_FOUND", message: "boom" } },
            { status: 404 },
          );
    },
  );

/** POST /v1/admin/products (create). */
export const createProductHandler = (answer: Answer) =>
  http.post<never, ProductWrite, AdminProductDetail | ErrorBody>(
    apiUrl("/v1/admin/products"),
    ({ request }) => answer(request),
  );

/** PUT /v1/admin/products/{id} (update, with `version`). */
export const updateProductHandler = (answer: Answer) =>
  http.put<{ id: string }, ProductWrite, AdminProductDetail | ErrorBody>(
    apiUrl("/v1/admin/products/{id}"),
    ({ request }) => answer(request),
  );

/** DELETE /v1/admin/products/{id} (archive): 204 unless told otherwise. */
export const archiveProductHandler = (answer: Answer = () => noContent()) =>
  http.delete<{ id: string }, never, ErrorBody>(
    apiUrl("/v1/admin/products/{id}"),
    ({ request }) => answer(request),
  );

/** POST …/variants/{variant_id}/stock-adjustments. */
export const stockAdjustmentHandler = (answer: Answer) =>
  http.post<
    { id: string; variant_id: string },
    StockAdjustment,
    AdminVariantDetail | ErrorBody
  >(
    apiUrl("/v1/admin/products/{id}/variants/{variant_id}/stock-adjustments"),
    ({ request }) => answer(request),
  );

/** POST …/images/uploads: an image record and its storage ticket. */
export const startUploadHandler = (answer: Answer) =>
  http.post<{ id: string }, ImageUploadRequest, ImageUploadDetail | ErrorBody>(
    apiUrl("/v1/admin/products/{id}/images/uploads"),
    ({ request }) => answer(request),
  );

/** POST …/images/{image_id}/confirm. */
export const confirmImageHandler = (answer: Answer) =>
  http.post<
    { id: string; image_id: string },
    { alt: string },
    AdminProductImageDetail | ErrorBody
  >(
    apiUrl("/v1/admin/products/{id}/images/{image_id}/confirm"),
    ({ request }) => answer(request),
  );

/** DELETE …/images/{image_id}: 204 unless told otherwise. */
export const deleteImageHandler = (answer: Answer = () => noContent()) =>
  http.delete<{ id: string; image_id: string }, never, ErrorBody>(
    apiUrl("/v1/admin/products/{id}/images/{image_id}"),
    ({ request }) => answer(request),
  );

/** GET /v1/categories. */
export const categoriesHandler = (answer: Answer | CategoryList["data"]) =>
  http.get<never, never, CategoryList | ErrorBody>(
    apiUrl("/v1/categories"),
    answerOr(answer, categoriesResponse),
  );

/** Where the fake storage takes uploads (a presigned PUT URL's host). */
export const STORAGE_URL = "http://storage.test";

/**
 * PUT to the object storage, the way a presigned URL is answered: 200
 * with no body unless told otherwise. The photo upload itself goes
 * through XMLHttpRequest (for its progress events); MSW intercepts that
 * too, but a test of progress uses the fake XHR in src/test/fake-xhr.ts.
 */
export const storagePutHandler = (
  answer: Answer = () => new HttpResponse(null, { status: 200 }),
) => http.put(`${STORAGE_URL}/*`, ({ request }) => answer(request));
