// The root layout: Expo Router renders it around every screen in app/. A
// Stack is the native navigation stack (UINavigationController on iOS, a
// Fragment back stack on Android); artikel 08 and 09 build the real tree.
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";

export default function RootLayout() {
  return (
    <>
      <Stack screenOptions={{ title: "GoShop" }} />
      <StatusBar style="auto" />
    </>
  );
}
