import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import { onlineManager } from "@tanstack/react-query";
import { screen, userEvent } from "@testing-library/react-native";
import { router } from "expo-router";

import { apiError, fakeApi, json } from "@/test/fake-api";
import { product, productPage } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { FeaturedProducts } from "./FeaturedProducts";

beforeEach(() => {
  jest.spyOn(router, "push").mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
  onlineManager.setOnline(true);
});

describe("FeaturedProducts", () => {
  it("asks for the 8 newest featured products and lists them under 'Produk unggulan'", async () => {
    fakeApi.on("GET", "/v1/products", () =>
      json(productPage([product("Kaos Polos"), product("Celana Chino")])),
    );
    await renderWithProviders(<FeaturedProducts bleed={16} />);

    expect(await screen.findByText("Kaos Polos")).toBeTruthy();
    expect(screen.getByText("Celana Chino")).toBeTruthy();
    expect(
      screen.getByRole("header", { name: "Produk unggulan" }),
    ).toBeTruthy();
    const params = fakeApi.requests("GET", "/v1/products")[0]?.url.searchParams;
    expect(params?.get("featured")).toBe("true");
    expect(params?.get("limit")).toBe("8");
    expect(params?.get("sort")).toBe("newest");
  });

  it("pressing a card opens its product page", async () => {
    fakeApi.on("GET", "/v1/products", () =>
      json(productPage([product("Kaos Polos")])),
    );
    await renderWithProviders(<FeaturedProducts bleed={16} />);

    await userEvent.press(await screen.findByText("Kaos Polos"));

    expect(router.push).toHaveBeenCalledWith({
      pathname: "/produk/[slug]",
      params: { slug: "kaos-polos" },
    });
  });

  it("says so when no product is featured", async () => {
    fakeApi.on("GET", "/v1/products", () => json(productPage([])));
    await renderWithProviders(<FeaturedProducts bleed={16} />);

    expect(await screen.findByText("Belum ada produk unggulan.")).toBeTruthy();
  });

  it("a failure shows Coba lagi, which reloads the row", async () => {
    fakeApi.once("GET", "/v1/products", () => apiError(500, "INTERNAL", "r-4"));
    fakeApi.on("GET", "/v1/products", () =>
      json(productPage([product("Pulih")])),
    );
    await renderWithProviders(<FeaturedProducts bleed={16} />);

    await userEvent.press(
      await screen.findByRole("button", { name: "Coba lagi" }),
    );

    expect(await screen.findByText("Pulih")).toBeTruthy();
  });

  it("offline at start waits for the connection", async () => {
    onlineManager.setOnline(false);
    fakeApi.on("GET", "/v1/products", () => json(productPage([])));
    await renderWithProviders(<FeaturedProducts bleed={16} />);

    expect(
      await screen.findByText(
        "Tidak ada koneksi internet. Produk unggulan dimuat begitu koneksi kembali.",
      ),
    ).toBeTruthy();
  });
});
