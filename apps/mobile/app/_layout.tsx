// The root layout: Expo Router renders it around every screen in app/. A
// Stack is the native navigation stack (UINavigationController on iOS, a
// Fragment back stack on Android). Every route that is not inside a group
// with its own layout is a screen of this stack: the tabs as one screen,
// and the product detail pushed on top of them.
// NativeWind's compiled styles, once for the whole app (artikel 05).
import "../global.css";
import { Stack, ThemeProvider } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useColorScheme } from "react-native";
import { navigationTheme } from "@/theme/navigation";

export default function RootLayout() {
  // The device's appearance, re-read when the user switches it.
  const scheme = useColorScheme() === "dark" ? "dark" : "light";

  return (
    <ThemeProvider value={navigationTheme(scheme)}>
      <Stack screenOptions={{ title: "GoShop" }}>
        {/* The tab navigator draws its own headers, one per tab. */}
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        {/* The title is replaced by the screen once it knows the product. */}
        <Stack.Screen name="produk/[slug]" options={{ title: "Produk" }} />
        {/* Over everything, tab bar included: a card that slides up on
            iOS, a full screen on Android. */}
        <Stack.Screen
          name="filter"
          options={{ presentation: "modal", title: "Urutkan" }}
        />
        <Stack.Screen
          name="+not-found"
          options={{ title: "Tidak ditemukan" }}
        />
      </Stack>
      <StatusBar style="auto" />
    </ThemeProvider>
  );
}
