// The root layout: Expo Router renders it around every screen in app/. A
// Stack is the native navigation stack (UINavigationController on iOS, a
// Fragment back stack on Android); artikel 08 and 09 build the real tree.
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
      <Stack screenOptions={{ title: "GoShop" }} />
      <StatusBar style="auto" />
    </ThemeProvider>
  );
}
