import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { stubColorScheme } from "@/test/match-media.ts";
import { THEME_STORAGE_KEY } from "./theme.ts";
import { useTheme } from "./useTheme.ts";

const saved = () => window.localStorage.getItem(THEME_STORAGE_KEY);
const attribute = () => document.documentElement.dataset.theme;

describe("useTheme", () => {
  it.each([
    ["light", false],
    ["dark", true],
  ] as const)("follows a %s device when nothing was chosen", (scheme, dark) => {
    stubColorScheme(scheme);

    const { result } = renderHook(() => useTheme());

    expect(result.current.isDark).toBe(dark);
  });

  it("starts from the choice public/theme.js put on <html>, over the device", () => {
    stubColorScheme("light");
    document.documentElement.dataset.theme = "dark";

    const { result } = renderHook(() => useTheme());

    expect(result.current.isDark).toBe(true);
  });

  it("on a light device, saves dark, then removes the choice on the way back", () => {
    stubColorScheme("light");
    const { result } = renderHook(() => useTheme());

    act(() => {
      result.current.toggle();
    });
    expect(result.current.isDark).toBe(true);
    expect(attribute()).toBe("dark");
    expect(saved()).toBe("dark");

    act(() => {
      result.current.toggle();
    });
    // Light is what the device prefers: nothing saved, follow the device.
    expect(result.current.isDark).toBe(false);
    expect(attribute()).toBeUndefined();
    expect(saved()).toBeNull();
  });

  it("on a dark device, saves light, then removes the choice on the way back", () => {
    stubColorScheme("dark");
    const { result } = renderHook(() => useTheme());

    act(() => {
      result.current.toggle();
    });
    expect(result.current.isDark).toBe(false);
    expect(attribute()).toBe("light");
    expect(saved()).toBe("light");

    act(() => {
      result.current.toggle();
    });
    expect(result.current.isDark).toBe(true);
    expect(attribute()).toBeUndefined();
    expect(saved()).toBeNull();
  });

  it("removes a saved choice that matches the device when toggled to it", () => {
    stubColorScheme("dark");
    document.documentElement.dataset.theme = "light";
    window.localStorage.setItem(THEME_STORAGE_KEY, "light");
    const { result } = renderHook(() => useTheme());

    act(() => {
      result.current.toggle();
    });

    expect(result.current.isDark).toBe(true);
    expect(saved()).toBeNull();
  });

  it("follows the device when it changes, while nothing is chosen", () => {
    const device = stubColorScheme("light");
    const { result, unmount } = renderHook(() => useTheme());
    expect(device.listenerCount()).toBe(1);

    act(() => {
      device.set("dark");
    });
    expect(result.current.isDark).toBe(true);

    act(() => {
      device.set("light");
    });
    expect(result.current.isDark).toBe(false);

    unmount();
    expect(device.listenerCount()).toBe(0);
  });

  it("keeps a choice when the device changes", () => {
    const device = stubColorScheme("light");
    document.documentElement.dataset.theme = "light";
    const { result } = renderHook(() => useTheme());

    act(() => {
      device.set("dark");
    });

    expect(result.current.isDark).toBe(false);
  });

  it("treats a browser without matchMedia as a light device", () => {
    vi.stubGlobal("matchMedia", undefined);
    const { result, unmount } = renderHook(() => useTheme());

    expect(result.current.isDark).toBe(false);
    act(() => {
      result.current.toggle();
    });
    expect(result.current.isDark).toBe(true);
    expect(saved()).toBe("dark");
    expect(unmount).not.toThrow();
  });
});
