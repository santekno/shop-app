import { useCallback, useMemo, useState } from "react";
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
 * `update(change)` merges the change into the current state.
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

  const update = useCallback(
    (change: Partial<ReportParams>) => {
      setPending((current) => ({ ...(current ?? fromUrl), ...change }));
      setSearchParams((current) =>
        reportSearchParams({ ...readReportParams(current), ...change }),
      );
    },
    [fromUrl, setSearchParams],
  );

  return { params: pending ?? fromUrl, update };
};
