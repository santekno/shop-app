import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as shared from "@goshop/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { product, rupiah, variant } from "@/test/fake-api.ts";
import { currentLocation, inRouter } from "@/test/render.tsx";
import { ProductCard } from "./ProductCard.tsx";

// Every export keeps its real behaviour; formatRupiah's calls are counted
// to tell whether a card rendered again.
vi.mock("@goshop/shared", { spy: true });
const formatRupiah = vi.mocked(shared.formatRupiah);

beforeEach(() => {
  formatRupiah.mockClear();
});

describe("ProductCard", () => {
  it("shows the name, category, price and a photo placeholder in an article", () => {
    render(
      inRouter(
        <ProductCard product={product("kaos", { name: "Kaos Polos Hitam" })} />,
      ),
    );

    const card = screen.getByRole("article");
    expect(
      within(card).getByRole("heading", { level: 3, name: "Kaos Polos Hitam" }),
    ).toBeTruthy();
    expect(within(card).getByText("Kaos")).toBeTruthy();
    expect(card.querySelector(".price")?.textContent).toBe(rupiah(89_000));
    expect(within(card).getByText("Belum ada foto")).toBeTruthy();
  });

  it("says Mulai when the variants' prices differ", () => {
    const item = product("kaos", {
      variants: [
        variant("m", { price: { amount: 89_000, currency: "IDR" } }),
        variant("xxl", { price: { amount: 99_000, currency: "IDR" } }),
      ],
    });

    const { container } = render(inRouter(<ProductCard product={item} />));

    expect(container.querySelector(".price")?.textContent).toBe(
      `Mulai ${rupiah(89_000)}`,
    );
  });

  it("leaves Mulai out when every variant costs the same", () => {
    const item = product("kaos", { variants: [variant("m"), variant("l")] });

    const { container } = render(inRouter(<ProductCard product={item} />));

    expect(screen.queryByText(/Mulai/)).toBeNull();
    expect(container.querySelector(".price")?.textContent).toBe(rupiah(89_000));
  });

  it("shows a Stok habis badge only when the product is out of stock", () => {
    const { rerender } = render(
      inRouter(
        <ProductCard
          product={product("kaos", { variants: [variant("m", { stock: 0 })] })}
        />,
      ),
    );
    expect(screen.getByText("Stok habis")).toBeTruthy();

    rerender(inRouter(<ProductCard product={product("kaos")} />));
    expect(screen.queryByText("Stok habis")).toBeNull();
  });

  it("links to the product's page, named after the product", async () => {
    const user = userEvent.setup();
    render(
      inRouter(
        <ProductCard product={product("kaos-polos", { name: "Kaos Polos" })} />,
      ),
    );

    const link = screen.getByRole("link", { name: "Kaos Polos" });
    expect(link.getAttribute("href")).toBe("/produk/kaos-polos");
    await user.click(link);

    expect(currentLocation()).toBe("/produk/kaos-polos");
  });

  it("encodes the slug in the link", () => {
    render(inRouter(<ProductCard product={product("a/b?c")} />));

    expect(
      screen.getByRole("link", { name: "Produk a/b?c" }).getAttribute("href"),
    ).toBe("/produk/a%2Fb%3Fc");
  });

  it("marks its link with the product's slug, for the focus to return to", () => {
    render(inRouter(<ProductCard product={product("kaos-polos")} />));

    expect(
      screen
        .getByRole("link", { name: "Produk kaos-polos" })
        .getAttribute("data-product-slug"),
    ).toBe("kaos-polos");
  });

  it("opens the product from the keyboard", async () => {
    const user = userEvent.setup();
    render(inRouter(<ProductCard product={product("kaos")} />));

    await user.tab();
    await user.keyboard("{Enter}");

    expect(currentLocation()).toBe("/produk/kaos");
  });

  it("skips rendering again when its props are the same objects", () => {
    const item = product("kaos");
    const { rerender } = render(inRouter(<ProductCard product={item} />));
    expect(formatRupiah).toHaveBeenCalledTimes(1);

    rerender(inRouter(<ProductCard product={item} />));
    expect(formatRupiah).toHaveBeenCalledTimes(1);

    rerender(inRouter(<ProductCard product={{ ...item }} />));
    expect(formatRupiah).toHaveBeenCalledTimes(2);
  });
});
