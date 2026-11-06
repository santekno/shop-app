import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { act, render, screen, userEvent } from "@testing-library/react-native";
import { AccessibilityInfo, Platform } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { dismissNotice, showNotice } from "@/lib/notice";
import { NoticeHost } from "./NoticeHost";

const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 800 },
  insets: { top: 40, left: 0, right: 0, bottom: 20 },
};

const renderHost = () =>
  render(
    <SafeAreaProvider initialMetrics={metrics}>
      <NoticeHost />
    </SafeAreaProvider>,
  );

afterEach(() => {
  dismissNotice();
  jest.restoreAllMocks();
});

describe("NoticeHost", () => {
  it("draws nothing while there is no notice", async () => {
    await renderHost();

    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows the message as a polite alert that says how to close it", async () => {
    await renderHost();

    await act(() => {
      showNotice(
        "Wishlist penuh (maksimal 200 produk). Hapus satu produk dulu.",
      );
    });

    const pill = screen.getByRole("alert", {
      name: "Wishlist penuh (maksimal 200 produk). Hapus satu produk dulu.",
    });
    expect(pill).toHaveProp("accessibilityLiveRegion", "polite");
    expect(pill).toHaveProp("accessibilityHint", "Ketuk untuk menutup");
  });

  it("sits above the tab bar and the bottom inset", async () => {
    await renderHost();

    await act(() => {
      showNotice("x");
    });

    const wrapper = screen.container.queryAll((node) => {
      const style = node.props.style as { bottom?: number } | undefined;
      return style?.bottom === 20 + 64;
    });
    expect(wrapper.length).toBeGreaterThan(0);
  });

  it("tapping it closes it", async () => {
    await renderHost();
    await act(() => {
      showNotice("Ketuk aku");
    });

    await userEvent.press(screen.getByRole("alert"));

    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("on iOS, hands the message to VoiceOver", async () => {
    const announce = jest
      .spyOn(AccessibilityInfo, "announceForAccessibility")
      .mockClear();
    await renderHost();

    await act(() => {
      showNotice("Masuk dulu");
    });

    expect(announce).toHaveBeenCalledWith("Masuk dulu");
  });

  it("on Android, leaves it to the live region and does not announce twice", async () => {
    jest.replaceProperty(Platform, "OS", "android");
    const announce = jest
      .spyOn(AccessibilityInfo, "announceForAccessibility")
      .mockClear();
    await renderHost();

    await act(() => {
      showNotice("Masuk dulu");
    });

    expect(announce).not.toHaveBeenCalled();
  });
});
