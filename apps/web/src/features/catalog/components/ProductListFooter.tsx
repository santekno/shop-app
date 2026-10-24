import { useOnVisible } from "@/hooks/useOnVisible.ts";
import {
  EmptyState,
  ErrorState,
  LoadingState,
} from "@/components/ui/StatusMessage.tsx";

interface ProductListFooterProps {
  /** Products on screen so far. */
  count: number;
  /** Whether any filter (category, search) narrows the list. */
  filtered: boolean;
  hasNextPage: boolean;
  /** Any request for this list is running (a next page or a refetch). */
  isFetching: boolean;
  isFetchingNextPage: boolean;
  /** The last next page failed; `error` says why. */
  isFetchNextPageError: boolean;
  error: unknown;
  fetchNextPage: () => void;
}

/**
 * Below the grid: the sentinel that loads the next page when it scrolls
 * into view, and the states around it.
 *
 * "Muat lebih banyak" stays as a real button next to the sentinel. It is
 * how a keyboard or screen-reader user asks for more without scrolling
 * past content they have not read, and how the list keeps working where
 * IntersectionObserver is missing.
 */
export function ProductListFooter({
  count,
  filtered,
  hasNextPage,
  isFetching,
  isFetchingNextPage,
  isFetchNextPageError,
  error,
  fetchNextPage,
}: ProductListFooterProps) {
  // Not while a request runs: fetchNextPage would cancel it and start
  // again. Not after a failed page either: the sentinel is still in view,
  // and loading by itself would retry in a loop; "Coba lagi" does it.
  const canLoadMore = hasNextPage && !isFetching && !isFetchNextPageError;
  const sentinelRef = useOnVisible<HTMLDivElement>(fetchNextPage, {
    enabled: canLoadMore,
  });

  return (
    <div className="catalog__footer">
      {hasNextPage && <div ref={sentinelRef} aria-hidden="true" />}
      {isFetchingNextPage && (
        <LoadingState>Memuat produk berikutnya…</LoadingState>
      )}
      {isFetchNextPageError && (
        <ErrorState error={error} onRetry={fetchNextPage} />
      )}
      {hasNextPage && !isFetchingNextPage && !isFetchNextPageError && (
        // Disabled while the list refetches in the background (a stale
        // list, back on screen): fetchNextPage would cancel that refetch,
        // the same reason the sentinel waits (canLoadMore).
        <button type="button" onClick={fetchNextPage} disabled={isFetching}>
          Muat lebih banyak
        </button>
      )}
      {!hasNextPage && (
        <EmptyState>
          {count === 0
            ? filtered
              ? "Tidak ada produk yang cocok."
              : "Belum ada produk."
            : "Semua produk sudah ditampilkan."}
        </EmptyState>
      )}
    </div>
  );
}
