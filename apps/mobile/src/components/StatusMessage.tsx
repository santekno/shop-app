// The three states loaded data can be in besides "here it is": loading,
// empty, failed. The phone's version of the storefront's
// components/ui/StatusMessage.tsx, with the same words.
import { ActivityIndicator, Pressable, Text, View } from "react-native";

import { useAnnounceOnIos } from "@/lib/announce";
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
 * button. Screen readers announce it when it appears, as the web's
 * role="alert" does: TalkBack through the live region, VoiceOver through
 * useAnnounceOnIos (src/lib/announce.ts). accessibilityRole "alert" alone
 * would announce nothing on either platform.
 */
export function ErrorState({ error, onRetry }: ErrorStateProps) {
  const message = errorMessage(error);
  const requestId = errorRequestId(error);
  useAnnounceOnIos(message);
  return (
    <View
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      className="items-center gap-3 p-4"
    >
      <Text className="text-center font-sans text-base text-destructive dark:text-destructive-dark">
        {message}
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
          // min-h-12 is 48 dp, Android's smallest touch target (iOS asks
          // for 44 pt), as on every button of the app.
          className="min-h-12 justify-center rounded-md border border-border px-4 active:bg-accent dark:border-border-dark dark:active:bg-accent-dark"
        >
          <Text className="font-sans text-base font-semibold text-primary dark:text-primary-dark">
            Coba lagi
          </Text>
        </Pressable>
      )}
    </View>
  );
}
