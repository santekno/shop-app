import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchMock, product } from "@/test/fake-api.ts";
import { currentLocation, inRouter } from "@/test/render.tsx";
import { ProductGrid } from "./ProductGrid.tsx";

// A card that gets the focus prefetches its product: no real request.
vi.mock("@/lib/api.ts", () => import("@/test/fake-api.ts"));

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockReturnValue(new Promise(() => undefined));
});

const itemOf = (name: string) => {
  const item = screen.getByText(name).closest("li");
  if (!item) throw new Error(`${name} is not in a list item`);
  return item;
};

describe("ProductGrid", () => {
  it("renders one list item with a card per product, in order", () => {
    render(
      inRouter(
        <ProductGrid products={[product("a"), product("b"), product("c")]} />,
      ),
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
    const { rerender } = render(inRouter(<ProductGrid products={[a, b]} />));
    const itemA = itemOf("Produk a");
    const itemB = itemOf("Produk b");

    rerender(inRouter(<ProductGrid products={[product("new"), b, a]} />));

    expect(itemOf("Produk a")).toBe(itemA);
    expect(itemOf("Produk b")).toBe(itemB);
    expect(screen.getAllByRole("listitem")[0]).not.toBe(itemA);
  });

  it("links every card to its product", async () => {
    const user = userEvent.setup();
    render(inRouter(<ProductGrid products={[product("a"), product("b")]} />));

    await user.click(screen.getByRole("link", { name: "Produk b" }));

    expect(currentLocation()).toBe("/produk/b");
  });

  it("loads the first row's photos with the page and the rest lazily", () => {
    const withPhoto = (slug: string) =>
      product(slug, {
        images: [
          {
            id: `img-${slug}`,
            url: `https://cdn.example.com/${slug}/800.jpg`,
            alt: "",
            width: 800,
            height: 800,
            variants: [],
          },
        ],
      });
    render(
      inRouter(
        <ProductGrid
          products={["a", "b", "c", "d", "e", "f"].map(withPhoto)}
        />,
      ),
    );

    const loading = within(screen.getByRole("list"))
      .getAllByRole("img")
      .map((img) => img.getAttribute("loading"));
    expect(loading).toEqual([
      "eager",
      "eager",
      "eager",
      "eager",
      "lazy",
      "lazy",
    ]);
  });

  it("renders an empty list for no products", () => {
    render(inRouter(<ProductGrid products={[]} />));

    expect(screen.getByRole("list").children).toHaveLength(0);
  });
});
