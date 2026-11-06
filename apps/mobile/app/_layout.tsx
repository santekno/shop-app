// The root layout: Expo Router renders it around every screen in app/. A
// Stack is the native navigation stack (UINavigationController on iOS, a
// Fragment back stack on Android). Every route that is not inside a group
// with its own layout is a screen of this stack: the tabs as one screen,
// and the product detail pushed on top of them.
//
// Expo Router already wraps this in a SafeAreaProvider (from
// react-native-safe-area-context), so any screen can ask for the insets.
// NativeWind's compiled styles, once for the whole app (artikel 05).
import "../global.css";
import { BottomSheetModalProvider } from "@gorhom/bottom-sheet";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { Stack, ThemeProvider } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useColorScheme } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { queryClient } from "@/lib/query-client";
import { persistOptions } from "@/lib/query-persist";
import { navigationTheme } from "@/theme/navigation";

// The screen under any other in the root stack. A link that opens the app
// cold, goshop://produk/kaos-polos-hitam, builds the stack from the URL
// alone: without an anchor the detail was the only screen, with no back
// button, and Back left the app. With (tabs) as the anchor, Expo Router
// puts the tabs under it, so Back returns to Beranda (found in the
// chapter's native check).
export const unstable_settings = { anchor: "(tabs)" };

// TanStack Query's cache around every screen (artikel 06): one client for
// the app's whole life, made once in src/lib/query-client.ts, which also
// tells it when the app is in front and when the phone is online.
//
// Artikel 10: the cache is saved to AsyncStorage and restored here (the
// public catalog only, see src/lib/query-persist.ts; tokens never go to
// AsyncStorage). While the restore runs, queries stay idle and screens
// show their skeletons, not an error; once it is done, a paused mutation
// is resumed so it does not sit waiting for a trigger that already
// happened.
export default function RootLayout() {
  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={persistOptions}
      onSuccess={() => {
        void queryClient.resumePausedMutations();
      }}
    >
      {/* Gesture Handler and the bottom sheet (artikel 07) need their root
          around everything that can show a sheet: the root view receives
          the touches, the modal provider hosts the sheets. */}
      <GestureHandlerRootView style={{ flex: 1 }}>
        <BottomSheetModalProvider>
          <ThemedNavigation />
        </BottomSheetModalProvider>
      </GestureHandlerRootView>
    </PersistQueryClientProvider>
  );
}

function ThemedNavigation() {
  // Light or dark, as the device is set (app.config.ts allows both), re-read
  // when the user switches it.
  const scheme = useColorScheme() === "dark" ? "dark" : "light";

  return (
    // The navigators' colours (headers, tab bar, screen background) follow
    // the device, in GoShop's colours (src/theme/navigation.ts). useTheme()
    // gives the same colours to a screen.
    <ThemeProvider value={navigationTheme(scheme)}>
      <Stack screenOptions={{ title: "GoShop" }}>
        {/* The tab navigator draws its own headers, one per tab. */}
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        {/* The title is replaced by the screen once it knows the product. */}
        <Stack.Screen name="produk/[slug]" options={{ title: "Produk" }} />
        <Stack.Screen
          name="+not-found"
          options={{ title: "Tidak ditemukan" }}
        />
      </Stack>
      {/* "auto": dark icons on a light theme, light icons on a dark one,
          following the same device setting as the ThemeProvider. */}
      <StatusBar style="auto" />
    </ThemeProvider>
  );
}
