import { useCallback, useMemo } from "react";
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
 * The URL is the single source: `params` is read from it on every render
 * (memoised on the query string), and `update` writes a new query string,
 * which React Router turns into a new render. Nothing is copied into
 * state, so the two can never disagree.
 *
 * `update(change)` merges the change into the current state with
 * nextProductTableParams (any change but the page goes back to page 1).
 */
export const useProductTableParams = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const params = useMemo(
    () => readProductTableParams(searchParams),
    [searchParams],
  );

  const update = useCallback(
    (
      change: Partial<ProductTableParams>,
      { replace = false }: UpdateOptions = {},
    ) => {
      // The functional form reads the query string as it is now, not as
      // it was at this render: two updates in a row both count.
      setSearchParams(
        (current) =>
          productTableSearchParams(
            nextProductTableParams(readProductTableParams(current), change),
          ),
        { replace },
      );
    },
    [setSearchParams],
  );

  return { params, update };
};
