// The layout of the (tabs) group. A folder name in parentheses is a route
// group: it gives its screens a shared layout without adding a segment to
// the URL, so app/(tabs)/index.tsx is "/", not "/(tabs)". Artikel 09 adds
// the other tabs and their icons.
//
// Tabs comes from expo-router/js-tabs: the tab bar drawn by JavaScript
// (React Navigation's bottom tabs). Expo Router 58 deprecates importing it
// from "expo-router" itself, now that expo-router/native-tabs (the
// platform's own tab bar) exists next to it.
import { Tabs } from "expo-router/js-tabs";

export default function TabsLayout() {
  return (
    <Tabs>
      <Tabs.Screen name="index" options={{ title: "Beranda" }} />
    </Tabs>
  );
}
