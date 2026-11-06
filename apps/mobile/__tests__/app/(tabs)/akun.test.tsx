import { afterEach, describe, expect, it } from "@jest/globals";
import { screen, userEvent } from "@testing-library/react-native";

import { queryClient } from "@/lib/query-client";
import { headerTitles, renderApp } from "@/test/router";

afterEach(() => {
  queryClient.clear();
});

describe("the Akun tab", () => {
  it("says to sign in and links to the wishlist", async () => {
    await renderApp("/akun");

    expect(
      screen.getByText("Masuk untuk melihat pesanan dan alamat Anda."),
    ).toBeOnTheScreen();
    expect(
      screen.getByRole("link", { name: "Wishlist saya" }),
    ).toBeOnTheScreen();
  });

  it("pressing 'Wishlist saya' opens the wishlist screen on top of the tabs", async () => {
    const app = await renderApp("/akun");

    await userEvent.press(screen.getByRole("link", { name: "Wishlist saya" }));

    expect(app.getPathname()).toBe("/wishlist");
    expect(
      await screen.findByText("Masuk dulu untuk menyimpan wishlist."),
    ).toBeOnTheScreen();
    expect(headerTitles()).toContain("Wishlist saya");
  });
});
