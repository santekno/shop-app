// The wishlist's requests. @goshop/shared has the generated types for these
// three operations (schema.gen.ts) but no endpoint functions yet, so they
// are written here on the shared client's `request`, the same call the
// shared functions make. Moving them into packages/shared is
// frontend-engineer's call (reported).
//
// Every request reads the token from the seam at the moment it is sent
// (auth-seam.ts) and puts it in that request's Authorization header only.
import type { ProductList } from "@goshop/shared";

import { api } from "@/lib/api";
import { getAccessToken } from "../auth-seam";
import { SignInRequiredError } from "../messages";

/** The wishlist keeps at most 200 products, and a page holds at most 100. */
export const WISHLIST_PAGE_SIZE = 100;

/** 200 products at 100 a page is 2 pages; one spare against a bigger limit. */
const MAX_PAGES = 3;

const authHeaders = (): { Authorization: string } => {
  const token = getAccessToken();
  if (token === null) throw new SignInRequiredError();
  return { Authorization: `Bearer ${token}` };
};

const itemPath = (slug: string) =>
  `/v1/me/wishlist/${encodeURIComponent(slug)}`;

/** GET /v1/me/wishlist: one page, newest saved first. */
export const fetchWishlistPage = (
  cursor: string | null,
  signal?: AbortSignal,
  limit = 20,
): Promise<ProductList> =>
  api.request<ProductList>("/v1/me/wishlist", {
    query: { cursor: cursor ?? undefined, limit },
    headers: authHeaders(),
    signal,
  });

/**
 * The slugs of every saved product, newest first: the hearts' source of
 * truth. The list endpoint returns whole products, so this pages through it
 * (at most 200 products, 2 pages of 100) and keeps the slugs only. A
 * dedicated "ids" endpoint would be cheaper; it is a backend need, not
 * worth one before the lists are measured (reported).
 */
export const fetchWishlistSlugs = async (
  signal?: AbortSignal,
): Promise<string[]> => {
  const slugs: string[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const result: ProductList = await fetchWishlistPage(
      cursor,
      signal,
      WISHLIST_PAGE_SIZE,
    );
    for (const product of result.data) slugs.push(product.slug);
    cursor = result.page.next_cursor;
    if (cursor === null) break;
  }
  return slugs;
};

/** PUT /v1/me/wishlist/{slug}: 204, idempotent; 409 when the list is full. */
export const addToWishlist = async (slug: string): Promise<void> => {
  await api.request<undefined>(itemPath(slug), {
    method: "PUT",
    headers: authHeaders(),
  });
};

/** DELETE /v1/me/wishlist/{slug}: 204, idempotent. */
export const removeFromWishlist = async (slug: string): Promise<void> => {
  await api.request<undefined>(itemPath(slug), {
    method: "DELETE",
    headers: authHeaders(),
  });
};
