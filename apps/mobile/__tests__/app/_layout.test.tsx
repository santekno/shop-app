import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { router } from "expo-router";
import { act, screen, waitFor } from "@testing-library/react-native";
import { useColorScheme } from "react-native";

import { unstable_settings } from "../../app/_layout";
import { queryClient } from "@/lib/query-client";
import { deferred, fakeApi, json } from "@/test/fake-api";
import { product } from "@/test/fixtures";
import { answerEmptyCatalog, headerTitles, renderApp } from "@/test/router";

afterEach(() => {
  queryClient.clear();
  jest.mocked(useColorScheme).mockReturnValue("light");
});

describe("the root stack", () => {
  it("anchors every stack on the tabs", () => {
    expect(unstable_settings).toEqual({ anchor: "(tabs)" });
  });

  it("puts the tabs under a product opened cold from a link, so Back goes to Beranda", async () => {
    answerEmptyCatalog();
    // Registered first, so the product page wins over the list answer.
    fakeApi.on("GET", "/v1/products/kaos-polos-hitam", () =>
      json({ data: product("Kaos Polos Hitam") }),
    );
    const app = await renderApp("/produk/kaos-polos-hitam");

    const root = app.getRouterState()?.routes[0]?.state;
    expect(root?.routes.map((route) => route.name)).toEqual([
      "(tabs)",
      "produk/[slug]",
    ]);
    expect(router.canGoBack()).toBe(true);

    await act(() => {
      router.back();
    });

    expect(app.getPathname()).toBe("/");
    expect(await screen.findByText("Belum ada produk.")).toBeOnTheScreen();
  });

  it("titles the product screen Produk until the screen names it", async () => {
    answerEmptyCatalog();
    const answer = deferred();
    fakeApi.on("GET", "/v1/products/topi-baseball", answer.handler);
    await renderApp("/produk/topi-baseball");
    expect(headerTitles()).toEqual(["Produk"]);

    await act(() => {
      answer.resolve(json({ data: product("Topi Baseball") }));
    });
    await waitFor(() => {
      expect(headerTitles()).toEqual(["Topi Baseball"]);
    });
  });

  it("titles the wishlist screen Wishlist saya", async () => {
    answerEmptyCatalog();
    await renderApp("/wishlist");
    expect(headerTitles()).toEqual(["Wishlist saya"]);
  });

  it("titles an unknown link Tidak ditemukan", async () => {
    answerEmptyCatalog();
    await renderApp("/produkk/x");
    expect(headerTitles()).toEqual(["Tidak ditemukan"]);
  });

  it("paints the headers in the theme's colours", async () => {
    answerEmptyCatalog();
    await renderApp("/wishlist");
    const [header] = screen.container.queryAll(
      (i) => i.type === "RNSScreenStackHeaderConfig" && i.props.hidden !== true,
    );
    expect(header?.props.color).toBe("#0b5cad");
  });

  it("follows the device into dark mode", async () => {
    // React Native's Jest preset makes useColorScheme a mock that says
    // "light"; the device switched to dark says "dark".
    jest.mocked(useColorScheme).mockReturnValue("dark");
    answerEmptyCatalog();
    await renderApp("/wishlist");

    const [header] = screen.container.queryAll(
      (i) => i.type === "RNSScreenStackHeaderConfig" && i.props.hidden !== true,
    );
    expect(header?.props.color).toBe("#4493f8");
    expect(header?.props.userInterfaceStyle).toBe("dark");
  });
});
