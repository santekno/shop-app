import { useEffect } from "react";
import type { Product } from "@goshop/shared";

import { toRecentItem } from "../recent-state";
import { useRecentStore } from "../store";

/** The list for the home section, and whether it can be trusted yet. */
export const useRecentlyViewed = () => {
  const items = useRecentStore((state) => state.items);
  const hydrated = useRecentStore((state) => state.hydrated);
  const clear = useRecentStore((state) => state.clear);
  return { items, hydrated, clear };
};

/**
 * Records `product` as viewed, once it has loaded. Call it with the query's
 * data: undefined while loading, offline or failed records nothing, so a
 * slug that names no product never enters the list. A refetch of the same
 * page changes nothing (addRecent returns the same list).
 */
export function useRecordRecentlyViewed(product: Product | undefined): void {
  const record = useRecentStore((state) => state.record);
  useEffect(() => {
    if (product !== undefined) record(toRecentItem(product));
  }, [product, record]);
}
