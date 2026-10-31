// The navigation's own colours (the stack's header, the screen behind the
// content, later the tab bar), from the same tokens as the classes.
//
// Expo Router draws its headers and screen backgrounds itself, outside any
// component we could give a className to, and paints them in React
// Navigation's default light theme unless told otherwise: in dark mode the
// content would turn dark under a white header. app/_layout.tsx passes the
// theme for the device's current scheme to <ThemeProvider>.
//
// The same goes for text: the header titles, the back button and the tab
// labels are drawn in the theme's fonts, the system font unless told
// otherwise, so the theme carries Inter too (artikel 11).
import { DarkTheme, DefaultTheme } from "expo-router";
import type { Theme } from "expo-router";
import { colors } from "./colors";
import { fonts } from "./fonts";

type Scheme = "light" | "dark";

// React Navigation's four text styles, in Inter at the weights its own
// defaults use. Each weight is a file the app embeds (src/theme/fonts.js).
const navigationFonts: Theme["fonts"] = {
  regular: { fontFamily: fonts.sans, fontWeight: "400" },
  medium: { fontFamily: fonts.sans, fontWeight: "500" },
  bold: { fontFamily: fonts.sans, fontWeight: "600" },
  heavy: { fontFamily: fonts.sans, fontWeight: "700" },
};

const pick = (role: { DEFAULT: string; dark: string }, scheme: Scheme) =>
  scheme === "dark" ? role.dark : role.DEFAULT;

/** React Navigation's theme in GoShop's colours, for one scheme. */
export const navigationTheme = (scheme: Scheme): Theme => {
  const base = scheme === "dark" ? DarkTheme : DefaultTheme;
  return {
    ...base,
    colors: {
      ...base.colors,
      primary: pick(colors.primary, scheme),
      background: pick(colors.background, scheme),
      card: pick(colors.card, scheme),
      text: pick(colors.foreground, scheme),
      border: pick(colors.border, scheme),
      notification: pick(colors.destructive, scheme),
    },
    fonts: navigationFonts,
  };
};
