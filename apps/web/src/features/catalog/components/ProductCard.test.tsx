import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as shared from "@goshop/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { product, rupiah, variant } from "@/test/fake-api.ts";
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
      <ProductCard
        product={product("kaos", { name: "Kaos Polos Hitam" })}
        onSelect={vi.fn()}
      />,
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

    const { container } = render(
      <ProductCard product={item} onSelect={vi.fn()} />,
    );

    expect(container.querySelector(".price")?.textContent).toBe(
      `Mulai ${rupiah(89_000)}`,
    );
  });

  it("leaves Mulai out when every variant costs the same", () => {
    const item = product("kaos", {
      variants: [variant("m"), variant("l")],
    });

    const { container } = render(
      <ProductCard product={item} onSelect={vi.fn()} />,
    );

    expect(screen.queryByText(/Mulai/)).toBeNull();
    expect(container.querySelector(".price")?.textContent).toBe(rupiah(89_000));
  });

  it("shows a Stok habis badge only when the product is out of stock", () => {
    const { rerender } = render(
      <ProductCard
        product={product("kaos", { variants: [variant("m", { stock: 0 })] })}
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getByText("Stok habis")).toBeTruthy();

    rerender(<ProductCard product={product("kaos")} onSelect={vi.fn()} />);
    expect(screen.queryByText("Stok habis")).toBeNull();
  });

  it("opens the product through a button named after it", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <ProductCard
        product={product("kaos-polos", { name: "Kaos Polos" })}
        onSelect={onSelect}
      />,
    );

    const button = screen.getByRole("button", { name: "Kaos Polos" });
    expect(button.getAttribute("type")).toBe("button");
    expect(onSelect).not.toHaveBeenCalled();
    await user.click(button);

    expect(onSelect).toHaveBeenCalledExactlyOnceWith("kaos-polos");
  });

  it("marks its button with the product's slug, for App to return the focus to", () => {
    render(<ProductCard product={product("kaos-polos")} onSelect={vi.fn()} />);

    expect(
      screen
        .getByRole("button", { name: "Produk kaos-polos" })
        .getAttribute("data-product-slug"),
    ).toBe("kaos-polos");
  });

  it("opens the product from the keyboard", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<ProductCard product={product("kaos")} onSelect={onSelect} />);

    await user.tab();
    await user.keyboard("{Enter}");

    expect(onSelect).toHaveBeenCalledExactlyOnceWith("kaos");
  });

  it("skips rendering again when its props are the same objects", () => {
    const item = product("kaos");
    const onSelect = vi.fn();
    const { rerender } = render(
      <ProductCard product={item} onSelect={onSelect} />,
    );
    expect(formatRupiah).toHaveBeenCalledTimes(1);

    rerender(<ProductCard product={item} onSelect={onSelect} />);
    expect(formatRupiah).toHaveBeenCalledTimes(1);

    rerender(<ProductCard product={item} onSelect={vi.fn()} />);
    expect(formatRupiah).toHaveBeenCalledTimes(2);
    rerender(<ProductCard product={{ ...item }} onSelect={onSelect} />);
    expect(formatRupiah).toHaveBeenCalledTimes(3);
  });
});
