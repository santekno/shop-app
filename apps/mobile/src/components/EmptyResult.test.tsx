import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { render, screen, userEvent } from "@testing-library/react-native";
import { AccessibilityInfo, Platform } from "react-native";

import { EmptyResult } from "./StatusMessage";

afterEach(() => {
  jest.restoreAllMocks();
});

describe("EmptyResult", () => {
  it("shows the title as a header, with the hint under it", async () => {
    await render(
      <EmptyResult
        title='Tidak ada produk untuk "kaos"'
        hint="Coba kata lain."
      />,
    );

    expect(
      screen.getByRole("header", { name: 'Tidak ada produk untuk "kaos"' }),
    ).toBeTruthy();
    expect(screen.getByText("Coba kata lain.")).toBeTruthy();
  });

  it("has no hint and no button unless given", async () => {
    await render(<EmptyResult title="Kosong" />);

    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByText("Coba kata lain.")).toBeNull();
  });

  it("the action is a button that calls its handler", async () => {
    const onPress = jest.fn();
    await render(
      <EmptyResult
        title="Kosong"
        action={{ label: "Reset filter", onPress }}
      />,
    );

    await userEvent.press(screen.getByRole("button", { name: "Reset filter" }));

    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it("tells VoiceOver the title when it appears (iOS)", async () => {
    const announce = jest
      .spyOn(AccessibilityInfo, "announceForAccessibility")
      .mockClear();
    await render(<EmptyResult title="Kosong" />);

    expect(announce).toHaveBeenCalledWith("Kosong");
  });

  it("does not announce by hand on Android (the live region speaks)", async () => {
    jest.replaceProperty(Platform, "OS", "android");
    const announce = jest
      .spyOn(AccessibilityInfo, "announceForAccessibility")
      .mockClear();
    await render(<EmptyResult title="Kosong" />);

    expect(announce).not.toHaveBeenCalled();
  });
});
