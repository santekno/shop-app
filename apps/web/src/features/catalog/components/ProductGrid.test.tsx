import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { product } from "@/test/fake-api.ts";
import { ProductGrid } from "./ProductGrid.tsx";

const itemOf = (name: string) => {
  const item = screen.getByText(name).closest("li");
  if (!item) throw new Error(`${name} is not in a list item`);
  return item;
};

describe("ProductGrid", () => {
  it("renders one list item with a card per product, in order", () => {
    render(
      <ProductGrid
        products={[product("a"), product("b"), product("c")]}
        onSelectProduct={vi.fn()}
      />,
    );

    const items = within(screen.getByRole("list")).getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(
      items.map((item) => within(item).getByRole("heading").textContent),
    ).toEqual(["Produk a", "Produk b", "Produk c"]);
    expect(items.every((item) => within(item).queryByRole("article"))).toBe(
      true,
    );
  });

  it("keys items by product id, so a product keeps its element when the list changes", () => {
    const a = product("a");
    const b = product("b");
    const { rerender } = render(
      <ProductGrid products={[a, b]} onSelectProduct={vi.fn()} />,
    );
    const itemA = itemOf("Produk a");
    const itemB = itemOf("Produk b");

    rerender(
      <ProductGrid
        products={[product("new"), b, a]}
        onSelectProduct={vi.fn()}
      />,
    );

    expect(itemOf("Produk a")).toBe(itemA);
    expect(itemOf("Produk b")).toBe(itemB);
    expect(screen.getAllByRole("listitem")[0]).not.toBe(itemA);
  });

  it("passes onSelectProduct to every card", async () => {
    const user = userEvent.setup();
    const onSelectProduct = vi.fn();
    render(
      <ProductGrid
        products={[product("a"), product("b")]}
        onSelectProduct={onSelectProduct}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Produk b" }));

    expect(onSelectProduct).toHaveBeenCalledExactlyOnceWith("b");
  });

  it("renders an empty list for no products", () => {
    render(<ProductGrid products={[]} onSelectProduct={vi.fn()} />);

    expect(screen.getByRole("list").children).toHaveLength(0);
  });
});
