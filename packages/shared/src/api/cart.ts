import type { ApiClient } from "./client.ts";
import type { EndpointOptions } from "./catalog.ts";
import type {
  Cart,
  CartAddResult,
  CartDetail,
  CartItemAdd,
  CartItemPatch,
} from "./types.ts";

/** Options of the cart endpoints: the abort signal and the guest cart. */
export interface CartRequestOptions extends EndpointOptions {
  /**
   * The guest cart's token, sent as X-Cart-Token. Leave it out (or pass
   * null) for a guest who has no cart yet. A logged-in user's cart is
   * found by the access token instead: call with a client that sends
   * Authorization, and without a cart token.
   */
  cartToken?: string | null | undefined;
}

/** A cart with no lines: what a guest without a cart token has. */
export const EMPTY_CART: Readonly<Cart> = {
  lines: [],
  item_count: 0,
  subtotal: { amount: 0, currency: "IDR" },
};

const cartHeaders = (
  cartToken: string | null | undefined,
): HeadersInit | undefined =>
  cartToken === null || cartToken === undefined || cartToken === ""
    ? undefined
    : { "X-Cart-Token": cartToken };

/**
 * GET /v1/cart: the guest cart named by `cartToken`, oldest line first.
 * A token the API no longer knows (malformed, expired or merged) throws
 * an ApiError with code CART_NOT_FOUND: forget it.
 */
export const getCart = async (
  api: ApiClient,
  { cartToken, signal }: CartRequestOptions = {},
): Promise<Cart> => {
  const body = await api.request<CartDetail>("/v1/cart", {
    headers: cartHeaders(cartToken),
    signal,
  });
  return body.data;
};

/** What addCartItem returns. */
export interface AddCartItemResult {
  /** The whole cart after the change. */
  cart: Cart;
  /**
   * Only when this request created the guest cart: its token, sent once.
   * Keep it and pass it to every later cart call.
   */
  cartToken: string | undefined;
}

/**
 * POST /v1/cart/items: adds `quantity` units of a variant (a variant
 * already in the cart gets the sum). Without a token the API creates a
 * guest cart and returns its token. Conflicts throw an ApiError with code
 * INSUFFICIENT_STOCK (`details.available`), QUANTITY_LIMIT (99 per line),
 * CART_FULL (50 lines) or VARIANT_UNAVAILABLE. Never retried: a POST sent
 * twice would add twice.
 */
export const addCartItem = async (
  api: ApiClient,
  item: CartItemAdd,
  { cartToken, signal }: CartRequestOptions = {},
): Promise<AddCartItemResult> => {
  const body = await api.request<CartAddResult>("/v1/cart/items", {
    method: "POST",
    body: item,
    headers: cartHeaders(cartToken),
    signal,
  });
  return { cart: body.data, cartToken: body.cart_token };
};

/** The path of one cart line; the variant id is escaped like any URL part. */
const linePath = (variantId: string): string =>
  `/v1/cart/items/${encodeURIComponent(variantId)}`;

/**
 * PATCH /v1/cart/items/{variant_id}: replaces the line's quantity (1–99,
 * at most the stock) and takes today's price as the one the buyer has
 * seen. Saving the same quantity again is how a buyer accepts a changed
 * price (`problem: "price_changed"`). Answers with the whole cart.
 * Conflicts throw INSUFFICIENT_STOCK (`details.available`) or
 * VARIANT_UNAVAILABLE; a line that is not in the cart throws NOT_FOUND.
 * Not retried by the client (only GET is), although sending the same
 * quantity twice would be harmless.
 */
export const updateCartItem = async (
  api: ApiClient,
  variantId: string,
  patch: CartItemPatch,
  { cartToken, signal }: CartRequestOptions = {},
): Promise<Cart> => {
  const body = await api.request<CartDetail>(linePath(variantId), {
    method: "PATCH",
    body: patch,
    headers: cartHeaders(cartToken),
    signal,
  });
  return body.data;
};

/**
 * DELETE /v1/cart/items/{variant_id}: removes the line and answers with
 * the cart that is left. A line that is already gone throws NOT_FOUND.
 */
export const removeCartItem = async (
  api: ApiClient,
  variantId: string,
  { cartToken, signal }: CartRequestOptions = {},
): Promise<Cart> => {
  const body = await api.request<CartDetail>(linePath(variantId), {
    method: "DELETE",
    headers: cartHeaders(cartToken),
    signal,
  });
  return body.data;
};

/**
 * POST /v1/cart/merge: moves the guest cart `cartToken` into the logged-in
 * user's cart and answers with the user's cart. Needs an access token (a
 * client that sends Authorization). The guest cart is deleted, so forget
 * its token after this succeeds, and after CART_NOT_FOUND too (it was
 * already merged, or cleaned up). A line the user's cart cannot take (sold
 * out, over 99, past 50 lines) is dropped, not an error.
 */
export const mergeCart = async (
  api: ApiClient,
  cartToken: string,
  { signal }: EndpointOptions = {},
): Promise<Cart> => {
  const body = await api.request<CartDetail>("/v1/cart/merge", {
    method: "POST",
    headers: { "X-Cart-Token": cartToken },
    signal,
  });
  return body.data;
};
