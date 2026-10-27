/**
 * The viewer's theme: follow the device, or a choice they made.
 *
 * - No choice: <html> has no data-theme, and the CSS follows the device's
 *   prefers-color-scheme (index.css, the `dark` variant).
 * - A choice: <html data-theme="light|dark">, saved in localStorage so the
 *   next visit starts with it. public/theme.js applies it before the first
 *   paint; this module changes it afterwards.
 *
 * localStorage is per viewer and per browser, and it can throw: a privacy
 * setting that blocks storage, a full quota. Every access is wrapped, and
 * a failure only means the choice is not remembered.
 */

export type ThemeChoice = "light" | "dark";

/** The localStorage key; public/theme.js reads the same one. */
export const THEME_STORAGE_KEY = "goshop:theme";

const isThemeChoice = (value: unknown): value is ThemeChoice =>
  value === "light" || value === "dark";

/** The choice <html> carries now, or null when it follows the device. */
export const currentThemeChoice = (): ThemeChoice | null => {
  const value = document.documentElement.dataset.theme;
  return isThemeChoice(value) ? value : null;
};

/**
 * Shows `choice` at once (null: follow the device again) and remembers it
 * for the next visit.
 */
export const setThemeChoice = (choice: ThemeChoice | null): void => {
  const root = document.documentElement;
  if (choice === null) {
    delete root.dataset.theme;
  } else {
    root.dataset.theme = choice;
  }
  try {
    if (choice === null) {
      window.localStorage.removeItem(THEME_STORAGE_KEY);
    } else {
      window.localStorage.setItem(THEME_STORAGE_KEY, choice);
    }
  } catch {
    // Not remembered; the page still shows the choice until it reloads.
  }
};
