import { useQuery } from "@tanstack/react-query";
import { useLocation, useParams } from "react-router";
import { formatRupiah, isApiError } from "@goshop/shared";
import { Card } from "@/components/ui/Card.tsx";
import { ErrorState, LoadingState } from "@/components/ui/StatusMessage.tsx";
import { useSession } from "@/features/auth/session-context.ts";
import { useDocumentTitle } from "@/hooks/useDocumentTitle.ts";
import { orderQuery } from "../api/queries.ts";
import { formatDateTime } from "../format.ts";
import { paymentPageState } from "../payment-state.ts";
import { FakePaymentHint } from "./FakePaymentHint.tsx";
import { PayButton } from "./PayButton.tsx";

/**
 * /pesanan/:id/pembayaran: where a buyer lands after "Buat pesanan"
 * (artikel 04), after Midtrans' hosted page (through
 * /pembayaran/selesai), and after "Bayar" on an unpaid order.
 *
 * It shows what the API says about the order, never what the return URL
 * says: Midtrans adds `transaction_status=settlement` to it, and anyone
 * can type that into an address bar. The order is paid when the API has
 * verified Midtrans' signed notification, or its status API (ADR 0007).
 */
export function PaymentPage() {
  useDocumentTitle("Pembayaran — GoShop");
  const { id = "" } = useParams();
  const location = useLocation();
  const { fakeProvider, payError } = paymentPageState(location.state);
  const { session, authApi } = useSession();
  // RequireAuth renders this page only when someone is logged in.
  const userId = session?.user.id ?? "";
  const order = useQuery({
    ...orderQuery(authApi, userId, id),
    enabled: session !== null,
  });

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
            Pesanan <strong>{order.data.code}</strong> · Total{" "}
            <strong>{formatRupiah(order.data.totals.total)}</strong>
          </p>
          {order.data.status === "pending_payment" ? (
            <>
              <p role="status">
                Menunggu pembayaran. Bayar sebelum{" "}
                {formatDateTime(order.data.payment_expires_at)}.
              </p>
              {fakeProvider === true && (
                <FakePaymentHint code={order.data.code} />
              )}
              <PayButton order={order.data} replace />
            </>
          ) : (
            <p role="status">
              {order.data.status === "cancelled"
                ? "Pesanan ini dibatalkan."
                : "Pembayaran diterima. Terima kasih!"}
            </p>
          )}
        </div>
      )}
    </Card>
  );
}
