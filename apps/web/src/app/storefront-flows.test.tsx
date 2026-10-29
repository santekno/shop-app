import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  categoriesResponse,
  category,
  fetchMock,
  product,
  productResponse,
  productsResponse,
  requestUrl,
  serve,
} from "@/test/fake-api.ts";
import { currentLocation, renderApp } from "@/test/render.tsx";

vi.mock("@/lib/api.ts", () => import("@/test/fake-api.ts"));

const listRequests = () =>
  fetchMock.mock.calls.filter(
    ([input]) => requestUrl(input).pathname === "/v1/products",
  ).length;

beforeEach(() => {
  fetchMock.mockReset();
  serve((url) => {
    if (url.pathname === "/v1/categories") {
      return categoriesResponse([category("1", "Kaos")]);
    }
    if (url.pathname === "/v1/products") {
      return url.searchParams.get("cursor") === "c2"
        ? productsResponse([product("kemeja", { name: "Kemeja" })], null)
        : productsResponse([product("kaos", { name: "Kaos Polos" })], "c2");
    }
    if (url.pathname === "/v1/products/kemeja") {
      return productResponse(product("kemeja", { name: "Kemeja" }));
    }
    return undefined;
  });
});

describe("browsing the storefront", () => {
  it("comes back from a product to the same filtered list, every loaded page kept, focus on its card", async () => {
    const user = userEvent.setup();
    const { router } = renderApp("/?urut=termurah");
    await user.click(
      await screen.findByRole("button", { name: "Muat lebih banyak" }),
    );
    await user.click(await screen.findByRole("link", { name: "Kemeja" }));
    await screen.findByRole("heading", { level: 1, name: "Kemeja" });
    const loaded = listRequests();

    await user.click(
      screen.getByRole("link", { name: "← Kembali ke katalog" }),
    );

    expect(currentLocation()).toBe("/?urut=termurah");
    // Back in history, not a new visit to the catalog.
    expect(router.lastAction).toBe("back");
    const card = await screen.findByRole("link", { name: "Kemeja" });
    expect(screen.getByRole("link", { name: "Kaos Polos" })).toBeTruthy();
    expect(document.activeElement).toBe(card);
    // Both pages came from the cache: nothing was fetched again.
    expect(listRequests()).toBe(loaded);
    expect(
      screen.getByRole<HTMLSelectElement>("combobox", { name: "Urutkan" })
        .value,
    ).toBe("price_asc");
  });
});
