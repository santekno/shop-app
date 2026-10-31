import { afterEach, describe, expect, it } from "@jest/globals";
import { screen, userEvent } from "@testing-library/react-native";

import { queryClient } from "@/lib/query-client";
import { fakeApi, json } from "@/test/fake-api";
import { product, productPage } from "@/test/fixtures";
import { answerEmptyCatalog, renderApp } from "@/test/router";

afterEach(() => {
  queryClient.clear();
});

describe("a link to no screen", () => {
  it("says the page does not exist", async () => {
    answerEmptyCatalog();
    const app = await renderApp("/produkk/kaos");

    expect(
      screen.getByRole("header", { name: "Halaman tidak ditemukan" }),
    ).toBeOnTheScreen();
    expect(
      screen.getByText(
        "Tautan ini tidak mengarah ke halaman mana pun di GoShop.",
      ),
    ).toBeOnTheScreen();
    expect(app.getPathname()).toBe("/produkk/kaos");
  });

  it("goes back to Beranda from its link", async () => {
    fakeApi.on("GET", "/v1/products", () =>
      json(productPage([product("Kaos")])),
    );
    const app = await renderApp("/tidak/ada");

    await userEvent.press(
      screen.getByRole("link", { name: "Kembali ke beranda" }),
    );

    expect(app.getPathname()).toBe("/");
    expect(await screen.findByText("Kaos")).toBeOnTheScreen();
  });
});
