import { useSyncExternalStore } from "react";
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

// The saved choice lives on <html> (data-theme), set by public/theme.js
// before React ran and by the toggle afterwards. The toggle tells every
// reader through these listeners.
const choiceListeners = new Set<() => void>();
const subscribeChoice = (onChange: () => void) => {
  choiceListeners.add(onChange);
  return () => {
    choiceListeners.delete(onChange);
  };
};

// The server knows neither the saved choice nor the device: it renders
// "no choice, light device". While hydrating, React uses these same
// server values, so the HTML and the first browser render agree; right
// after, it reads the real ones and renders again if they differ (Bab 11
// artikel 08). The colours never wait for that: the CSS reads data-theme
// and the media query itself.
const serverChoice = (): ThemeChoice | null => null;
const serverDeviceDark = () => false;

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
  const choice = useSyncExternalStore(
    subscribeChoice,
    currentThemeChoice,
    serverChoice,
  );
  const deviceDark = useSyncExternalStore(
    subscribe,
    deviceIsDark,
    serverDeviceDark,
  );
  const isDark = choice === null ? deviceDark : choice === "dark";

  const toggle = () => {
    const next: ThemeChoice = isDark ? "light" : "dark";
    const device: ThemeChoice = deviceDark ? "dark" : "light";
    const saved = next === device ? null : next;
    setThemeChoice(saved);
    for (const onChange of choiceListeners) onChange();
  };

  return { isDark, toggle };
};
