import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { renderHook } from "@testing-library/react-native";
import { AccessibilityInfo, Platform } from "react-native";

import { useAnnounceOnIos } from "./announce";

// React Native's Jest setup already makes announceForAccessibility a
// jest.fn, and spyOn hands back that same mock, calls from earlier tests
// included: clear it so a count is this test's own.
const spyAnnounce = () =>
  jest.spyOn(AccessibilityInfo, "announceForAccessibility").mockClear();

afterEach(() => {
  jest.restoreAllMocks();
});

describe("useAnnounceOnIos", () => {
  it("hands the message to VoiceOver once when it appears (jest-expo runs as iOS)", async () => {
    const announce = spyAnnounce();
    await renderHook(() => {
      useAnnounceOnIos("Gagal memuat.");
    });

    expect(announce).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenCalledWith("Gagal memuat.");
  });

  it("announces again only when the message changes, not on every render", async () => {
    const announce = spyAnnounce();
    const hook = await renderHook(
      (message: string) => {
        useAnnounceOnIos(message);
      },
      { initialProps: "Gagal memuat." },
    );

    await hook.rerender("Gagal memuat.");
    expect(announce).toHaveBeenCalledTimes(1);

    await hook.rerender("Server terlalu lama merespons.");
    expect(announce).toHaveBeenCalledTimes(2);
    expect(announce).toHaveBeenLastCalledWith("Server terlalu lama merespons.");
  });

  it("announces nothing on Android, where the element's live region speaks", async () => {
    jest.replaceProperty(Platform, "OS", "android");
    const announce = spyAnnounce();
    const hook = await renderHook(
      (message: string) => {
        useAnnounceOnIos(message);
      },
      { initialProps: "Gagal memuat." },
    );
    await hook.rerender("Server terlalu lama merespons.");

    expect(announce).not.toHaveBeenCalled();
  });
});
