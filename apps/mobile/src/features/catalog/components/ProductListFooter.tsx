import { Text } from "react-native";

import { ErrorState, LoadingState } from "@/components/StatusMessage";

interface ProductListFooterProps {
  /** Products on screen so far. */
  count: number;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  /** The last next page failed; `error` says why. */
  isFetchNextPageError: boolean;
  error: unknown;
  fetchNextPage: () => void;
}

/**
 * Below the last row of cards: the next page loading, the next page that
 * failed (with a retry, since the list does not retry by itself), or the
 * end of the list. Nothing while there is more to load and nothing is
 * running: the list asks for the next page as the buyer nears the end
 * (FlatList's onEndReached), which on the web is the sentinel's job.
 */
export function ProductListFooter({
  count,
  hasNextPage,
  isFetchingNextPage,
  isFetchNextPageError,
  error,
  fetchNextPage,
}: ProductListFooterProps) {
  if (isFetchingNextPage) {
    return <LoadingState label="Memuat produk berikutnya…" />;
  }
  if (isFetchNextPageError) {
    return <ErrorState error={error} onRetry={fetchNextPage} />;
  }
  // An empty list has its own message (ListEmptyComponent).
  if (!hasNextPage && count > 0) {
    return (
      <Text className="p-4 text-center font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
        Semua produk sudah ditampilkan.
      </Text>
    );
  }
  return null;
}
