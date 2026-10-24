import { useId } from "react";
import type { ChangeEvent, SubmitEvent } from "react";
import { SORT_OPTIONS } from "../catalog-filters.ts";
import type { CatalogFilters, ProductSort } from "../catalog-filters.ts";

interface CatalogToolbarProps {
  filters: CatalogFilters;
  /** Called with the new filters; the page writes them into the URL. */
  onChange: (filters: CatalogFilters) => void;
}

const isProductSort = (value: string): value is ProductSort =>
  SORT_OPTIONS.some((option) => option.value === value);

/** The search box and the sort menu above the product grid. */
export function CatalogToolbar({ filters, onChange }: CatalogToolbarProps) {
  const searchId = useId();
  const sortId = useId();

  // The search runs when the form is submitted (Enter or "Cari"), not on
  // every key: each search is one entry in the history, and one request.
  const handleSearch = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const q = new FormData(event.currentTarget).get("q");
    const text = typeof q === "string" ? q.trim() : "";
    onChange({ ...filters, q: text === "" ? undefined : text });
  };

  const handleSort = (event: ChangeEvent<HTMLSelectElement>) => {
    const { value } = event.currentTarget;
    if (isProductSort(value)) onChange({ ...filters, sort: value });
  };

  return (
    <div className="catalog-toolbar">
      {/* role="search" makes the form a landmark screen readers list. */}
      <form role="search" className="catalog-search" onSubmit={handleSearch}>
        <label htmlFor={searchId}>Cari produk</label>
        {/* Uncontrolled: the browser keeps what is typed. The key
            replaces the input when the URL's q changes (Back, a category
            link), so it shows the search that is on screen. */}
        <input
          key={filters.q ?? ""}
          id={searchId}
          name="q"
          type="search"
          defaultValue={filters.q ?? ""}
          maxLength={100}
        />
        <button type="submit">Cari</button>
      </form>
      <div className="catalog-sort">
        <label htmlFor={sortId}>Urutkan</label>
        <select id={sortId} value={filters.sort} onChange={handleSort}>
          {SORT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
