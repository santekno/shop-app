// The layout of the (tabs) group. A folder name in parentheses is a route
// group: it gives its screens a shared layout without adding a segment to
// the URL, so app/(tabs)/index.tsx is "/", not "/(tabs)".
//
// Four tabs, one file each. Every tab keeps its own state while another is
// shown (a scrolled catalog stays scrolled), which is what a tab bar
// promises and what a stack does not.
//
// Tabs comes from expo-router/js-tabs: the tab bar drawn by JavaScript
// (React Navigation's bottom tabs). Expo Router 58 deprecates importing it
// from "expo-router" itself, now that expo-router/native-tabs (the
// platform's own tab bar) exists next to it.
import { Tabs } from "expo-router/js-tabs";
import type { ColorValue } from "react-native";

import { Icon, type IconName } from "@/components/Icon";

// The icon for one tab: filled when it is selected, outlined otherwise,
// in the colour the tab bar picks (active or inactive tint).
const tabIcon =
  (name: IconName) =>
  ({ color, focused }: { color: ColorValue; focused: boolean }) => (
    <Icon name={name} color={color} filled={focused} />
  );

export default function TabsLayout() {
  return (
    <Tabs>
      <Tabs.Screen
        name="index"
        options={{ title: "Beranda", tabBarIcon: tabIcon("beranda") }}
      />
      <Tabs.Screen
        name="kategori"
        options={{ title: "Kategori", tabBarIcon: tabIcon("kategori") }}
      />
      <Tabs.Screen
        name="keranjang"
        options={{ title: "Keranjang", tabBarIcon: tabIcon("keranjang") }}
      />
      <Tabs.Screen
        name="akun"
        options={{ title: "Akun", tabBarIcon: tabIcon("akun") }}
      />
    </Tabs>
  );
}
