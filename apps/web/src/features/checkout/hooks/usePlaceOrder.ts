import { useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { isApiError, placeOrder } from "@goshop/shared";
import type { CheckoutRequest } from "@goshop/shared";
import { useSession } from "@/features/auth/session-context.ts";
import { cartKeys } from "@/features/cart/api/queries.ts";
import { orderKeys } from "@/features/orders/api/queries.ts";
import { checkoutKeys } from "../api/queries.ts";

/**
 * How long one checkout request may take before the client gives up on
 * it: longer than the API's own limit (APP_REQUEST_TIMEOUT, 15 s), because
 * a checkout calls the courier and runs a transaction. Giving up early is
 * still safe (the retry carries the same key), only slower.
 */
const CHECKOUT_TIMEOUT_MS = 20_000;

/** Attempts after the first, for the failures below. */
const RETRIES = 3;

/**
 * Failures worth sending the same checkout again for, with the same key:
 * no answer (the order may or may not exist: the key makes the retry
 * safe either way), the same key still running (IDEMPOTENCY_IN_PROGRESS),
 * or a gateway or the courier API that did not answer.
 */
const isRetryable = (error: unknown): boolean =>
  isApiError(
    error,
    "NETWORK_ERROR",
    "CLIENT_TIMEOUT",
    "IDEMPOTENCY_IN_PROGRESS",
    "UPSTREAM_UNAVAILABLE",
  ) ||
  (isApiError(error) && [502, 503, 504].includes(error.status));

/** The body in a fixed field order, so the same choice is the same text. */
const fingerprint = (body: CheckoutRequest): string =>
  JSON.stringify([
    body.address_id,
    body.courier,
    body.service,
    body.voucher_code ?? null,
  ]);

/**
 * Places the order (POST /v1/checkout) with an Idempotency-Key that
 * survives retries (Bab 11 artikel 04).
 *
 * The key's lifetime is one checkout attempt: one body, from the first
 * press of "Buat pesanan" until an order exists.
 *
 * - Created at the first press, kept in a ref of this page (memory only).
 * - Reused for every retry of the same body: TanStack's automatic retries
 *   after a network failure, a timeout or IDEMPOTENCY_IN_PROGRESS, the
 *   auth client's one retry after a refreshed token, and the buyer pressing
 *   the button again after an error. If the first request did create the
 *   order and only its answer was lost, the retry gets that order back
 *   (the stored 201), never a second one.
 * - Replaced when the body changes (another address, courier or voucher):
 *   the same key with another body is 422 IDEMPOTENCY_KEY_REUSED. A failed
 *   checkout frees its key on the server, so changing the body after a
 *   409 or 422 is safe.
 * - Dropped after success: the next order is a new attempt.
 *
 * Not in sessionStorage across a reload. A reload after an order went
 * through finds the cart empty (the ordered lines left it in the same
 * transaction), so a new key cannot make a second order: the API answers
 * CART_EMPTY. The server's cart is the second guard; the key handles
 * everything this page can retry by itself.
 *
 * On success the order goes into the orders cache (the payment page reads
 * it without a request), the cart is fetched again (its ordered lines are
 * gone, and the header's count must say so), and the previews are
 * dropped. CheckoutPage shows the placed order from then on, so the empty
 * cart never replaces the page under the buyer's eyes.
 */
export const usePlaceOrder = (userId: string) => {
  const queryClient = useQueryClient();
  const { authApi } = useSession();
  const attempt = useRef<{ body: string; key: string } | null>(null);

  const keyFor = (body: CheckoutRequest): string => {
    const text = fingerprint(body);
    if (attempt.current?.body !== text) {
      attempt.current = { body: text, key: crypto.randomUUID() };
    }
    return attempt.current.key;
  };

  const mutation = useMutation({
    mutationFn: ({ body, key }: { body: CheckoutRequest; key: string }) =>
      placeOrder(authApi, body, {
        idempotencyKey: key,
        timeoutMs: CHECKOUT_TIMEOUT_MS,
      }),
    // Retries reuse the variables, so the same key and the same body.
    retry: (failures, error) => failures < RETRIES && isRetryable(error),
    retryDelay: (failures) => Math.min(1_000 * 2 ** failures, 8_000),
    onSuccess: (order) => {
      attempt.current = null;
      queryClient.setQueryData(orderKeys.detail(userId, order.id), order);
      void queryClient.invalidateQueries({ queryKey: cartKeys.all });
      queryClient.removeQueries({ queryKey: checkoutKeys.previews(userId) });
    },
    onError: (error) => {
      // The cart or the courier's offer changed under the page: show the
      // server's current word before the buyer tries again.
      if (isApiError(error, "CHECKOUT_PROBLEMS", "CART_CHANGED")) {
        void queryClient.invalidateQueries({ queryKey: cartKeys.all });
        void queryClient.invalidateQueries({
          queryKey: checkoutKeys.previews(userId),
        });
      }
      if (isApiError(error, "VALIDATION_FAILED", "SHIPPING_UNAVAILABLE")) {
        void queryClient.invalidateQueries({
          queryKey: checkoutKeys.user(userId),
        });
      }
    },
  });

  return {
    ...mutation,
    /** Places the order for `body`, with the attempt's key. */
    place: (
      body: CheckoutRequest,
      options?: Parameters<typeof mutation.mutate>[1],
    ) => {
      mutation.mutate({ body, key: keyFor(body) }, options);
    },
  };
};
