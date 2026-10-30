import { memo, useMemo } from "react";
import type { ReactNode } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { FlexRender, functionalUpdate, useTable } from "@tanstack/react-table";
import type {
  PaginationState,
  Row,
  SortDirection,
  SortingState,
  Updater,
} from "@tanstack/react-table";
import type { AdminProductRow, AdminProductTable } from "@goshop/shared";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/Table.tsx";
import { cn } from "@/lib/utils.ts";
import { isSortableColumn } from "../product-table-params.ts";
import type { PageSize, ProductTableParams } from "../product-table-params.ts";
import { productColumns, productTableFeatures } from "./product-columns.tsx";
import { TablePagination } from "./TablePagination.tsx";

interface ProductTableProps {
  /** The page to show: the API's answer for `params`, or the previous one while it loads. */
  result: AdminProductTable;
  /** The URL's state; the table reads its sort and page from it. */
  params: ProductTableParams;
  /** A header or a pagination control was used: the new sort or page. */
  onChange: (change: Partial<ProductTableParams>) => void;
  /** The rows on screen are the previous page's while the next one loads. */
  busy: boolean;
}

/** A row's identity is its product ID, not its index on the page. */
const getRowId = (row: AdminProductRow) => row.id;

/** The id of the caption, which names the scrolling region too. */
const CAPTION_ID = "tabel-produk-judul";

const SORT_WORD: Record<SortDirection, string> = {
  asc: "naik",
  desc: "turun",
};

/**
 * The value of aria-sort on a column header: only the sorted column says
 * how it is sorted; the others say nothing (ARIA: at most one header in a
 * table carries a sort direction).
 */
const ariaSort = (sorted: false | SortDirection) => {
  if (sorted === false) return undefined;
  return sorted === "asc" ? "ascending" : "descending";
};

/**
 * The product table, built with TanStack Table: a headless library, so
 * it computes the header groups, rows and cells, and the sort and page
 * logic, while every element on screen is ours (components/ui/Table.tsx).
 *
 * Server-side ("manual") sorting and pagination: the table never reorders
 * or slices `result.data`. It is told the current sort and page
 * (`state`), and when the seller clicks a header or "Berikutnya", it
 * calls onSortingChange / onPaginationChange with an *updater*; we
 * apply it to the current state with functionalUpdate and write the
 * result to the URL. The URL change fetches the new page, and the new
 * page comes back as `result`. The table owns no state of its own.
 */
export function ProductTable({
  result,
  params,
  onChange,
  busy,
}: ProductTableProps) {
  const { sort, order, page, perPage } = params;

  // The URL's state in TanStack's shape. Memoised, so the table sees the
  // same object until the URL really changes.
  const sorting = useMemo<SortingState>(
    () => [{ id: sort, desc: order === "desc" }],
    [sort, order],
  );
  const pagination = useMemo<PaginationState>(
    () => ({ pageIndex: page - 1, pageSize: perPage }),
    [page, perPage],
  );

  const onSortingChange = (updater: Updater<SortingState>) => {
    const [next] = functionalUpdate(updater, sorting);
    // enableSortingRemoval: false means there is always one sort; the
    // guard keeps anything else (and a column the API cannot sort by)
    // out of the URL.
    if (next === undefined || !isSortableColumn(next.id)) return;
    onChange({ sort: next.id, order: next.desc ? "desc" : "asc" });
  };

  const onPaginationChange = (updater: Updater<PaginationState>) => {
    const next = functionalUpdate(updater, pagination);
    onChange({
      page: next.pageIndex + 1,
      // Only the page-size menu changes it, and it offers PAGE_SIZE_OPTIONS.
      perPage: next.pageSize as PageSize,
    });
  };

  const table = useTable({
    features: productTableFeatures,
    columns: productColumns,
    data: result.data,
    getRowId,
    state: { sorting, pagination },
    onSortingChange,
    onPaginationChange,
    manualSorting: true,
    manualPagination: true,
    // The total from the API: TanStack derives the page count, and
    // whether "Berikutnya" and "Terakhir" can be used, from it.
    rowCount: result.page.total,
    // A click always sorts (asc ⇄ desc), never "unsorted": the API has
    // no unsorted order, only its default.
    enableSortingRemoval: false,
    // One column at a time: the API sorts by one.
    enableMultiSort: false,
    // Read by the stock cells (product-columns.tsx).
    meta: { lowStockThreshold: result.low_stock_threshold },
  });

  const sortedColumn = table.getColumn(sort);
  const sortedLabel =
    typeof sortedColumn?.columnDef.header === "string"
      ? sortedColumn.columnDef.header
      : sort;

  return (
    <div className="grid gap-4">
      <TableContainer
        aria-labelledby={CAPTION_ID}
        aria-busy={busy}
        className={cn("transition-opacity", busy && "opacity-60")}
      >
        <Table>
          {/* The caption names the table and says how it is sorted. It
              sits under the table (caption-bottom) and only for screen
              readers: the headers show the sort to the eye. */}
          <TableCaption id={CAPTION_ID} className="sr-only">
            Daftar produk, diurutkan menurut {sortedLabel} {SORT_WORD[order]}
          </TableCaption>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id} className="hover:bg-transparent">
                {headerGroup.headers.map((header) => {
                  const { column } = header;
                  const sorted = column.getIsSorted();
                  const alignEnd = column.columnDef.meta?.align === "end";
                  return (
                    <TableHead
                      key={header.id}
                      aria-sort={ariaSort(sorted)}
                      className={cn(alignEnd && "text-right")}
                    >
                      {column.getCanSort() ? (
                        <SortButton
                          sorted={sorted}
                          alignEnd={alignEnd}
                          onClick={column.getToggleSortingHandler()}
                        >
                          <table.FlexRender header={header} />
                        </SortButton>
                      ) : (
                        <table.FlexRender header={header} />
                      )}
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <ProductTableBody rows={table.getRowModel().rows} />
        </Table>
      </TableContainer>

      <TablePagination
        page={page}
        pageCount={table.getPageCount()}
        perPage={perPage}
        total={result.page.total}
        rowsOnPage={result.data.length}
        busy={busy}
        canPrevious={table.getCanPreviousPage()}
        canNext={table.getCanNextPage()}
        onFirst={() => {
          table.firstPage();
        }}
        onPrevious={() => {
          table.previousPage();
        }}
        onNext={() => {
          table.nextPage();
        }}
        onLast={() => {
          table.lastPage();
        }}
        onPageSizeChange={(size) => {
          table.setPageSize(size);
        }}
      />
    </div>
  );
}

type ProductRow = Row<typeof productTableFeatures, AdminProductRow>;

/**
 * The rows: the table's most expensive part (a page of 100 products is
 * some 3,000 components), and the part that changes least. Memoised
 * (artikel 14), because the profiler showed every sort, filter and
 * search re-rendering the old page twice before the new one arrived:
 * once for the control's own update, once when the URL arrived. Neither
 * changes a row, and `memo` skips both: TanStack Table keeps the same
 * `rows` array until `data` changes, so the body renders once per
 * response, which is the one render that shows something new.
 *
 * The cells read nothing but their row and the response's
 * `low_stock_threshold` (table meta), which arrives with the rows, so a
 * new value always comes with a new `rows`.
 */
const ProductTableBody = memo(function ProductTableBody({
  rows,
}: {
  rows: readonly ProductRow[];
}) {
  return (
    <TableBody>
      {rows.map((row) => (
        <TableRow key={row.id}>
          {row.getAllCells().map((cell) => (
            <TableCell
              key={cell.id}
              className={cn(
                cell.column.columnDef.meta?.align === "end" && "text-right",
              )}
            >
              <FlexRender cell={cell} />
            </TableCell>
          ))}
        </TableRow>
      ))}
    </TableBody>
  );
});

interface SortButtonProps {
  sorted: false | SortDirection;
  alignEnd: boolean;
  onClick: ((event: unknown) => void) | undefined;
  children: ReactNode;
}

/**
 * A sortable column's header: a real <button> inside the <th>, so it is
 * in the Tab order and works with Enter and Space, with no key handler of
 * our own. The direction is on the <th> as aria-sort (read with the
 * column's name); the arrow is only for the eye.
 */
function SortButton({ sorted, alignEnd, onClick, children }: SortButtonProps) {
  const Icon =
    sorted === "asc" ? ArrowUp : sorted === "desc" ? ArrowDown : ArrowUpDown;
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "-mx-2 inline-flex h-8 cursor-pointer items-center gap-1 rounded-md px-2 font-medium hover:bg-accent hover:text-accent-foreground",
        sorted !== false && "text-foreground",
        alignEnd && "flex-row-reverse",
      )}
    >
      {children}
      <Icon
        aria-hidden="true"
        className={cn("size-4", sorted === false && "opacity-50")}
      />
    </button>
  );
}
