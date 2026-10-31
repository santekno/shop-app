// Shown for any path that matches no route: a mistyped deep link such as
// goshop://produkk/kaos, or an old link to a screen that no longer exists.
// The + prefix marks a special file, not a route of its own; it is the
// counterpart of apps/web/src/app/not-found.tsx.
import { Link } from "expo-router";
import { Text, View } from "react-native";

export default function NotFoundScreen() {
  return (
    <View className="flex-1 items-center justify-center gap-2 p-6">
      <Text
        accessibilityRole="header"
        className="font-sans text-2xl font-bold text-foreground dark:text-foreground-dark"
      >
        Halaman tidak ditemukan
      </Text>
      <Text className="text-center font-sans text-base text-foreground dark:text-foreground-dark">
        Tautan ini tidak mengarah ke halaman mana pun di GoShop.
      </Text>
      {/* Link draws its own Text, which comes precompiled from expo-router
          and so never sees NativeWind: a className on Link itself would be
          ignored. asChild hands the link's press and role to our Text
          instead, which takes classes like any other. */}
      <Link href="/" dismissTo asChild>
        <Text className="py-2 font-sans text-base text-primary dark:text-primary-dark">
          Kembali ke beranda
        </Text>
      </Link>
    </View>
  );
}
