// The three states loaded data can be in besides "here it is": loading,
// empty, failed. The phone's version of the storefront's
// components/ui/StatusMessage.tsx, with the same words.
import { ActivityIndicator, Pressable, Text, View } from "react-native";

import { errorMessage, errorRequestId } from "@/lib/error-message";

/**
 * A spinner with a label. ActivityIndicator is the platform's own: a
 * circle on Android, the spokes on iOS. Its colour is a class too:
 * NativeWind hands the `color` of text-primary to the indicator's `color`
 * prop. The label is what a screen reader announces.
 */
export function LoadingState({ label }: { label: string }) {
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      className="items-center gap-2 p-4"
    >
      <ActivityIndicator className="text-primary dark:text-primary-dark" />
      <Text className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
        {label}
      </Text>
    </View>
  );
}

/** Nothing to show, such as a search that matched no product. */
export function EmptyState({ message }: { message: string }) {
  return (
    <Text className="p-4 text-center font-sans text-base text-muted-foreground dark:text-muted-foreground-dark">
      {message}
    </Text>
  );
}

interface ErrorStateProps {
  error: unknown;
  /** Shows a "Coba lagi" button that calls it. */
  onRetry?: () => void;
}

/**
 * What went wrong, in Indonesian, with the request ID to quote and a retry
 * button. accessibilityRole "alert" makes TalkBack and VoiceOver announce
 * it when it appears, the web's role="alert".
 */
export function ErrorState({ error, onRetry }: ErrorStateProps) {
  const requestId = errorRequestId(error);
  return (
    <View accessibilityRole="alert" className="items-center gap-3 p-4">
      <Text className="text-center font-sans text-base text-destructive dark:text-destructive-dark">
        {errorMessage(error)}
      </Text>
      {requestId !== undefined && (
        <Text
          selectable
          className="text-center font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark"
        >
          Kode permintaan: {requestId}
        </Text>
      )}
      {onRetry !== undefined && (
        <Pressable
          accessibilityRole="button"
          onPress={onRetry}
          className="min-h-11 justify-center rounded-md border border-border px-4 active:bg-accent dark:border-border-dark dark:active:bg-accent-dark"
        >
          <Text className="font-sans text-base font-semibold text-primary dark:text-primary-dark">
            Coba lagi
          </Text>
        </Pressable>
      )}
    </View>
  );
}
