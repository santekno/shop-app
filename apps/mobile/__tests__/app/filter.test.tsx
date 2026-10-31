import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { router } from "expo-router";
import { screen, userEvent } from "@testing-library/react-native";
import { Platform } from "react-native";

import { queryClient } from "@/lib/query-client";
import { fakeApi, json } from "@/test/fake-api";
import { product, productPage } from "@/test/fixtures";
import { answerEmptyCatalog, headerTitles, renderApp } from "@/test/router";

afterEach(() => {
  queryClient.clear();
  jest.restoreAllMocks();
});

/** Beranda at `url`, then its sort button: the sheet as a buyer opens it. */
const openSheetFrom = async (url: string) => {
  fakeApi.on("GET", "/v1/products", () => json(productPage([product("Kaos")])));
  const app = await renderApp(url);
  await screen.findByText("Kaos");
  await userEvent.press(
    screen.getByRole("button", { name: /^Urutkan, saat ini/ }),
  );
  return app;
};

describe("the sort sheet", () => {
  it("checks the current order and only that one", async () => {
    await openSheetFrom("/?urut=termurah");

    expect(screen.getByRole("radio", { name: "Harga terendah" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Terbaru" })).not.toBeChecked();
    expect(
      screen.getByRole("radio", { name: "Harga tertinggi" }),
    ).not.toBeChecked();
    expect(headerTitles()).toContain("Urutkan");
  });

  it("checks Terbaru when opened without an order", async () => {
    answerEmptyCatalog();
    await renderApp("/filter");
    expect(screen.getByRole("radio", { name: "Terbaru" })).toBeChecked();
  });

  it("returns to the Beranda underneath with the new order, the category and search kept", async () => {
    const app = await openSheetFrom("/?kategori=kaos&q=polos&urut=termurah");

    await userEvent.press(
      screen.getByRole("radio", { name: "Harga tertinggi" }),
    );

    expect(app.getPathname()).toBe("/");
    expect(app.getSearchParams()).toEqual({
      kategori: "kaos",
      q: "polos",
      urut: "termahal",
    });
    // dismissTo popped the sheet back to that Beranda: nothing to go back to.
    expect(router.canGoBack()).toBe(false);
    expect(
      await screen.findByText('Hasil pencarian "polos" · Harga tertinggi'),
    ).toBeOnTheScreen();
  });

  it("has a Tutup button on iOS that closes the sheet unchanged", async () => {
    const app = await openSheetFrom("/?urut=termahal");

    await userEvent.press(screen.getByRole("button", { name: "Tutup" }));

    expect(app.getPathname()).toBe("/");
    expect(app.getSearchParams()).toEqual({ urut: "termahal" });
  });

  it("has no Tutup on Android, which has its back arrow", async () => {
    jest.replaceProperty(Platform, "OS", "android");
    answerEmptyCatalog();
    await renderApp("/filter");

    expect(screen.getByRole("radio", { name: "Terbaru" })).toBeOnTheScreen();
    expect(screen.queryByText("Tutup")).not.toBeOnTheScreen();
  });
});
