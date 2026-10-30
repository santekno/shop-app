import { useCallback, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { readReportParams, reportSearchParams } from "../report-params.ts";
import type { ReportParams } from "../report-params.ts";

/**
 * The report's state, kept in the URL's query string, like the product
 * table's (features/products/hooks/useProductTableParams.ts, where the
 * reasons are written out): a link opens the same report, Back steps
 * through what the seller chose, a reload keeps it.
 *
 * `pending` is the same short-lived exception: React Router applies a new
 * URL inside a transition, a moment after the click, and a radio button
 * controlled only by the URL would jump back to the old range in
 * between. `update` therefore also sets `pending`, an urgent state the
 * controls show at once, and the next URL to arrive replaces it.
 *
 * `update(change)` merges the change into the current state. Several
 * updates in one event all count, built on each other in `latest`, as in
 * the product table.
 */
export const useReportParams = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const fromUrl = useMemo(() => readReportParams(searchParams), [searchParams]);

  const [pending, setPending] = useState<ReportParams | null>(null);
  const [seen, setSeen] = useState(fromUrl);
  if (fromUrl !== seen) {
    // A new URL arrived (ours, or Back, or a link): it wins.
    setSeen(fromUrl);
    setPending(null);
  }

  // The last update and the URL's state it was made against: a ref,
  // because setSearchParams(fn) hands `fn` this render's query string,
  // not the one the previous update asked for.
  const latest = useRef<{ base: ReportParams; params: ReportParams } | null>(
    null,
  );

  const update = useCallback(
    (change: Partial<ReportParams>) => {
      const current =
        latest.current?.base === fromUrl ? latest.current.params : fromUrl;
      const next = { ...current, ...change };
      latest.current = { base: fromUrl, params: next };
      setPending(next);
      setSearchParams(reportSearchParams(next));
    },
    [fromUrl, setSearchParams],
  );

  return { params: pending ?? fromUrl, update };
};
