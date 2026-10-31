import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { router } from "expo-router";
import { act, screen } from "@testing-library/react-native";
import { useColorScheme } from "react-native";

import { unstable_settings } from "../../app/_layout";
import { queryClient } from "@/lib/query-client";
import { deferred, fakeApi, json } from "@/test/fake-api";
import { product, productPage } from "@/test/fixtures";
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
    const answer = deferred();
    fakeApi.on("GET", "/v1/products", answer.handler);
    const app = await renderApp("/produk/kaos-polos-hitam");

    const root = app.getRouterState()?.routes[0]?.state;
    expect(root?.routes.map((route) => route.name)).toEqual([
      "(tabs)",
      "produk/[slug]",
    ]);
    expect(router.canGoBack()).toBe(true);

    // Beranda mounted under the product and asked for its first page.
    expect(fakeApi.requests("GET", "/v1/products")).toHaveLength(1);
    await act(() => {
      router.back();
      answer.resolve(json(productPage([product("Kaos")])));
    });

    expect(app.getPathname()).toBe("/");
    expect(await screen.findByText("Kaos")).toBeOnTheScreen();
  });

  it("titles the product screen Produk until the screen names it", async () => {
    answerEmptyCatalog();
    await renderApp("/produk/topi-baseball");
    // The screen replaces the stack's "Produk" with the slug.
    expect(headerTitles()).toEqual(["topi-baseball"]);
  });

  it("presents the sort sheet as a modal titled Urutkan, over the tabs", async () => {
    answerEmptyCatalog();
    const app = await renderApp("/filter");
    const root = app.getRouterState()?.routes[0]?.state;
    expect(root?.routes.map((route) => route.name)).toEqual([
      "(tabs)",
      "filter",
    ]);
    expect(headerTitles()).toEqual(["Urutkan"]);
  });

  it("titles an unknown link Tidak ditemukan", async () => {
    answerEmptyCatalog();
    await renderApp("/produkk/x");
    expect(headerTitles()).toEqual(["Tidak ditemukan"]);
  });

  it("paints the headers in the theme's colours", async () => {
    answerEmptyCatalog();
    await renderApp("/produk/kaos");
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
    await renderApp("/produk/kaos");

    const [header] = screen.container.queryAll(
      (i) => i.type === "RNSScreenStackHeaderConfig" && i.props.hidden !== true,
    );
    expect(header?.props.color).toBe("#4493f8");
    expect(header?.props.userInterfaceStyle).toBe("dark");
  });
});
