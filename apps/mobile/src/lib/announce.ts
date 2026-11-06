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

/**
 * Tells VoiceOver about a change the user just made, such as a new price
 * after choosing a size. Not a hook: it is called from the press handler,
 * so nothing is announced when the screen first appears. iOS only, like
 * useAnnounceOnIos; on Android the changed text sits in a live region.
 */
export const announceOnIos = (message: string) => {
  if (Platform.OS === "ios") {
    AccessibilityInfo.announceForAccessibility(message);
  }
};

/**
 * Tells the screen reader about a change the user just made, on both
 * platforms. For a control whose label does not change a live region (a
 * heart that fills in): Android has no region to put the text in, so it is
 * announced directly, as iOS is. Called from the press handler, never on
 * first render.
 */
export const announce = (message: string) => {
  AccessibilityInfo.announceForAccessibility(message);
};
