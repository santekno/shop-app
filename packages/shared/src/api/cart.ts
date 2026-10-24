import type { ApiClient } from "./client.ts";
import type { EndpointOptions } from "./catalog.ts";
import type { Cart, CartAddResult, CartDetail, CartItemAdd } from "./types.ts";

/** Options of the cart endpoints: the abort signal and the guest cart. */
export interface CartRequestOptions extends EndpointOptions {
  /**
   * The guest cart's token, sent as X-Cart-Token. Leave it out (or pass
   * null) for a guest who has no cart yet. Bab 10 adds the logged-in
   * user's cart, which the API finds by the access token instead.
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
