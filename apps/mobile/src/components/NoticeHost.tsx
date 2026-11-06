import { Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAnnounceOnIos } from "@/lib/announce";
import { dismissNotice, useNotice } from "@/lib/notice";

/** Clear of the tab bar (about 49 dp plus the bottom inset) on the tabs. */
const ABOVE_TAB_BAR = 64;

/**
 * Draws the current notice (src/lib/notice.ts) as a dark pill near the
 * bottom of the screen, over whatever screen is shown. Mounted once, in the
 * root layout, so the tabs and the product page share it.
 *
 * Accessibility: role "alert" and a polite live region (TalkBack reads the
 * text when it appears or changes); VoiceOver gets it from
 * useAnnounceOnIos. Tapping it dismisses it.
 */
export function NoticeHost() {
  const notice = useNotice();
  const insets = useSafeAreaInsets();
  if (notice === null) return null;
  return (
    <View
      pointerEvents="box-none"
      style={{ bottom: insets.bottom + ABOVE_TAB_BAR }}
      className="absolute inset-x-0 items-center px-4"
    >
      <NoticePill key={notice.id} message={notice.message} />
    </View>
  );
}

function NoticePill({ message }: { message: string }) {
  useAnnounceOnIos(message);
  return (
    <Pressable
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      accessibilityLabel={message}
      accessibilityHint="Ketuk untuk menutup"
      onPress={dismissNotice}
      className="max-w-md rounded-lg bg-foreground px-4 py-3 dark:bg-foreground-dark"
    >
      <Text className="text-center font-sans text-sm font-semibold text-background dark:text-background-dark">
        {message}
      </Text>
    </Pressable>
  );
}
