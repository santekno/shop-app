import { useCallback, useEffect, useState } from "react";
import { isApiError, listProducts } from "@goshop/shared";
import type { ListProductsQuery, Product } from "@goshop/shared";
import { api } from "@/lib/api.ts";

/** What can narrow a product list: listProducts' query without the cursor, which the hook manages. */
export type ProductFilters = Omit<ListProductsQuery, "cursor">;

/** Everything the hook remembers about one list. */
interface ListState {
  /** The filters these products belong to, as one string: a change starts a fresh list. */
  key: string;
  /** Every page loaded so far, in order. */
  products: Product[];
  /** The page being loaded, or the last one loaded; null is the first page. */
  cursor: string | null;
  /** page.next_cursor of the last page that arrived; null after the last page. */
  nextCursor: string | null;
  phase: "loading" | "ready" | "error";
  error: unknown;
  /** Raised by retry, so the effect asks for the same page again. */
  attempt: number;
}

const freshList = (key: string): ListState => ({
  key,
  products: [],
  cursor: null,
  nextCursor: null,
  phase: "loading",
  error: undefined,
  attempt: 0,
});

/**
 * Loads GET /v1/products page by page: the first page at once, the next
 * one each time `loadMore` is called, appended to `products`.
 *
 * - `phase` is "loading" while a page is on its way (first or next),
 *   "error" when the last request failed (call `retry`), else "ready".
 * - `hasMore` is true while the API has another page. A page may hold
 *   fewer products than `limit`, even none, so only `hasMore` says when
 *   the list is complete.
 * - Changing the filters starts a new list from the first page; leaving
 *   the page aborts the request in flight.
 *
 * @example
 *   const { products, phase, hasMore, loadMore } = useProducts({ limit: 12 });
 */
export const useProducts = (filters: ProductFilters = {}) => {
  // Primitive values, not the filters object: a caller that writes
  // useProducts({ limit: 12 }) passes a new object on every render, and the
  // effect below must not restart for that.
  const { category, q, sort, limit } = filters;
  const key = JSON.stringify([category, q, sort, limit]);

  const [state, setState] = useState(() => freshList(key));
  // New filters mean a new list. Calling setState while rendering, behind
  // a comparison with the previous key, is React's way to adjust state
  // when a prop changes: React renders again at once, before anything
  // reaches the screen, so the old filters' products never show under the
  // new ones. An effect would do the same one render late. And the new
  // list is stored, not just computed: switching back to earlier filters
  // must not find their old list, whose cursor points at a page that was
  // already loaded.
  // (The rest of this render still sees the old list; React throws its
  // result away and runs no effect for it.)
  if (state.key !== key) {
    setState(freshList(key));
  }
  const { cursor, attempt } = state;

  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      try {
        const page = await listProducts(
          api,
          { category, q, sort, limit, cursor: cursor ?? undefined },
          { signal: controller.signal },
        );
        if (controller.signal.aborted) return;
        // A next cursor equal to the one just used would ask for this page
        // again on every "load more" (and append it each time): treat it as
        // the end of the list. The API never sends one; this keeps a bug
        // there from turning into an endless list here.
        const next = page.page.next_cursor;
        const nextCursor = next !== null && next === cursor ? null : next;
        setState((list) => {
          if (list.key !== key) return list;
          return {
            ...list,
            products:
              cursor === null ? page.data : [...list.products, ...page.data],
            nextCursor,
            phase: "ready",
            error: undefined,
          };
        });
      } catch (error) {
        if (controller.signal.aborted || isApiError(error, "ABORTED")) return;
        setState((list) =>
          list.key === key ? { ...list, phase: "error", error } : list,
        );
      }
    };
    void load();
    return () => {
      controller.abort();
    };
  }, [key, category, q, sort, limit, cursor, attempt]);

  // Both callbacks change the state through an updater function, so they
  // need nothing from the current render but the key: they stay the same
  // function until the filters change.
  const loadMore = useCallback(() => {
    setState((list) => {
      if (list.key !== key) return list;
      if (list.phase !== "ready" || list.nextCursor === null) return list;
      return { ...list, cursor: list.nextCursor, phase: "loading" };
    });
  }, [key]);

  const retry = useCallback(() => {
    setState((list) => {
      if (list.key !== key) return list;
      if (list.phase !== "error") return list;
      return {
        ...list,
        phase: "loading",
        error: undefined,
        attempt: list.attempt + 1,
      };
    });
  }, [key]);

  return {
    products: state.products,
    phase: state.phase,
    error: state.error,
    hasMore: state.nextCursor !== null,
    loadMore,
    retry,
  };
};
