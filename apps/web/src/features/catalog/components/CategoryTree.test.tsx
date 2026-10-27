import { buildCategoryTree } from "@goshop/shared";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { category } from "@/test/fake-api.ts";
import { inRouter } from "@/test/render.tsx";
import { CategoryTree } from "./CategoryTree.tsx";

const tree = buildCategoryTree([
  category("1", "Pakaian"),
  category("2", "Elektronik"),
  category("3", "Kaos", "1"),
  category("4", "Kemeja", "1"),
  category("5", "Kaos Polos", "3"),
]);

const hrefFor = (slug: string) => `/?kategori=${slug}`;
const props = { nodes: tree, activeSlug: undefined, hrefFor };

describe("CategoryTree", () => {
  it("renders the top level as one list, in order", () => {
    render(inRouter(<CategoryTree {...props} />));

    const [top] = screen.getAllByRole("list");
    if (!top) throw new Error("no list rendered");
    const items = within(top)
      .getAllByRole("listitem")
      .filter((item) => item.parentElement === top);
    expect(items.map((item) => item.firstElementChild?.textContent)).toEqual([
      "Pakaian",
      "Elektronik",
    ]);
  });

  it("nests the children of a node in a list inside its item", () => {
    render(inRouter(<CategoryTree {...props} />));

    const pakaian = screen.getByText("Pakaian").closest("li");
    if (!pakaian) throw new Error("Pakaian has no list item");
    const [children] = within(pakaian).getAllByRole("list");
    if (!children) throw new Error("Pakaian has no nested list");
    expect(
      within(children)
        .getAllByRole("listitem")
        .filter((item) => item.parentElement === children)
        .map((item) => item.firstElementChild?.textContent),
    ).toEqual(["Kaos", "Kemeja"]);
    expect(within(children).getByText("Kaos Polos")).toBeTruthy();
    expect(screen.getAllByRole("list")).toHaveLength(3);
  });

  it("renders no inner list for a leaf", () => {
    render(inRouter(<CategoryTree {...props} />));

    for (const leaf of ["Elektronik", "Kemeja", "Kaos Polos"]) {
      const item = screen.getByText(leaf).closest("li");
      if (!item) throw new Error(`${leaf} has no list item`);
      expect(within(item).queryByRole("list")).toBeNull();
    }
  });

  it("renders an empty list for no nodes", () => {
    render(inRouter(<CategoryTree {...props} nodes={[]} />));

    expect(screen.getByRole("list").children).toHaveLength(0);
  });

  it("links every category to the catalog filtered by its slug", () => {
    render(inRouter(<CategoryTree {...props} />));

    expect(
      screen.getAllByRole("link").map((link) => link.getAttribute("href")),
    ).toEqual([
      "/?kategori=pakaian",
      "/?kategori=kaos",
      "/?kategori=kaos polos",
      "/?kategori=kemeja",
      "/?kategori=elektronik",
    ]);
  });

  it("marks only the active category, at any depth, with aria-current", () => {
    render(inRouter(<CategoryTree {...props} activeSlug="kaos polos" />));

    const current = screen
      .getAllByRole("link")
      .filter((link) => link.getAttribute("aria-current") === "true");
    expect(current.map((link) => link.textContent)).toEqual(["Kaos Polos"]);
  });
});
