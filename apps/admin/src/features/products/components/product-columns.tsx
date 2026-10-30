import {
  createColumnHelper,
  metaHelper,
  rowPaginationFeature,
  rowSortingFeature,
  tableFeatures,
} from "@tanstack/react-table";
import { Link } from "react-router";
import { formatRupiah } from "@goshop/shared";
import type { AdminProductRow } from "@goshop/shared";
import { Badge } from "@/components/ui/Badge.tsx";
import { formatDateTime } from "@/lib/format-date.ts";
import { ProductStatusBadge } from "./ProductStatusBadge.tsx";
import { ProductThumbnail } from "./ProductThumbnail.tsx";

/** What a column says about its own cells, beyond TanStack's options. */
interface ProductColumnMeta {
  /** Numbers line up on the right, so their digits do. */
  align?: "end";
}

/**
 * The table's features. TanStack Table v9 has nothing built in: a table
 * gets the state and the methods of the features it lists. Sorting and
 * pagination, and no row models for them: the server sorts and pages
 * (manualSorting, manualPagination in ProductTable), so the browser never
 * reorders or slices the 20 rows it gets.
 *
 * Module level, like the columns below: TanStack compares these by
 * identity, and a new object on every render would rebuild the table's
 * models on every render.
 */
export const productTableFeatures = tableFeatures({
  rowSortingFeature,
  rowPaginationFeature,
  columnMeta: metaHelper<ProductColumnMeta>(),
});

const column = createColumnHelper<
  typeof productTableFeatures,
  AdminProductRow
>();

/**
 * An ISO timestamp as a <time>: readable text, machine-readable value.
 * A plain function, not a component: this file exports only data, which
 * keeps hot reload working (react-refresh/only-export-components).
 */
const renderDate = (value: string) => (
  <time dateTime={value} className="whitespace-nowrap">
    {formatDateTime(value)}
  </time>
);

/**
 * The columns. A column's `id` is the API's `sort` value (an accessor's
 * id is its key: "name", "price_from", …), so a sorting state from
 * TanStack is already a query for the API: [{ id: "price_from", desc:
 * false }] is sort=price_from&order=asc.
 *
 * sortDescFirst: the first click on a number or a date sorts the biggest
 * or newest first, which is what a seller looks for ("which product has
 * the most stock?"); a name starts at A.
 */
export const productColumns = column.columns([
  column.display({
    id: "thumbnail",
    header: "Foto",
    cell: ({ row }) => <ProductThumbnail url={row.original.thumbnail_url} />,
  }),
  column.accessor("name", {
    header: "Produk",
    sortDescFirst: false,
    cell: ({ row }) => (
      <div className="grid min-w-48 gap-0.5">
        {/* The name is the way to the product's page: a real link, so
            it opens in a new tab and a screen reader lists it. */}
        <Link
          to={`/produk/${row.original.id}`}
          className="font-medium text-foreground underline-offset-4 hover:underline"
        >
          {row.original.name}
        </Link>
        <span className="text-xs text-muted-foreground">
          {row.original.category.name}
        </span>
      </div>
    ),
  }),
  column.accessor("status", {
    header: "Status",
    enableSorting: false,
    cell: ({ getValue }) => <ProductStatusBadge status={getValue()} />,
  }),
  column.accessor("price_from", {
    header: "Harga mulai",
    sortDescFirst: true,
    meta: { align: "end" },
    cell: ({ getValue }) => {
      const price = getValue();
      if (price === null) {
        return (
          <>
            <span aria-hidden="true">—</span>
            <span className="sr-only">Belum ada harga</span>
          </>
        );
      }
      return <span className="whitespace-nowrap">{formatRupiah(price)}</span>;
    },
  }),
  column.accessor("stock", {
    header: "Stok",
    sortDescFirst: true,
    meta: { align: "end" },
    cell: ({ row }) => (
      <div className="flex items-center justify-end gap-2">
        {row.original.low_stock && (
          <Badge variant="destructive">Stok menipis</Badge>
        )}
        <span className="tabular-nums">
          {row.original.stock.toLocaleString("id-ID")}
        </span>
      </div>
    ),
  }),
  column.accessor("variant_count", {
    header: "Varian",
    enableSorting: false,
    meta: { align: "end" },
    cell: ({ getValue }) => <span className="tabular-nums">{getValue()}</span>,
  }),
  column.accessor("updated_at", {
    header: "Diubah",
    sortDescFirst: true,
    cell: ({ getValue }) => renderDate(getValue()),
  }),
  column.accessor("created_at", {
    header: "Dibuat",
    sortDescFirst: true,
    cell: ({ getValue }) => renderDate(getValue()),
  }),
]);
