import { useState } from "react";
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

/** The toolbar with its filters in state, as CatalogPage keeps them in
 *  the URL: onChange renders it again with the new filters. */
function StatefulToolbar({ initial }: { initial: CatalogFilters }) {
  const [current, setCurrent] = useState(initial);
  return <CatalogToolbar filters={current} onChange={setCurrent} />;
}

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

  it("keeps the focus on the same search box after a search", async () => {
    const user = userEvent.setup();
    render(<StatefulToolbar initial={filters} />);
    const box = search();

    await user.type(box, "  hitam {Enter}");

    expect(search()).toBe(box);
    expect(document.activeElement).toBe(box);
    expect(box.value).toBe("hitam");

    // A second search, and clearing it, keep it too.
    await user.clear(box);
    await user.type(box, "polos{Enter}");
    await user.clear(box);
    await user.type(box, "{Enter}");
    expect(search()).toBe(box);
    expect(document.activeElement).toBe(box);
    expect(box.value).toBe("");
  });

  it("replaces unsubmitted text with the URL's search when it changes", async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <CatalogToolbar filters={filters} onChange={vi.fn()} />,
    );
    await user.type(search(), "belum dicari");

    // Back to a page whose URL has ?q=polos.
    rerender(
      <CatalogToolbar
        filters={{ ...filters, q: "polos" }}
        onChange={vi.fn()}
      />,
    );
    expect(search().value).toBe("polos");

    await user.type(search(), " lagi");
    // A category link: q is gone from the URL.
    rerender(
      <CatalogToolbar
        filters={{ ...filters, category: "celana" }}
        onChange={vi.fn()}
      />,
    );
    expect(search().value).toBe("");
  });

  it("leaves unsubmitted text alone when only the sort changes", async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <CatalogToolbar
        filters={{ ...filters, q: "polos" }}
        onChange={vi.fn()}
      />,
    );
    await user.clear(search());
    await user.type(search(), "kaos hitam");

    rerender(
      <CatalogToolbar
        filters={{ ...filters, q: "polos", sort: "price_asc" }}
        onChange={vi.fn()}
      />,
    );
    expect(search().value).toBe("kaos hitam");
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
