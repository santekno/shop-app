import { describe, expect, it } from "@jest/globals";
import { DarkTheme, DefaultTheme } from "expo-router";

import { colors } from "./colors";
import { navigationTheme } from "./navigation";

describe("navigationTheme", () => {
  it("paints the light theme with the light value of each role", () => {
    const theme = navigationTheme("light");

    expect(theme.dark).toBe(false);
    expect(theme.colors).toEqual({
      ...DefaultTheme.colors,
      primary: "#0b5cad",
      background: "#f6f8fa",
      card: "#ffffff",
      text: "#1f2328",
      border: "#d1d9e0",
      notification: "#b42318",
    });
  });

  it("paints the dark theme with the dark value of each role", () => {
    const theme = navigationTheme("dark");

    expect(theme.dark).toBe(true);
    expect(theme.colors).toEqual({
      ...DarkTheme.colors,
      primary: colors.primary.dark,
      background: colors.background.dark,
      card: colors.card.dark,
      text: colors.foreground.dark,
      border: colors.border.dark,
      notification: colors.destructive.dark,
    });
    // Not the light values under another name.
    expect(theme.colors.background).toBe("#0d1117");
    expect(theme.colors.text).toBe("#e6edf3");
  });

  it.each(["light", "dark"] as const)(
    "draws every %s header, back button and tab label in Inter",
    (scheme) => {
      expect(navigationTheme(scheme).fonts).toEqual({
        regular: { fontFamily: "Inter", fontWeight: "400" },
        medium: { fontFamily: "Inter", fontWeight: "500" },
        bold: { fontFamily: "Inter", fontWeight: "600" },
        heavy: { fontFamily: "Inter", fontWeight: "700" },
      });
    },
  );

  it("does not change React Navigation's own themes", () => {
    navigationTheme("dark");
    expect(DarkTheme.colors.background).not.toBe("#0d1117");
    expect(DefaultTheme.colors.primary).not.toBe("#0b5cad");
  });
});
