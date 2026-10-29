import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useParams } from "next/navigation";
import { formatRupiah, isApiError } from "@goshop/shared";
import { Button } from "@/components/ui/Button.tsx";
import { Card } from "@/components/ui/Card.tsx";
import { ErrorState, LoadingState } from "@/components/ui/StatusMessage.tsx";
import { trackPurchaseOnce } from "@/features/analytics/purchase.ts";
import { useSession } from "@/features/auth/session-context.ts";
import { orderQuery } from "../api/queries.ts";
import {
  canStartPayment,
  payButtonText,
  paymentOutcome,
} from "../order-status.ts";
import { orderPath, paymentPath } from "../paths.ts";
import { useNavigationState } from "@/lib/navigation-state.ts";
import { POLL_LIMIT_MS, pollDelay } from "../payment-polling.ts";
import { paymentPageState } from "../payment-state.ts";
import { FakePaymentHint } from "./FakePaymentHint.tsx";
import { PayButton } from "./PayButton.tsx";
import { PaymentStatus } from "./PaymentStatus.tsx";

const timeFormat = new Intl.DateTimeFormat("id-ID", { timeStyle: "medium" });

/**
 * /pesanan/:id/pembayaran: where a buyer lands after "Buat pesanan"
 * (artikel 04), after Midtrans' hosted page (through
 * /pembayaran/selesai), and after "Bayar" on an unpaid order.
 *
 * It shows what the API says about the order, never what the return URL
 * says: Midtrans adds `transaction_status=settlement` to it, and anyone
 * can type that into an address bar. The order is paid when the API has
 * verified Midtrans' signed notification, or the reconciler has asked
 * Midtrans' status API (ADR 0007); this page asks GET /v1/orders/{id}
 * until one of them has decided (artikel 05):
 *
 * - `refetchInterval` is a function of the query: a delay while the order
 *   waits for payment (payment-polling.ts: 2 s at first, slower each
 *   time, at most every 30 s), `false` once the answer is final or the
 *   round of polling has lasted POLL_LIMIT_MS;
 * - TanStack Query does not poll a hidden tab, and asks at once when the
 *   tab is shown again (`staleTime: 0` makes the cached answer stale, so
 *   the focus refetch runs);
 * - "Periksa lagi" starts a new round after the page stopped by itself,
 *   from the fast end of the backoff again: a buyer presses it because
 *   they have just paid.
 *
 * Polling, not a push channel: an order is paid once, the answer arrives
 * within seconds of the webhook, and a handful of GETs costs less than a
 * WebSocket or SSE endpoint kept open by every buyer on this page.
 */
export function PaymentPage() {
  // The order's id from the URL (app/(akun)/pesanan/[id]/pembayaran).
  const { id } = useParams<{ id: string }>();
  // What checkout or "Bayar" handed to this page (lib/navigation-state.ts).
  const { fakeProvider, payError } = paymentPageState(
    useNavigationState(paymentPath(id)),
  );
  const { session, authApi } = useSession();
  // RequireAuth renders this page only when someone is logged in.
  const userId = session?.user.id ?? "";
  const queryClient = useQueryClient();
  const orderOptions = orderQuery(authApi, userId, id);
  // How many answers the order's query has had in this visit. The cache
  // entry outlives the page: checkout seeds it, and the buyer may come
  // back from the order's page. The query's own count (useQuery's result
  // has none).
  const answersSoFar = () =>
    queryClient.getQueryState(orderOptions.queryKey)?.dataUpdateCount ?? 0;
  // When the current round of polling started, and how many answers the
  // query had by then (the backoff counts this round's answers only, so a
  // page opened again starts at 2 s, not where the last visit stopped).
  // State, set on mount and from an event ("Periksa lagi"), never read
  // from the clock during a render.
  const [round, setRound] = useState(() => ({
    start: Date.now(),
    answers: answersSoFar(),
  }));
  const order = useQuery({
    ...orderOptions,
    enabled: session !== null,
    staleTime: 0,
    refetchInterval: (query) => {
      const data = query.state.data;
      if (data === undefined || paymentOutcome(data) !== "pending") {
        return false;
      }
      if (query.state.dataUpdatedAt - round.start > POLL_LIMIT_MS) {
        return false;
      }
      return pollDelay(query.state.dataUpdateCount - round.answers);
    },
  });

  // purchase (artikel 13): when the page sees the order paid, which is
  // when the API (the webhook or the reconciler) has decided, never
  // Midtrans' return URL. trackPurchaseOnce remembers the order, so a
  // reload or a later visit does not count it again.
  const paidOrder =
    order.status === "success" && paymentOutcome(order.data) === "paid"
      ? order.data
      : undefined;
  useEffect(() => {
    if (paidOrder !== undefined) trackPurchaseOnce(paidOrder);
  }, [paidOrder]);

  const pending =
    order.status === "success" && paymentOutcome(order.data) === "pending";
  const stopped = pending && order.dataUpdatedAt - round.start > POLL_LIMIT_MS;

  return (
    <Card>
      <h1 tabIndex={-1} className="mb-4">
        Pembayaran
      </h1>
      {payError !== undefined && (
        <p role="alert" className="mb-4 text-destructive">
          Pesanan sudah dibuat, tetapi pembayaran belum bisa dimulai: {payError}
        </p>
      )}
      {(order.status === "pending" ||
        (order.status === "error" && order.isFetching)) && (
        <LoadingState>Memuat pesanan…</LoadingState>
      )}
      {order.status === "error" &&
        !order.isFetching &&
        (isApiError(order.error, "NOT_FOUND") ? (
          <p role="alert">Pesanan ini tidak ditemukan.</p>
        ) : (
          <ErrorState
            error={order.error}
            onRetry={() => {
              void order.refetch();
            }}
          />
        ))}
      {order.status === "success" && (
        <div className="grid gap-4">
          <p>
            Pesanan{" "}
            <Link href={orderPath(order.data.id)}>
              <strong>{order.data.code}</strong>
            </Link>{" "}
            · Total <strong>{formatRupiah(order.data.totals.total)}</strong>
          </p>
          <PaymentStatus order={order.data} checkedAt={order.dataUpdatedAt} />
          {pending && (
            <p className="text-sm text-muted-foreground">
              {stopped
                ? "Pemeriksaan otomatis berhenti. "
                : "Diperiksa otomatis. "}
              Terakhir diperiksa{" "}
              {timeFormat.format(new Date(order.dataUpdatedAt))}.
            </p>
          )}
          {stopped && (
            <Button
              variant="outline"
              className="justify-self-start"
              disabled={order.isFetching}
              onClick={() => {
                setRound({ start: Date.now(), answers: answersSoFar() });
                void order.refetch();
              }}
            >
              Periksa lagi
            </Button>
          )}
          {pending && fakeProvider === true && (
            <FakePaymentHint code={order.data.code} />
          )}
          {canStartPayment(order.data, order.dataUpdatedAt) && (
            <PayButton order={order.data} replace>
              {payButtonText(order.data)}
            </PayButton>
          )}
        </div>
      )}
    </Card>
  );
}
