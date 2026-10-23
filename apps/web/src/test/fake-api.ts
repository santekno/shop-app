// A stand-in for "@/lib/api.ts" in component and hook tests:
//
//   vi.mock("@/lib/api.ts", () => import("@/test/fake-api.ts"));
//
// It is the real client from @goshop/shared, so request building, error
// mapping and cancelling all run for real; only the network is fake, through
// the client's injectable `fetch`. No retries, so a failure shows at once
// (src/lib/api.test.ts covers the storefront's retry settings).
import { createApiClient } from "@goshop/shared";
import type { Category, Product, ProductVariant } from "@goshop/shared";
import { vi } from "vitest";

export const API_URL = "http://api.test";

export const fetchMock = vi.fn<typeof fetch>();

export const api = createApiClient({
  baseUrl: API_URL,
  fetch: fetchMock,
  retries: 0,
});

/** The body of GET /v1/categories. */
export const categoriesResponse = (categories: Category[]) =>
  Response.json({ data: categories });

/** An API error response, optionally with an X-Request-ID. */
export const errorResponse = (
  status: number,
  code: string,
  requestId?: string,
) =>
  Response.json(
    { error: { code, message: "boom" } },
    {
      status,
      headers: requestId === undefined ? {} : { "X-Request-ID": requestId },
    },
  );

/** A promise and the functions that settle it, for answering a request later. */
export const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

export const category = (
  id: string,
  name: string,
  parentId: string | null = null,
): Category => ({ id, slug: name.toLowerCase(), name, parent_id: parentId });

/** A variant: 10 in stock at Rp 89.000 unless told otherwise. */
export const variant = (
  id: string,
  overrides: Partial<ProductVariant> = {},
): ProductVariant => ({
  id,
  sku: `SKU-${id.toUpperCase()}`,
  name: id.toUpperCase(),
  price: { amount: 89_000, currency: "IDR" },
  stock: 10,
  ...overrides,
});

/**
 * A product the way the API sends it: price_from is the cheapest variant
 * and in_stock says whether any variant has stock, unless overridden.
 */
export const product = (
  slug: string,
  overrides: Partial<Product> = {},
): Product => {
  const variants = overrides.variants ?? [variant(`${slug}-m`)];
  return {
    id: `id-${slug}`,
    slug,
    name: `Produk ${slug}`,
    description: `Deskripsi ${slug}.`,
    category: category("c-kaos", "Kaos"),
    price_from: {
      amount: Math.min(...variants.map((v) => v.price.amount)),
      currency: "IDR",
    },
    in_stock: variants.some((v) => v.stock > 0),
    variants,
    images: [],
    created_at: "2026-10-01T00:00:00Z",
    ...overrides,
  };
};

/** The body of GET /v1/products: one page and the cursor of the next one. */
export const productsResponse = (
  products: Product[],
  nextCursor: string | null = null,
) => Response.json({ data: products, page: { next_cursor: nextCursor } });

/** The body of GET /v1/products/{slug}. */
export const productResponse = (item: Product) => Response.json({ data: item });

/** Formats like the storefront does, for comparing with rendered text. */
export const rupiah = (amount: number) =>
  new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(amount);

/** The URL of a fetch call, for routing a fake answer by path. */
export const requestUrl = (input: RequestInfo | URL): URL =>
  new URL(
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : input.url,
  );

/**
 * Answers every request with `handler`, given the URL and the init; a
 * route the test does not know answers 404 NOT_FOUND.
 */
export const serve = (
  handler: (
    url: URL,
    init: RequestInit | undefined,
  ) => Promise<Response> | Response | undefined,
) => {
  fetchMock.mockImplementation(async (input, init) => {
    const response = await handler(requestUrl(input), init);
    return response ?? errorResponse(404, "NOT_FOUND");
  });
};
