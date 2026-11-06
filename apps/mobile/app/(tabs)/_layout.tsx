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
import { BottomTabBar, Tabs } from "expo-router/js-tabs";
import type { BottomTabBarProps } from "expo-router/js-tabs";
import { View } from "react-native";
import type { ColorValue } from "react-native";

import { Icon, type IconName } from "@/components/Icon";
import { ConnectionBanner } from "@/features/connection/ConnectionBanner";

// The icon for one tab: filled when it is selected, outlined otherwise,
// in the colour the tab bar picks (active or inactive tint).
const tabIcon =
  (name: IconName) =>
  ({ color, focused }: { color: ColorValue; focused: boolean }) => (
    <Icon name={name} color={color} filled={focused} />
  );

// The default tab bar with the connection banner (artikel 11) stacked on
// top of it. Both are in the layout flow, so the screens above shrink by the
// banner's height while it shows. Offline, the banner sits above the tab
// bar and never covers it; the bar's own hide-on-keyboard still works,
// since it lives inside BottomTabBar.
const renderTabBar = (props: BottomTabBarProps) => (
  <View>
    <ConnectionBanner />
    <BottomTabBar {...props} />
  </View>
);

export default function TabsLayout() {
  return (
    <Tabs
      tabBar={renderTabBar}
      screenOptions={{
        // Hide the tab bar while typing. The keyboard covers it on iOS and
        // on Android drawn edge to edge (the window does not resize there,
        // as the chapter's native check found); where a window does resize,
        // the bar would ride on top of the keyboard.
        tabBarHideOnKeyboard: true,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Beranda",
          tabBarIcon: tabIcon("beranda"),
          // Beranda draws its own top bar with the search field.
          headerShown: false,
        }}
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
