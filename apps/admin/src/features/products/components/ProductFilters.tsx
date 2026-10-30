import { useId } from "react";
import { Button } from "@/components/ui/Button.tsx";
import { Label } from "@/components/ui/Label.tsx";
import { NativeSelect } from "@/components/ui/NativeSelect.tsx";
import { useCategoryOptions } from "../hooks/useCategoryOptions.ts";
import {
  CLEAR_FILTERS,
  hasActiveFilters,
  STATUS_OPTIONS,
} from "../product-table-params.ts";
import type { ProductTableParams } from "../product-table-params.ts";
import { ProductSearchField } from "./ProductSearchField.tsx";

interface ProductFiltersProps {
  params: ProductTableParams;
  onChange: (
    change: Partial<ProductTableParams>,
    options?: { replace?: boolean },
  ) => void;
  /**
   * The API's `low_stock_threshold`, from the table's last response;
   * `undefined` until the first one arrives (the label then has no number).
   */
  lowStockThreshold?: number | undefined;
}

/** Indents a child category in a native <select>, which ignores CSS padding. */
const indent = (depth: number) => "   ".repeat(depth);

/**
 * The controls over the table: search, status, category, low stock, and
 * "Hapus filter" when any of them narrows the table.
 *
 * They are not TanStack Table's column filters. The API filters (by name
 * or SKU, by a category and its children, by low stock), so the table
 * only renders what came back; the filters live in the URL, next to the
 * sort and the page, and reach the API through the query key.
 */
export function ProductFilters({
  params,
  onChange,
  lowStockThreshold,
}: ProductFiltersProps) {
  const statusId = useId();
  const categoryId = useId();
  const lowStockId = useId();
  const categories = useCategoryOptions();
  const options = categories.data ?? [];
  // A category from a shared link that is not in the list (deleted, or a
  // typo): keep it selectable, so the menu does not claim "Semua kategori"
  // while the table is filtered by something else.
  const unknownCategory =
    params.categoryId !== undefined &&
    categories.isSuccess &&
    !options.some((option) => option.id === params.categoryId);

  return (
    <div className="mb-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto] lg:items-end">
      <ProductSearchField
        value={params.q}
        onSearch={(q) => {
          // Starting or ending a search is a step Back returns to;
          // refining one replaces the entry, so Back skips "k", "ka", "kao".
          onChange(
            { q },
            { replace: params.q !== undefined && q !== undefined },
          );
        }}
      />

      <div className="grid gap-1.5">
        <Label htmlFor={statusId}>Status</Label>
        <NativeSelect
          id={statusId}
          value={params.status ?? ""}
          onChange={(event) => {
            onChange({
              status: STATUS_OPTIONS.find(
                (option) => option.value === event.target.value,
              )?.value,
            });
          }}
        >
          <option value="">Semua status</option>
          {STATUS_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </NativeSelect>
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor={categoryId}>Kategori</Label>
        <NativeSelect
          id={categoryId}
          value={params.categoryId ?? ""}
          aria-describedby={
            categories.isError ? `${categoryId}-error` : undefined
          }
          onChange={(event) => {
            const id = event.target.value;
            onChange({ categoryId: id === "" ? undefined : id });
          }}
        >
          <option value="">Semua kategori</option>
          {categories.isPending && (
            <option disabled value="memuat">
              Memuat kategori…
            </option>
          )}
          {unknownCategory && (
            <option value={params.categoryId}>Kategori tidak dikenal</option>
          )}
          {options.map((option) => (
            <option key={option.id} value={option.id}>
              {indent(option.depth)}
              {option.name}
            </option>
          ))}
        </NativeSelect>
        {categories.isError && (
          <p id={`${categoryId}-error`} className="text-sm text-destructive">
            Kategori tidak dapat dimuat.{" "}
            <Button
              variant="link"
              size="sm"
              onClick={() => void categories.refetch()}
            >
              Coba lagi
            </Button>
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 sm:col-span-2 lg:col-span-1 lg:h-10">
        <div className="flex items-center gap-2">
          <input
            id={lowStockId}
            type="checkbox"
            checked={params.lowStock}
            onChange={(event) => {
              onChange({ lowStock: event.target.checked });
            }}
            className="size-4 accent-primary"
          />
          <Label htmlFor={lowStockId} className="whitespace-nowrap">
            Stok menipis
            {lowStockThreshold !== undefined && ` (≤ ${lowStockThreshold})`}
          </Label>
        </div>
        {hasActiveFilters(params) && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              onChange(CLEAR_FILTERS);
            }}
          >
            Hapus filter
          </Button>
        )}
      </div>
    </div>
  );
}
