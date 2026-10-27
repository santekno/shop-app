import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { cartLine, cartOf } from "@/test/fake-api.ts";
import { createTestQueryClient, inRouter } from "@/test/render.tsx";
import { CartNavLink } from "./CartNavLink.tsx";

vi.mock("@/lib/api.ts", () => import("@/test/fake-api.ts"));

const link = () => screen.getByRole("link");

describe("CartNavLink", () => {
  it("links to the cart with no count while the cart is empty", async () => {
    render(inRouter(<CartNavLink />));

    expect(link().getAttribute("href")).toBe("/keranjang");
    await vi.waitFor(() => {
      expect(link().textContent).toBe("Keranjang");
    });
    expect(link().querySelector(".cart-count")).toBeNull();
  });

  it("shows the number of units, with barang for screen readers", async () => {
    const client = createTestQueryClient();
    client.setQueryData(
      ["cart", null],
      cartOf([cartLine("m", { quantity: 2 }), cartLine("l", { quantity: 1 })]),
    );

    render(inRouter(<CartNavLink />, client));

    expect(
      await screen.findByRole("link", { name: /^Keranjang 3 barang$/ }),
    ).toBe(link());
    expect(link().querySelector(".cart-count")?.firstChild?.textContent).toBe(
      "3",
    );
    expect(link().querySelector(".visually-hidden")?.textContent).toBe(
      "barang",
    );
  });

  it("marks itself as the current page on /keranjang", () => {
    render(inRouter(<CartNavLink />, undefined, "/keranjang"));

    expect(link().getAttribute("aria-current")).toBe("page");
  });
});
