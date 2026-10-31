// Telling a screen reader about something that just appeared, such as an
// error: the web's role="alert". React Native has no single prop for it.
//
// - Android: the element itself carries accessibilityLiveRegion="polite",
//   and TalkBack reads it when it appears or its text changes.
// - iOS: there are no live regions (the prop is Android-only), so the
//   message is handed to VoiceOver with announceForAccessibility.
//
// accessibilityRole "alert" does neither: React Native gives it no trait on
// iOS, and on Android it is only the word TalkBack says for the role.
import { useEffect } from "react";
import { AccessibilityInfo, Platform } from "react-native";

/**
 * Has VoiceOver read `message` when the calling component appears, and
 * again when the message changes. iOS only: on Android the element's live
 * region does it, and announcing there too would say it twice.
 */
export const useAnnounceOnIos = (message: string) => {
  useEffect(() => {
    if (Platform.OS === "ios") {
      AccessibilityInfo.announceForAccessibility(message);
    }
  }, [message]);
};
