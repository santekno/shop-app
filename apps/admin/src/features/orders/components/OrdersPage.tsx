import { useSearchParams } from "react-router";
import { PageHeader } from "@/components/PageHeader.tsx";
import { Skeleton } from "@/components/ui/Skeleton.tsx";
import { EmptyState, ErrorState } from "@/components/ui/StatusMessage.tsx";
import { useDocumentTitle } from "@/hooks/useDocumentTitle.ts";
import { useOrderQueue } from "../hooks/useOrderQueue.ts";
import {
  QUEUE_HINT,
  orderStatusLabel,
  readQueueStatus,
} from "../order-status.ts";
import { OrderQueueTable } from "./OrderQueueTable.tsx";
import { OrderStatusTabs } from "./OrderStatusTabs.tsx";

/**
 * /pesanan: the order queue of one status, `paid` unless the URL says
 * otherwise (`?status=diproses`). A seller's day is this page: the paid
 * orders to pack, then the ones being packed, to ship.
 *
 * The status lives in the URL, like the product table's filters (artikel
 * 02): a tab is a link, Back returns to the previous queue, and a reload
 * or a bookmark opens the same one. Each status is its own cache entry
 * (orderKeys.queue(status)), so going back to a queue shows what was
 * loaded, and refetches it if it is older than ten seconds.
 */
export function OrdersPage() {
  const [searchParams] = useSearchParams();
  const status = readQueueStatus(searchParams);
  const label = orderStatusLabel(status);
  useDocumentTitle(`Pesanan ${label.toLowerCase()} — GoShop Admin`);
  const query = useOrderQueue(status);
  const orders = query.data?.pages.flatMap((page) => page.data) ?? [];

  return (
    <>
      <PageHeader
        title="Pesanan"
        description="Pesanan pembeli, dari yang sudah dibayar sampai selesai."
      />
      <OrderStatusTabs current={status} />
      <p className="mb-4 text-sm text-muted-foreground">{QUEUE_HINT[status]}</p>

      {query.isPending && <QueueSkeleton rows={5} />}

      {query.isError && query.data === undefined && (
        <ErrorState
          error={query.error}
          onRetry={() => {
            void query.refetch();
          }}
        />
      )}

      {query.data !== undefined &&
        (orders.length === 0 && !query.hasNextPage ? (
          <EmptyState>Tidak ada pesanan dengan status “{label}”.</EmptyState>
        ) : (
          <OrderQueueTable
            // A new status is a new list: no focus bookkeeping carries over.
            key={status}
            status={status}
            orders={orders}
            hasMore={query.hasNextPage}
            // A refetch of the loaded pages (an order event, a reconnect)
            // counts as loading too: fetchNextPage would cancel it, and the
            // pages on screen would miss what it was fetching. The button
            // says "Memuat…" and waits for it instead.
            loadingMore={query.isFetchingNextPage || query.isRefetching}
            loadMoreFailed={query.isFetchNextPageError}
            onLoadMore={() => {
              void query.fetchNextPage();
            }}
          />
        ))}
    </>
  );
}

/** The first load: grey rows in the table's shape, named for a screen reader. */
function QueueSkeleton({ rows }: { rows: number }) {
  return (
    <div
      role="status"
      className="grid gap-3 rounded-lg border border-border bg-card p-3"
    >
      <span className="sr-only">Memuat pesanan…</span>
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex items-center gap-3">
          <Skeleton className="h-4 w-44" />
          <Skeleton className="h-4 flex-1" />
          <Skeleton className="hidden h-4 w-24 sm:block" />
        </div>
      ))}
    </div>
  );
}
