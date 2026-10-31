// A screen that exists in the navigation before its feature does: a
// heading and one sentence, centred. Tabs whose chapter has not come yet
// (Kategori, Keranjang, Akun) use it, so the navigation can be built and
// tried in full now.
import { Text, View } from "react-native";

interface ScreenPlaceholderProps {
  title: string;
  message: string;
}

export function ScreenPlaceholder({ title, message }: ScreenPlaceholderProps) {
  // React Native text is black unless told otherwise, whatever the theme:
  // every Text names its colour, and its dark: twin.
  return (
    <View className="flex-1 items-center justify-center gap-2 p-6">
      <Text
        accessibilityRole="header"
        className="font-sans text-2xl font-bold text-foreground dark:text-foreground-dark"
      >
        {title}
      </Text>
      <Text className="text-center font-sans text-base text-foreground dark:text-foreground-dark">
        {message}
      </Text>
    </View>
  );
}
