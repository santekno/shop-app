import { useEffect, useRef } from "react";
import { Link } from "react-router";
import { formatRupiah } from "@goshop/shared";
import type { OrderStatus, OrderSummary } from "@goshop/shared";
import { Button } from "@/components/ui/Button.tsx";
import {
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/Table.tsx";
import { formatDateTime } from "@/lib/format-date.ts";
import { orderStatusLabel } from "../order-status.ts";

interface OrderQueueTableProps {
  status: OrderStatus;
  /** Every order loaded so far, the pages joined. */
  orders: readonly OrderSummary[];
  /** Another page follows (`next_cursor` was not null). */
  hasMore: boolean;
  /** The next page is on its way. */
  loadingMore: boolean;
  /** Loading the next page failed; the button retries it. */
  loadMoreFailed: boolean;
  onLoadMore: () => void;
}

/**
 * The orders of one queue as a table, and "Muat lebih banyak" under it.
 *
 * The table is a real <table> in a scrolling, focusable region (artikel
 * 02's TableContainer): on a phone the columns scroll sideways inside it,
 * never the page. The order code is the row's link to the order.
 *
 * Keeping the focus while more orders load. The button is the control
 * being used, so it must not lose the focus:
 *
 * - while loading it is not `disabled` (a browser moves the focus off a
 *   disabled control, to <body>) but `aria-disabled`, and a second press
 *   does nothing;
 * - when the new page has a cursor after it, the button stays, with the
 *   focus on it, and Tab goes on from there;
 * - when it was the last page the button disappears, so the focus moves
 *   to the first order that just arrived (or, if that page was empty, to
 *   the table): where reading continues.
 *
 * The line under the table (role="status") says how many orders are
 * shown, so a screen reader hears that the press did something.
 */
export function OrderQueueTable({
  status,
  orders,
  hasMore,
  loadingMore,
  loadMoreFailed,
  onLoadMore,
}: OrderQueueTableProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  // How many orders were on screen when "Muat lebih banyak" was pressed:
  // the index of the first new one. null when no load is in flight.
  const firstNewIndex = useRef<number | null>(null);

  useEffect(() => {
    if (firstNewIndex.current === null || loadingMore) return;
    const index = firstNewIndex.current;
    firstNewIndex.current = null;
    // The button is still there (more pages, or a failure to retry): it
    // kept the focus all along.
    if (hasMore || loadMoreFailed) return;
    const container = containerRef.current;
    const link =
      container?.querySelectorAll<HTMLAnchorElement>("tbody a")[index];
    (link ?? container)?.focus();
  }, [orders.length, hasMore, loadingMore, loadMoreFailed]);

  const pending = status === "pending_payment";

  return (
    <div className="grid gap-3">
      <TableContainer
        ref={containerRef}
        aria-label={`Pesanan ${orderStatusLabel(status).toLowerCase()}`}
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nomor pesanan</TableHead>
              <TableHead>Dipesan</TableHead>
              <TableHead>
                {pending ? "Batas bayar" : "Terakhir berubah"}
              </TableHead>
              <TableHead className="text-right">Total</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {orders.map((order) => (
              <TableRow key={order.id}>
                <TableCell>
                  <Link
                    to={`/pesanan/${order.id}`}
                    className="font-mono font-medium whitespace-nowrap"
                  >
                    {order.code}
                  </Link>
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  {formatDateTime(order.created_at)}
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  {formatDateTime(
                    pending ? order.payment_expires_at : order.updated_at,
                  )}
                </TableCell>
                <TableCell className="text-right whitespace-nowrap">
                  {formatRupiah(order.total)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      <p role="status" className="text-sm text-muted-foreground">
        {hasMore
          ? `Menampilkan ${orders.length} pesanan. Masih ada pesanan lain.`
          : `Menampilkan semua ${orders.length} pesanan.`}
      </p>

      {loadMoreFailed && (
        <p role="alert" className="text-sm text-destructive">
          Pesanan berikutnya belum dapat dimuat. Periksa koneksi Anda, lalu coba
          lagi.
        </p>
      )}

      {hasMore && (
        <div>
          <Button
            variant="outline"
            aria-disabled={loadingMore}
            className="aria-disabled:cursor-wait aria-disabled:opacity-60"
            onClick={() => {
              if (loadingMore) return;
              firstNewIndex.current = orders.length;
              onLoadMore();
            }}
          >
            {loadingMore
              ? "Memuat…"
              : loadMoreFailed
                ? "Coba muat lagi"
                : "Muat lebih banyak"}
          </Button>
        </div>
      )}
    </div>
  );
}
