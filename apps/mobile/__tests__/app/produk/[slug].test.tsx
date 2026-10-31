import { afterEach, describe, expect, it } from "@jest/globals";
import { screen } from "@testing-library/react-native";

import { queryClient } from "@/lib/query-client";
import { answerEmptyCatalog, headerTitles, renderApp } from "@/test/router";

afterEach(() => {
  queryClient.clear();
});

describe("the product screen", () => {
  it("shows the slug from the link and titles the header with it", async () => {
    answerEmptyCatalog();
    await renderApp("/produk/kaos-polos-hitam");

    expect(
      screen.getByRole("header", { name: "Detail produk" }),
    ).toBeOnTheScreen();
    expect(screen.getByText("kaos-polos-hitam")).toBeOnTheScreen();
    expect(headerTitles()).toEqual(["kaos-polos-hitam"]);
  });

  it("reads an encoded slug as text, not as a path", async () => {
    answerEmptyCatalog();
    await renderApp("/produk/kaos%20polos");
    expect(screen.getByText("kaos polos")).toBeOnTheScreen();
  });
});
