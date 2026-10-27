import { useEffect, useId, useRef } from "react";
import type { ChangeEvent, SubmitEvent } from "react";
import { SORT_OPTIONS } from "../catalog-filters.ts";
import type { CatalogFilters, ProductSort } from "../catalog-filters.ts";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/Button.tsx";
import { Input } from "@/components/ui/Input.tsx";
import { Label } from "@/components/ui/Label.tsx";
import { NativeSelect } from "@/components/ui/NativeSelect.tsx";

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
  const searchRef = useRef<HTMLInputElement>(null);

  // The input is uncontrolled: defaultValue is read once, when it mounts.
  // When the URL's q changes (a search, Back, a category link), write the
  // new text into the input that is already there. Replacing the input
  // instead (a key={filters.q}) would show the same text, but the new
  // element is not the one the buyer typed in: the focus would fall to
  // <body> after every search.
  const q = filters.q ?? "";
  useEffect(() => {
    if (searchRef.current !== null) searchRef.current.value = q;
  }, [q]);

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
    // A column on a phone, a row (wrapping) from sm up.
    <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-6">
      {/* role="search" makes the form a landmark screen readers list. */}
      <form
        role="search"
        className="flex flex-wrap items-center gap-2"
        onSubmit={handleSearch}
      >
        <Label htmlFor={searchId}>Cari produk</Label>
        {/* Uncontrolled: the browser keeps what is typed; the effect
            above updates it when the URL's q changes. */}
        <Input
          ref={searchRef}
          className="flex-1 sm:w-56 sm:flex-none"
          id={searchId}
          name="q"
          type="search"
          defaultValue={q}
          maxLength={100}
        />
        <Button type="submit">
          <Search aria-hidden="true" />
          Cari
        </Button>
      </form>
      <div className="flex flex-wrap items-center gap-2">
        <Label htmlFor={sortId}>Urutkan</Label>
        <NativeSelect
          className="w-auto"
          id={sortId}
          value={filters.sort}
          onChange={handleSort}
        >
          {SORT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </NativeSelect>
      </div>
    </div>
  );
}
