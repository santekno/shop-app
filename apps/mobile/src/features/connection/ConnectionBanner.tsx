import { Text } from "react-native";
import Animated, {
  FadeOut,
  ReduceMotion,
  SlideInDown,
} from "react-native-reanimated";

import { useAnnounceOnIos } from "@/lib/announce";
import { useConnectionBanner } from "./useConnectionBanner";
import type { ConnectionBannerState } from "./useConnectionBanner";

const MESSAGES: Record<Exclude<ConnectionBannerState, "hidden">, string> = {
  offline: "Anda sedang offline. Data yang tampil mungkin sudah lama.",
  restored: "Kembali online. Memperbarui data…",
};

// Built once, outside the component: a layout animation is a description
// (a duration, an easing), not a running thing, and the same object can be
// handed to every mount. ReduceMotion.System skips the slide when the
// device's "reduce motion" / "remove animations" setting is on: the banner
// then simply appears and disappears.
const SLIDE_IN = SlideInDown.duration(220).reduceMotion(ReduceMotion.System);
const FADE_OUT = FadeOut.duration(180).reduceMotion(ReduceMotion.System);

/**
 * The connection banner: a bar that slides up above the tab bar when the
 * phone goes offline, and says "Kembali online" for three seconds when it
 * returns. Rendered once by the tab layout (app/(tabs)/_layout.tsx), so it
 * shows on every tab and, being in the layout flow above the tab bar,
 * pushes the screen up instead of covering its last row or the bar.
 *
 * Accessibility: role "alert" with a polite live region. TalkBack reads
 * the text when it appears or changes; iOS has no live regions, so
 * useAnnounceOnIos hands the same text to VoiceOver. "Polite" because
 * being offline is information, not an emergency: it waits for the
 * screen reader to finish what it is saying.
 */
export function ConnectionBanner() {
  const state = useConnectionBanner();
  if (state === "hidden") return null;
  return <Bar state={state} />;
}

function Bar({ state }: { state: Exclude<ConnectionBannerState, "hidden"> }) {
  const message = MESSAGES[state];
  useAnnounceOnIos(message);

  return (
    <Animated.View
      entering={SLIDE_IN}
      exiting={FADE_OUT}
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      accessible
      accessibilityLabel={message}
      className={`min-h-9 justify-center px-4 py-2 ${
        state === "offline"
          ? "bg-destructive dark:bg-destructive-dark"
          : "bg-primary dark:bg-primary-dark"
      }`}
    >
      <Text
        className={`text-center font-sans text-sm font-semibold ${
          state === "offline"
            ? "text-destructive-foreground dark:text-destructive-foreground-dark"
            : "text-primary-foreground dark:text-primary-foreground-dark"
        }`}
      >
        {message}
      </Text>
    </Animated.View>
  );
}
