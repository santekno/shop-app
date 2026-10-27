import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { ApiError, payOrder } from "@goshop/shared";
import type { Order, PaymentSession } from "@goshop/shared";
import { useSession } from "@/features/auth/session-context.ts";
import { setNavigationState } from "@/lib/navigation-state.ts";
import { paymentPath } from "../paths.ts";
import { rememberPaymentReturn } from "../payment-state.ts";

/**
 * Whether `url` is a Midtrans page the buyer may be sent to: HTTPS, on
 * midtrans.com or one of its subdomains (app.sandbox.midtrans.com in the
 * sandbox). The URL comes from our own API, which got it from Midtrans;
 * checking it anyway means a bad row or a bug can never turn "Bayar" into
 * a redirect to another site.
 */
export const isMidtransUrl = (url: string): boolean => {
  try {
    const { protocol, hostname } = new URL(url);
    return (
      protocol === "https:" &&
      (hostname === "midtrans.com" || hostname.endsWith(".midtrans.com"))
    );
  } catch {
    return false;
  }
};

/** What `pay` needs to know about the order. */
export type PayableOrder = Pick<Order, "id" | "code">;

/** Where the browser goes next for a payment session. */
type PaymentStep =
  | { kind: "fake"; order: PayableOrder }
  | { kind: "midtrans"; order: PayableOrder; url: string };

/**
 * Starts paying an order (Bab 11 artikel 04): POST /v1/orders/{id}/pay,
 * then sends the buyer where the payment happens.
 *
 * GoShop uses Snap's **redirect** flow, not Snap.js: the buyer goes to
 * the `redirect_url` Midtrans answered (its hosted payment page) and
 * comes back to /pembayaran/selesai. Snap.js would run Midtrans' script
 * inside our page, next to the access token in memory, and would need
 * its script, frame and connect origins in the CSP; the redirect needs
 * no CSP change at all (`docs/web/README.md`, artikel 04).
 *
 * Before leaving, the storefront first moves to the order's payment page
 * (`replace`, so the checkout page does not stay in the history) and
 * remembers the order in sessionStorage. Back from Midtrans, or its
 * return URL, lands on that payment page, which asks the API, never the
 * URL, whether the order is paid.
 *
 * With the test gateway (`provider: "fake"`, APP_PAYMENT_PROVIDER=fake)
 * there is no page to go to: its redirect_url is on `fake-payment.invalid`.
 * The buyer goes to the payment page, which says how to pay from a
 * terminal (`make fake-pay`), and polls like for a real payment.
 */
export const usePayOrder = () => {
  const { authApi } = useSession();
  const router = useRouter();

  const mutation = useMutation({
    mutationFn: async (order: PayableOrder): Promise<PaymentStep> => {
      const session: PaymentSession = await payOrder(authApi, order.id);
      if (session.provider === "fake") return { kind: "fake", order };
      if (!isMidtransUrl(session.redirect_url)) {
        throw new ApiError({
          status: 200,
          code: "INVALID_RESPONSE",
          message: "the payment redirect_url is not a Midtrans HTTPS page",
        });
      }
      return { kind: "midtrans", order, url: session.redirect_url };
    },
  });

  /** Sends the browser where the payment happens. */
  const go = (step: PaymentStep, replace: boolean) => {
    const path = paymentPath(step.order.id);
    if (step.kind === "fake") {
      setNavigationState(path, { fakeProvider: true });
      if (replace) router.replace(path);
      else router.push(path);
      return;
    }
    rememberPaymentReturn({ orderId: step.order.id, code: step.order.code });
    // The entry Back from Midtrans returns to is the payment page, not
    // the emptied checkout: the address bar's entry is switched to it
    // before leaving (Next.js keeps its router in step with a direct
    // history.replaceState or pushState call).
    if (replace) window.history.replaceState(null, "", path);
    else window.history.pushState(null, "", path);
    // Back may restore this very document from the back/forward cache,
    // still showing the page it left; load the payment page instead.
    window.addEventListener(
      "pageshow",
      (event) => {
        if (event.persisted) window.location.reload();
      },
      { once: true },
    );
    window.location.assign(step.url);
  };

  /**
   * Pays `order`. `replace` replaces the current history entry with the
   * payment page instead of adding one (from checkout, and on the
   * payment page itself). Errors are on the returned mutation's `error`;
   * `onError` is called too, for a caller that leaves the page anyway.
   */
  const pay = (
    order: PayableOrder,
    {
      replace = false,
      onError,
    }: { replace?: boolean; onError?: (error: unknown) => void } = {},
  ) => {
    mutation.mutate(order, {
      onError,
      onSuccess: (step) => {
        go(step, replace);
      },
    });
  };

  return { ...mutation, pay };
};
