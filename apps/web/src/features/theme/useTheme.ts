import { useState, useSyncExternalStore } from "react";
import { currentThemeChoice, setThemeChoice } from "./theme.ts";
import type { ThemeChoice } from "./theme.ts";

const DARK_QUERY = "(prefers-color-scheme: dark)";

/** The device's preference, as a media query list (null where missing). */
const darkQuery = (): MediaQueryList | null =>
  typeof window.matchMedia === "function"
    ? window.matchMedia(DARK_QUERY)
    : null;

// useSyncExternalStore reads a value React does not own (the media
// query) and renders again when it changes: the device switching to dark
// at sunset, say.
const subscribe = (onChange: () => void) => {
  const query = darkQuery();
  query?.addEventListener("change", onChange);
  return () => {
    query?.removeEventListener("change", onChange);
  };
};
const deviceIsDark = () => darkQuery()?.matches ?? false;

/**
 * Whether the page is dark now, and a toggle for the header's button.
 *
 * Two states on screen, three underneath: light, dark, or the device's.
 * Pressing the toggle shows the other theme. When that is what the device
 * prefers anyway, the saved choice is removed instead, and the page
 * follows the device again; so "dark, then back to light" on a light
 * device leaves nothing saved, and a device that changes later is
 * followed. One button, no "system" menu to explain.
 */
export const useTheme = () => {
  // Starts from <html>, which public/theme.js set before React ran.
  const [choice, setChoice] = useState<ThemeChoice | null>(currentThemeChoice);
  const deviceDark = useSyncExternalStore(subscribe, deviceIsDark);
  const isDark = choice === null ? deviceDark : choice === "dark";

  const toggle = () => {
    const next: ThemeChoice = isDark ? "light" : "dark";
    const device: ThemeChoice = deviceDark ? "dark" : "light";
    const saved = next === device ? null : next;
    setThemeChoice(saved);
    setChoice(saved);
  };

  return { isDark, toggle };
};
