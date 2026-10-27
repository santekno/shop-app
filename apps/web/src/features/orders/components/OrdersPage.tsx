import { useEffect, useRef } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import Link from "next/link";
import { formatRupiah } from "@goshop/shared";
import { Button } from "@/components/ui/Button.tsx";
import { Card } from "@/components/ui/Card.tsx";
import {
  EmptyState,
  ErrorState,
  LoadingState,
} from "@/components/ui/StatusMessage.tsx";
import { useSession } from "@/features/auth/session-context.ts";
import { ordersQuery } from "../api/queries.ts";
import { formatDateTime } from "../format.ts";
import { orderPath, paymentPath } from "../paths.ts";
import { OrderStatusBadge } from "./OrderStatusBadge.tsx";

/**
 * /pesanan: the buyer's order history (Bab 11 artikel 06), newest first,
 * from GET /v1/orders with cursor pagination.
 *
 * "Muat lebih banyak" is a button, not infinite scroll: an order history
 * is short, read rarely, and a keyboard or screen-reader user should be
 * able to reach the footer. When the next page arrives the focus moves to
 * its first order, where reading continues (the button may disappear with
 * the last page, and the focus would fall to <body>).
 *
 * An unpaid order links straight to its payment page ("Bayar"), where the
 * buyer sees the deadline and starts the payment.
 */
export function OrdersPage() {
  const { session, authApi } = useSession();
  // RequireAuth renders this page only when someone is logged in.
  const userId = session?.user.id ?? "";
  const orders = useInfiniteQuery({
    ...ordersQuery(authApi, userId),
    enabled: session !== null,
  });
  const list = useRef<HTMLUListElement>(null);
  // The index of the first order of a page asked for with the button.
  const focusFrom = useRef<number | null>(null);

  const items = orders.data?.pages.flatMap((page) => page.data) ?? [];

  useEffect(() => {
    const index = focusFrom.current;
    if (index === null || index >= items.length) return;
    focusFrom.current = null;
    const links =
      list.current?.querySelectorAll<HTMLAnchorElement>("a.order-link");
    // An index lookup is `T | undefined` here (noUncheckedIndexedAccess);
    // NodeList.item() claims a value it may not have.
    links?.[index]?.focus();
  }, [items.length]);

  return (
    <Card>
      <h1 tabIndex={-1} className="mb-4">
        Pesanan saya
      </h1>
      {(orders.status === "pending" ||
        (orders.status === "error" && orders.isFetching)) && (
        <LoadingState>Memuat pesanan…</LoadingState>
      )}
      {orders.status === "error" && !orders.isFetching && (
        <ErrorState
          error={orders.error}
          onRetry={() => {
            void orders.refetch();
          }}
        />
      )}
      {orders.status === "success" && items.length === 0 && (
        <EmptyState>
          Anda belum punya pesanan. <Link href="/">Mulai belanja</Link>.
        </EmptyState>
      )}
      {items.length > 0 && (
        <ul ref={list} className="grid gap-3" aria-label="Daftar pesanan">
          {items.map((order) => (
            <li
              key={order.id}
              className="order-row grid gap-1 border-b border-border pb-3 sm:grid-cols-[1fr_auto] sm:items-center sm:gap-4"
            >
              <div className="grid gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    className="order-link font-medium"
                    href={orderPath(order.id)}
                  >
                    {order.code}
                  </Link>
                  <OrderStatusBadge status={order.status} />
                </div>
                <p className="text-sm text-muted-foreground">
                  {formatDateTime(order.created_at)}
                </p>
              </div>
              <div className="flex items-center gap-3 sm:justify-end">
                <strong className="tabular-nums">
                  {formatRupiah(order.total)}
                </strong>
                {order.status === "pending_payment" && (
                  <Button asChild size="sm">
                    <Link
                      href={paymentPath(order.id)}
                      aria-label={`Bayar pesanan ${order.code}`}
                    >
                      Bayar
                    </Link>
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {orders.isFetchNextPageError && (
        <ErrorState
          error={orders.error}
          onRetry={() => {
            void orders.fetchNextPage();
          }}
        />
      )}
      {orders.hasNextPage && !orders.isFetchNextPageError && (
        <div className="mt-4 flex justify-center">
          <Button
            variant="outline"
            disabled={orders.isFetching}
            onClick={() => {
              focusFrom.current = items.length;
              void orders.fetchNextPage();
            }}
          >
            {orders.isFetchingNextPage ? "Memuat…" : "Muat lebih banyak"}
          </Button>
        </div>
      )}
    </Card>
  );
}
