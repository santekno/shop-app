import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { CatalogFilters } from "../catalog-filters.ts";
import { CatalogToolbar } from "./CatalogToolbar.tsx";

const filters: CatalogFilters = {
  category: "kaos",
  q: undefined,
  sort: "newest",
};

const search = () =>
  screen.getByRole<HTMLInputElement>("searchbox", { name: "Cari produk" });
const sort = () =>
  screen.getByRole<HTMLSelectElement>("combobox", { name: "Urutkan" });

describe("CatalogToolbar", () => {
  it("shows a search landmark and the sort menu with the current filters", () => {
    render(
      <CatalogToolbar
        filters={{ ...filters, q: "polos", sort: "price_asc" }}
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByRole("search")).toBeTruthy();
    expect(search().value).toBe("polos");
    expect(search().maxLength).toBe(100);
    expect(sort().value).toBe("price_asc");
    expect(
      Array.from(sort().options).map((option) => [option.value, option.text]),
    ).toEqual([
      ["newest", "Terbaru"],
      ["price_asc", "Harga terendah"],
      ["price_desc", "Harga tertinggi"],
    ]);
  });

  it("searches on submit with the trimmed text, keeping the other filters", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<CatalogToolbar filters={filters} onChange={onChange} />);

    await user.type(search(), "  kaos polos ");
    expect(onChange).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Cari" }));

    expect(onChange).toHaveBeenCalledExactlyOnceWith({
      ...filters,
      q: "kaos polos",
    });
  });

  it("searches with Enter too", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<CatalogToolbar filters={filters} onChange={onChange} />);

    await user.type(search(), "hitam{Enter}");

    expect(onChange).toHaveBeenCalledExactlyOnceWith({
      ...filters,
      q: "hitam",
    });
  });

  it("clears the search when the box is submitted empty or blank", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <CatalogToolbar
        filters={{ ...filters, q: "polos" }}
        onChange={onChange}
      />,
    );

    await user.clear(search());
    await user.type(search(), "   {Enter}");

    expect(onChange).toHaveBeenCalledExactlyOnceWith({
      ...filters,
      q: undefined,
    });
  });

  it("changes the sort, keeping the other filters", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <CatalogToolbar
        filters={{ ...filters, q: "polos" }}
        onChange={onChange}
      />,
    );

    await user.selectOptions(sort(), "Harga tertinggi");

    expect(onChange).toHaveBeenCalledExactlyOnceWith({
      ...filters,
      q: "polos",
      sort: "price_desc",
    });
  });

  it("shows the URL's search text again when it changes from outside", () => {
    const { rerender } = render(
      <CatalogToolbar
        filters={{ ...filters, q: "polos" }}
        onChange={vi.fn()}
      />,
    );

    rerender(
      <CatalogToolbar
        filters={{ ...filters, q: "hitam" }}
        onChange={vi.fn()}
      />,
    );
    expect(search().value).toBe("hitam");

    rerender(<CatalogToolbar filters={filters} onChange={vi.fn()} />);
    expect(search().value).toBe("");
  });
});
