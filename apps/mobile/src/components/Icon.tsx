// The one place the app draws an icon. Screens name an icon by what it
// means ("keranjang"), not by a glyph in some icon font, so changing the
// icon set (artikel 11) touches this file only.
//
// Ionicons comes from @expo/vector-icons: an icon font bundled with the
// app and loaded by expo-font, available in Expo Go and every build. Each
// glyph has a filled and an "-outline" form, which the tab bar uses for
// the selected and the other tabs.
import Ionicons from "@expo/vector-icons/Ionicons";
import type { ComponentProps } from "react";
import type { ColorValue } from "react-native";

type Glyph = ComponentProps<typeof Ionicons>["name"];

const GLYPHS = {
  beranda: { filled: "home", outline: "home-outline" },
  kategori: { filled: "grid", outline: "grid-outline" },
  keranjang: { filled: "cart", outline: "cart-outline" },
  akun: { filled: "person", outline: "person-outline" },
  urutkan: { filled: "swap-vertical", outline: "swap-vertical-outline" },
  cari: { filled: "search", outline: "search-outline" },
  terpilih: { filled: "checkmark", outline: "checkmark-outline" },
} as const satisfies Record<string, { filled: Glyph; outline: Glyph }>;

export type IconName = keyof typeof GLYPHS;

interface IconProps {
  name: IconName;
  color: ColorValue;
  size?: number;
  /** The filled form, for a selected tab; the outline otherwise. */
  filled?: boolean;
}

/**
 * A decorative icon: screen readers skip it, so whatever it sits in (a tab,
 * a button) carries the label.
 */
export function Icon({ name, color, size = 24, filled = false }: IconProps) {
  const glyph = filled ? GLYPHS[name].filled : GLYPHS[name].outline;
  return (
    <Ionicons
      name={glyph}
      // React Native's ColorValue also admits a number and null, which the
      // icon font's types do not; the tab bar always passes a string.
      color={typeof color === "number" || color === null ? undefined : color}
      size={size}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    />
  );
}
