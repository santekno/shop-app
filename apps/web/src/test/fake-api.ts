// A stand-in for "@/lib/api.ts" in component and hook tests:
//
//   vi.mock("@/lib/api.ts", () => import("@/test/fake-api.ts"));
//
// It is the real client from @goshop/shared, so request building, error
// mapping and cancelling all run for real; only the network is fake, through
// the client's injectable `fetch`. No retries, so a failure shows at once
// (src/lib/api.test.ts covers the storefront's retry settings).
import { createApiClient } from "@goshop/shared";
import type {
  Cart,
  CartLine,
  Category,
  Product,
  ProductVariant,
  User,
  WebSession,
} from "@goshop/shared";
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

/** A cart line: 1 unit of `variantId` at Rp 89.000 unless told otherwise. */
export const cartLine = (
  variantId: string,
  overrides: Partial<CartLine> = {},
): CartLine => {
  const quantity = overrides.quantity ?? 1;
  const unitPrice = overrides.unit_price ?? { amount: 89_000, currency: "IDR" };
  return {
    variant_id: variantId,
    product_id: `p-${variantId}`,
    product_slug: `produk-${variantId}`,
    product_name: `Produk ${variantId}`,
    variant_name: variantId.toUpperCase(),
    sku: `SKU-${variantId.toUpperCase()}`,
    quantity,
    unit_price: unitPrice,
    price_when_added: unitPrice,
    line_total: { amount: unitPrice.amount * quantity, currency: "IDR" },
    stock: 10,
    weight_grams: 200,
    problem: null,
    ...overrides,
  };
};

/** A cart whose count and subtotal add up from its lines. */
export const cartOf = (lines: CartLine[]): Cart => ({
  lines,
  item_count: lines.reduce((sum, line) => sum + line.quantity, 0),
  subtotal: {
    amount: lines.reduce((sum, line) => sum + line.line_total.amount, 0),
    currency: "IDR",
  },
});

/** The body of GET /v1/cart, or of POST /v1/cart/items with a new token. */
export const cartResponse = (cart: Cart, cartToken?: string, status = 200) =>
  Response.json(
    cartToken === undefined
      ? { data: cart }
      : { data: cart, cart_token: cartToken },
    { status },
  );

/** An API error with details, such as 409 INSUFFICIENT_STOCK. */
export const detailedErrorResponse = (
  status: number,
  code: string,
  details: Record<string, unknown>,
) => Response.json({ error: { code, message: "boom", details } }, { status });

/** An account as the API returns it. */
export const user = (overrides: Partial<User> = {}): User => ({
  id: "u1",
  email: "budi@example.com",
  name: "Budi",
  phone: null,
  role: "buyer",
  email_verified: false,
  created_at: "2026-10-01T00:00:00Z",
  ...overrides,
});

/** The body of POST /v1/auth/login. */
export const tokensResponse = (account: User = user()) =>
  Response.json({
    data: {
      access_token: "access-token",
      token_type: "Bearer",
      expires_in: 900,
      refresh_token: "refresh-token",
      refresh_expires_in: 2_592_000,
      user: account,
    },
  });

/**
 * A web session as POST /v1/auth/web/login and /web/refresh answer it: the
 * access token and the account, never a refresh token (that is the
 * httpOnly cookie). 15 minutes unless told otherwise.
 */
export const webSession = (
  account: User = user(),
  accessToken = "access-token",
  expiresIn = 900,
): WebSession => ({
  access_token: accessToken,
  token_type: "Bearer",
  expires_in: expiresIn,
  user: account,
});

/** The body of POST /v1/auth/web/login or /web/refresh. */
export const webSessionResponse = (
  account: User = user(),
  accessToken = "access-token",
  expiresIn = 900,
) => Response.json({ data: webSession(account, accessToken, expiresIn) });

/** 204 No Content: /web/refresh without a cookie, /web/logout. */
export const noContentResponse = () => new Response(null, { status: 204 });

/** The body of POST /v1/auth/register. */
export const userResponse = (account: User = user()) =>
  Response.json({ data: account }, { status: 201 });

/** 400 VALIDATION_FAILED with one message per field. */
export const validationResponse = (details: Record<string, string>) =>
  detailedErrorResponse(400, "VALIDATION_FAILED", details);
