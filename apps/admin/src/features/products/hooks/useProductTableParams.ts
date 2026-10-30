import { useCallback, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import {
  nextProductTableParams,
  productTableSearchParams,
  readProductTableParams,
} from "../product-table-params.ts";
import type { ProductTableParams } from "../product-table-params.ts";

interface UpdateOptions {
  /**
   * Replace the current history entry instead of adding one. The search
   * field uses it while a search is being refined, so Back skips the
   * in-between words ("k", "ka", "kao") and goes to the page before.
   */
  replace?: boolean;
}

/**
 * The product table's state, kept in the URL's query string instead of
 * in React state:
 *
 * - a link to "/produk?status=draf&urut=harga" opens the table exactly
 *   so: a seller can bookmark a view or send it to a colleague;
 * - the browser's Back and Forward buttons step through what the seller
 *   did (each filter, sort or page is a history entry);
 * - a reload keeps the table as it was.
 *
 * The URL is the source: `params` is read from it (memoised on the query
 * string), and `update` writes a new query string, which React Router
 * turns into a new render.
 *
 * With one short-lived exception, the change on its way. React Router
 * navigates inside a transition (React's startTransition), so the new URL
 * reaches the page a moment after the click, as a non-urgent render. A
 * controlled checkbox or select whose value came only from the URL would
 * meanwhile be put back to the old value by React (the click's own render
 * still sees the old URL), and then flip again: a visible flicker, and a
 * test's `check()` that sees the box unchecked. So `update` also sets
 * `pending`, an urgent state the controls show at once, and every new URL
 * replaces it ("storing information from previous renders", React's
 * documented alternative to an effect). `pending` never outlives the next
 * URL, so the URL stays the truth: Back, a link or a reload win.
 *
 * `update(change)` merges the change into the current state with
 * nextProductTableParams (any change but the page goes back to page 1).
 * Several updates in one event all count: each builds on the one before
 * (`latest`), not on the URL, which has not changed yet.
 */
export const useProductTableParams = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const fromUrl = useMemo(
    () => readProductTableParams(searchParams),
    [searchParams],
  );

  // The change on its way to the URL (null when the URL is current), and
  // the URL's state it was made against.
  const [pending, setPending] = useState<ProductTableParams | null>(null);
  const [seen, setSeen] = useState(fromUrl);
  if (fromUrl !== seen) {
    // A new URL arrived (ours, or Back, or a link): it wins.
    setSeen(fromUrl);
    setPending(null);
  }

  // What the last update asked for, and the URL's state it was made
  // against. setSearchParams(fn) cannot stack two updates: its `fn` gets
  // the query string of the render that made the setter, so a second
  // update in the same event would start from the old URL and drop the
  // first. A ref is current at once; it is read and written only in
  // `update`, never while rendering.
  const latest = useRef<{
    base: ProductTableParams;
    params: ProductTableParams;
  } | null>(null);

  const update = useCallback(
    (
      change: Partial<ProductTableParams>,
      { replace = false }: UpdateOptions = {},
    ) => {
      // Build on the last update while the URL is still the one it was
      // made against; once any other URL has arrived (ours, or Back, or a
      // link), build on that URL.
      const current =
        latest.current?.base === fromUrl ? latest.current.params : fromUrl;
      const next = nextProductTableParams(current, change);
      latest.current = { base: fromUrl, params: next };
      setPending(next);
      setSearchParams(productTableSearchParams(next), { replace });
    },
    [fromUrl, setSearchParams],
  );

  return { params: pending ?? fromUrl, update };
};
