import { afterEach, describe, expect, it, vi } from "vitest";
import themeScript from "../../../public/theme.js?raw";
import {
  THEME_STORAGE_KEY,
  currentThemeChoice,
  setThemeChoice,
} from "./theme.ts";

const root = () => document.documentElement;

/** Storage blocked: reading window.localStorage itself throws. */
const blockStorage = () =>
  vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
    throw new DOMException("blocked", "SecurityError");
  });

afterEach(() => {
  vi.restoreAllMocks();
});

describe("currentThemeChoice", () => {
  it("reads the choice <html> carries", () => {
    root().dataset.theme = "dark";
    expect(currentThemeChoice()).toBe("dark");

    root().dataset.theme = "light";
    expect(currentThemeChoice()).toBe("light");
  });

  it.each([
    ["no attribute", undefined],
    ["an unknown value", "blue"],
    ["an empty value", ""],
  ])("is null (follow the device) for %s", (_name, value) => {
    if (value !== undefined) root().dataset.theme = value;
    expect(currentThemeChoice()).toBeNull();
  });
});

describe("setThemeChoice", () => {
  it("shows a choice at once and saves it for the next visit", () => {
    setThemeChoice("dark");

    expect(root().dataset.theme).toBe("dark");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(THEME_STORAGE_KEY).toBe("goshop:theme");
  });

  it("with null, removes the attribute and the saved choice", () => {
    setThemeChoice("light");

    setThemeChoice(null);

    expect(root().hasAttribute("data-theme")).toBe(false);
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
  });

  it("still shows the choice when storage is blocked", () => {
    blockStorage();

    expect(() => {
      setThemeChoice("dark");
    }).not.toThrow();
    expect(root().dataset.theme).toBe("dark");
    expect(() => {
      setThemeChoice(null);
    }).not.toThrow();
    expect(root().hasAttribute("data-theme")).toBe(false);
  });

  it("still shows the choice when the quota is full", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError");
    });

    setThemeChoice("light");

    expect(root().dataset.theme).toBe("light");
  });
});

describe("public/theme.js, run before the first paint", () => {
  // The file as Vite serves it, run in this document the way the browser
  // runs a classic <script src> in <head>.
  const runThemeScript = () => {
    window.eval(themeScript);
  };

  it.each(["light", "dark"])("applies a saved %s choice", (choice) => {
    window.localStorage.setItem("goshop:theme", choice);

    runThemeScript();

    expect(root().dataset.theme).toBe(choice);
  });

  it("uses the same key as theme.ts", () => {
    setThemeChoice("dark");
    delete root().dataset.theme;

    runThemeScript();

    expect(root().dataset.theme).toBe("dark");
  });

  it.each([
    ["nothing saved", null],
    ["an unknown value", "blue"],
    ["markup", '"><script>alert(1)</script>'],
  ])("leaves <html> alone with %s", (_name, value) => {
    if (value !== null) window.localStorage.setItem("goshop:theme", value);

    runThemeScript();

    expect(root().hasAttribute("data-theme")).toBe(false);
  });

  it("follows the device, without an error, when storage is blocked", () => {
    blockStorage();

    expect(runThemeScript).not.toThrow();
    expect(root().hasAttribute("data-theme")).toBe(false);
  });

  it("is a classic script: no import or export", () => {
    expect(themeScript).not.toMatch(/^\s*(import|export)\s/m);
  });
});
