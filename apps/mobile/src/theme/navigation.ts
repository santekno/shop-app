// The navigation's own colours (the stack's header, the screen behind the
// content, later the tab bar), from the same tokens as the classes.
//
// Expo Router draws its headers and screen backgrounds itself, outside any
// component we could give a className to, and paints them in React
// Navigation's default light theme unless told otherwise: in dark mode the
// content would turn dark under a white header. app/_layout.tsx passes the
// theme for the device's current scheme to <ThemeProvider>.
import { DarkTheme, DefaultTheme } from "expo-router";
import type { Theme } from "expo-router";
import { colors } from "./colors";

type Scheme = "light" | "dark";

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
  };
};
