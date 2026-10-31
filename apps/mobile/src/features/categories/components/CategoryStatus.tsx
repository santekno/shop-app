// The Kategori screen before it has a list: loading, offline, or failed
// with a way to try again. The empty list is the list's own state
// (CategoryList).
//
// Each state is the app's own component from src/components/StatusMessage
// (Beranda's), centred in the whole screen: the same words for the same
// failure, the same announcement to screen readers, one place to fix them.
import type { ReactNode } from "react";
import { View } from "react-native";

import {
  EmptyState,
  ErrorState,
  LoadingState,
} from "@/components/StatusMessage";

/** The screen's background, with one state in the middle of it. */
function Centred({ children }: { children: ReactNode }) {
  return (
    <View className="flex-1 items-center justify-center bg-background p-6 dark:bg-background-dark">
      {children}
    </View>
  );
}

/** A spinner with words, so a screen reader has something to announce. */
export function CategoryLoading() {
  return (
    <Centred>
      <LoadingState label="Memuat kategori…" />
    </Centred>
  );
}

/**
 * No network before the first load: the query waits (fetchStatus
 * "paused", src/lib/query-client.ts) and runs by itself when the network
 * is back, so there is nothing to retry; the same words as Beranda's.
 */
export function CategoryOffline() {
  return (
    <Centred>
      <EmptyState message="Tidak ada koneksi internet. Kategori dimuat begitu koneksi kembali." />
    </Centred>
  );
}

interface CategoryErrorProps {
  error: unknown;
  onRetry: () => void;
}

/**
 * The error in the app's words (src/lib/error-message.ts, by error code),
 * the request ID to quote when reporting it, and "Coba lagi". ErrorState
 * has screen readers announce it when it appears.
 */
export function CategoryError({ error, onRetry }: CategoryErrorProps) {
  return (
    <Centred>
      <ErrorState error={error} onRetry={onRetry} />
    </Centred>
  );
}
