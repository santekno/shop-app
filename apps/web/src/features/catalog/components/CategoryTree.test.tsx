import { buildCategoryTree } from "@goshop/shared";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { category } from "@/test/fake-api.ts";
import { CategoryTree } from "./CategoryTree.tsx";

const tree = buildCategoryTree([
  category("1", "Pakaian"),
  category("2", "Elektronik"),
  category("3", "Kaos", "1"),
  category("4", "Kemeja", "1"),
  category("5", "Kaos Polos", "3"),
]);

describe("CategoryTree", () => {
  it("renders the top level as one list, in order", () => {
    render(<CategoryTree nodes={tree} />);

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
    render(<CategoryTree nodes={tree} />);

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
    render(<CategoryTree nodes={tree} />);

    for (const leaf of ["Elektronik", "Kemeja", "Kaos Polos"]) {
      const item = screen.getByText(leaf).closest("li");
      if (!item) throw new Error(`${leaf} has no list item`);
      expect(within(item).queryByRole("list")).toBeNull();
    }
  });

  it("renders an empty list for no nodes", () => {
    render(<CategoryTree nodes={[]} />);

    expect(screen.getByRole("list").children).toHaveLength(0);
  });
});
