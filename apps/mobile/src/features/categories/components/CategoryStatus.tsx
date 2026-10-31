// The Kategori screen before it has a list: loading, or failed with a way
// to try again. The empty list is the list's own state (CategoryList).
import { useTheme } from "expo-router";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { isApiError } from "@goshop/shared";

/** A spinner with words, so a screen reader has something to announce. */
export function CategoryLoading() {
  const { colors } = useTheme();
  return (
    <View
      accessible
      accessibilityLabel="Memuat kategori"
      accessibilityState={{ busy: true }}
      className="flex-1 items-center justify-center gap-3 bg-background p-6 dark:bg-background-dark"
    >
      <ActivityIndicator size="large" color={colors.primary} />
      <Text className="text-base text-muted-foreground dark:text-muted-foreground-dark">
        Memuat kategori…
      </Text>
    </View>
  );
}

/**
 * A short Indonesian sentence for what went wrong. The API's own `message`
 * is English and meant for developers, so the text is picked from the
 * error code, as apps/web/src/lib/error-message.ts does.
 */
const errorMessage = (error: unknown): string => {
  if (isApiError(error, "NETWORK_ERROR")) {
    return "Tidak dapat terhubung ke server GoShop. Periksa koneksi internet Anda, lalu coba lagi.";
  }
  if (isApiError(error, "CLIENT_TIMEOUT", "TIMEOUT")) {
    return "Server GoShop terlalu lama merespons. Coba lagi sebentar lagi.";
  }
  if (isApiError(error, "RATE_LIMITED")) {
    return "Terlalu banyak permintaan. Tunggu sebentar, lalu coba lagi.";
  }
  return "Terjadi kesalahan saat memuat kategori. Coba lagi.";
};

interface CategoryErrorProps {
  error: unknown;
  onRetry: () => void;
}

/**
 * The error, the request ID to quote when reporting it, and "Coba lagi".
 * accessibilityRole "alert" (with a live region on Android) makes screen
 * readers announce it when it appears.
 */
export function CategoryError({ error, onRetry }: CategoryErrorProps) {
  const requestId = isApiError(error) ? error.requestId : undefined;
  return (
    <View className="flex-1 items-center justify-center gap-3 bg-background p-6 dark:bg-background-dark">
      <View
        accessibilityRole="alert"
        accessibilityLiveRegion="polite"
        className="items-center gap-1"
      >
        <Text className="text-center text-base text-destructive dark:text-destructive-dark">
          {errorMessage(error)}
        </Text>
        {requestId !== undefined && (
          <Text
            selectable
            className="text-sm text-muted-foreground dark:text-muted-foreground-dark"
          >
            Kode permintaan: {requestId}
          </Text>
        )}
      </View>
      <Pressable
        onPress={onRetry}
        accessibilityRole="button"
        className="min-h-12 justify-center rounded-lg bg-primary px-5 active:opacity-80 dark:bg-primary-dark"
      >
        <Text className="text-base font-semibold text-primary-foreground dark:text-primary-foreground-dark">
          Coba lagi
        </Text>
      </Pressable>
    </View>
  );
}
