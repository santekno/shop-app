// The Akun tab, at /akun. Sign-in arrives in Bab 15 (tokens in
// expo-secure-store, never AsyncStorage); until then the tab holds the one
// entry that already exists, the wishlist (Bab 14, artikel 12).
import { router } from "expo-router";
import { Pressable, Text, View } from "react-native";

import { Icon } from "@/components/Icon";
import { ScreenPlaceholder } from "@/components/ScreenPlaceholder";

export default function AccountScreen() {
  return (
    <View className="flex-1">
      <ScreenPlaceholder
        title="Akun"
        message="Masuk untuk melihat pesanan dan alamat Anda."
      />
      <Pressable
        accessibilityRole="link"
        accessibilityLabel="Wishlist saya"
        onPress={() => {
          router.push("/wishlist");
        }}
        className="mx-4 mb-6 min-h-12 flex-row items-center gap-3 rounded-lg border border-border bg-card px-4 active:bg-accent dark:border-border-dark dark:bg-card-dark dark:active:bg-accent-dark"
      >
        <Icon name="wishlist" className="text-primary dark:text-primary-dark" />
        <Text className="flex-1 font-sans text-base font-semibold text-foreground dark:text-foreground-dark">
          Wishlist saya
        </Text>
        <Icon
          name="lanjut"
          className="text-muted-foreground dark:text-muted-foreground-dark"
        />
      </Pressable>
    </View>
  );
}
