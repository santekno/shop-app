import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { act, screen, userEvent } from "@testing-library/react-native";
import { DeviceEventEmitter, StyleSheet } from "react-native";
import type { StyleProp, ViewStyle } from "react-native";

import { queryClient } from "@/lib/query-client";
import { fakeApi, json } from "@/test/fake-api";
import { category, product, productPage } from "@/test/fixtures";
import { renderApp } from "@/test/router";

afterEach(() => {
  queryClient.clear();
});

const openBeranda = async () => {
  fakeApi.on("GET", "/v1/products", () => json(productPage([product("Kaos")])));
  const app = await renderApp("/");
  await screen.findByText("Kaos");
  return app;
};

/** A tab button, as React Navigation labels it for screen readers. */
const tab = (name: string, position: number) =>
  screen.getByRole("button", { name: `${name}, tab, ${position} of 4` });

/**
 * The stroke width of the icon a tab shows. React Navigation draws the
 * selected and the unselected icon on top of each other and fades one out
 * (opacity 0); the other one is what the buyer sees.
 */
const visibleIconStroke = (name: string, position: number): unknown => {
  const svgs = tab(name, position).queryAll((i) => i.type === "RNSVGSvgView");
  const visible = svgs.find(
    (svg) =>
      StyleSheet.flatten(svg.parent?.props.style as StyleProp<ViewStyle>)
        ?.opacity !== 0,
  );
  return visible?.props.strokeWidth as unknown;
};

/** The tab bar's own view (role tablist is not an accessibility element). */
const tabBar = () => {
  const [list] = screen.container.queryAll((i) => i.props.role === "tablist");
  return list?.parent;
};

describe("the tab bar", () => {
  it("has the four tabs, in order", async () => {
    await openBeranda();

    expect(tab("Beranda", 1)).toBeOnTheScreen();
    expect(tab("Kategori", 2)).toBeOnTheScreen();
    expect(tab("Keranjang", 3)).toBeOnTheScreen();
    expect(tab("Akun", 4)).toBeOnTheScreen();
    expect(tab("Beranda", 1)).toBeSelected();
    expect(tab("Akun", 4)).not.toBeSelected();
  });

  it("draws the selected tab's icon with the heavier stroke", async () => {
    await openBeranda();
    expect(visibleIconStroke("Beranda", 1)).toBe(2.5);
    expect(visibleIconStroke("Kategori", 2)).toBe(2);
  });

  it("switches tabs, and Beranda keeps its own top bar instead of a header", async () => {
    const app = await openBeranda();
    // The tab navigator's header title is role "heading" (the GoShop top
    // bar is Beranda's own Text). Kategori, below, has the header.
    expect(
      screen.queryByRole("heading", { name: "Beranda" }),
    ).not.toBeOnTheScreen();

    await userEvent.press(tab("Akun", 4));
    expect(app.getPathname()).toBe("/akun");
    expect(tab("Akun", 4)).toBeSelected();
    expect(
      screen.getByText("Masuk untuk melihat pesanan dan alamat Anda."),
    ).toBeOnTheScreen();

    await userEvent.press(tab("Keranjang", 3));
    expect(app.getPathname()).toBe("/keranjang");
    expect(
      screen.getByText("Keranjang belanja Anda akan tampil di sini."),
    ).toBeOnTheScreen();

    fakeApi.on("GET", "/v1/categories", () =>
      json({ data: [category("kaos", "Kaos")] }),
    );
    await userEvent.press(tab("Kategori", 2));
    expect(app.getPathname()).toBe("/kategori");
    expect(
      await screen.findByRole("button", { name: "Kaos" }),
    ).toBeOnTheScreen();
    // The other tabs keep the header, its title in Inter (the theme's
    // fonts, artikel 11).
    expect(screen.getByRole("heading", { name: "Kategori" })).toHaveStyle({
      fontFamily: "Inter",
      fontWeight: "600",
    });
  });

  it("hides while the keyboard is up", async () => {
    await openBeranda();
    expect(tabBar()).toHaveStyle({ pointerEvents: "auto" });

    await act(() => {
      DeviceEventEmitter.emit("keyboardWillShow", {
        duration: 0,
        easing: "keyboard",
        endCoordinates: { height: 300, screenX: 0, screenY: 500, width: 400 },
        startCoordinates: { height: 0, screenX: 0, screenY: 800, width: 400 },
      });
      jest.advanceTimersByTime(500);
    });

    expect(tabBar()).toHaveStyle({
      pointerEvents: "none",
      position: "absolute",
    });
  });
});
