import { useId } from "react";
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/Button.tsx";
import { Label } from "@/components/ui/Label.tsx";
import { NativeSelect } from "@/components/ui/NativeSelect.tsx";
import { PAGE_SIZE_OPTIONS } from "../product-table-params.ts";
import type { PageSize } from "../product-table-params.ts";

interface TablePaginationProps {
  /** The page asked for, 1-based. */
  page: number;
  /** ceil(total / perPage); 0 when nothing matches. */
  pageCount: number;
  perPage: PageSize;
  /** How many products match, on every page. */
  total: number;
  /** How many rows this page has (fewer on the last page). */
  rowsOnPage: number;
  /** The rows on screen are the previous page's while this one loads. */
  busy: boolean;
  /** "Pertama" and "Sebelumnya" can be used. */
  canPrevious: boolean;
  /** "Berikutnya" and "Terakhir" can be used. */
  canNext: boolean;
  onFirst: () => void;
  onPrevious: () => void;
  onNext: () => void;
  onLast: () => void;
  onPageSizeChange: (size: PageSize) => void;
}

const numberFormat = new Intl.NumberFormat("id-ID");

/**
 * Under the table: how many products there are, which ones are on screen,
 * the page size, and the buttons to move between pages.
 *
 * The summary is a role="status": when a filter or a page changes it, a
 * screen reader announces "Menampilkan 21–40 dari 57 produk" without
 * moving the focus, so the seller hears that the table changed.
 */
export function TablePagination({
  page,
  pageCount,
  perPage,
  total,
  rowsOnPage,
  busy,
  canPrevious,
  canNext,
  onFirst,
  onPrevious,
  onNext,
  onLast,
  onPageSizeChange,
}: TablePaginationProps) {
  const sizeId = useId();
  const first = (page - 1) * perPage + 1;
  const last = first + rowsOnPage - 1;

  return (
    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
      <p role="status" className="text-sm text-muted-foreground">
        {busy
          ? "Memuat produk…"
          : rowsOnPage > 0
            ? `Menampilkan ${numberFormat.format(first)}–${numberFormat.format(last)} dari ${numberFormat.format(total)} produk`
            : `${numberFormat.format(total)} produk`}
      </p>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <div className="flex items-center gap-2">
          <Label htmlFor={sizeId} className="whitespace-nowrap">
            Baris per halaman
          </Label>
          <NativeSelect
            id={sizeId}
            value={perPage}
            onChange={(event) => {
              const size = PAGE_SIZE_OPTIONS.find(
                (option) => String(option) === event.target.value,
              );
              if (size !== undefined) onPageSizeChange(size);
            }}
            className="w-20"
          >
            {PAGE_SIZE_OPTIONS.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </NativeSelect>
        </div>

        {pageCount > 0 && (
          // A <nav>, named, so a screen reader can jump to it and tell it
          // from the main menu.
          <nav
            aria-label="Halaman tabel produk"
            className="flex items-center gap-1"
          >
            <PageButton
              label="Halaman pertama"
              icon={ChevronsLeft}
              disabled={!canPrevious}
              onClick={onFirst}
            />
            <PageButton
              label="Halaman sebelumnya"
              icon={ChevronLeft}
              disabled={!canPrevious}
              onClick={onPrevious}
            />
            <span className="px-2 text-sm whitespace-nowrap">
              Halaman {numberFormat.format(page)} dari{" "}
              {numberFormat.format(pageCount)}
            </span>
            <PageButton
              label="Halaman berikutnya"
              icon={ChevronRight}
              disabled={!canNext}
              onClick={onNext}
            />
            <PageButton
              label="Halaman terakhir"
              icon={ChevronsRight}
              disabled={!canNext}
              onClick={onLast}
            />
          </nav>
        )}
      </div>
    </div>
  );
}

interface PageButtonProps {
  /** The button's name for screen readers; also its tooltip. */
  label: string;
  icon: LucideIcon;
  disabled: boolean;
  onClick: () => void;
}

/**
 * An icon-only button: the icon is hidden from screen readers, and the
 * name comes from text only they read (sr-only), as in the header's menu
 * button. A disabled <button> leaves the Tab order by itself.
 */
function PageButton({ label, icon: Icon, disabled, onClick }: PageButtonProps) {
  return (
    <Button
      variant="outline"
      size="icon"
      disabled={disabled}
      onClick={onClick}
      title={label}
    >
      <Icon aria-hidden="true" />
      <span className="sr-only">{label}</span>
    </Button>
  );
}
