import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { formatRupiah } from "@goshop/shared";
import type { CheckoutPreviewRequest, CheckoutRequest } from "@goshop/shared";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { setNavigationState } from "@/lib/navigation-state.ts";
import { Card } from "@/components/ui/Card.tsx";
import { Section } from "@/components/ui/Section.tsx";
import { ErrorState, LoadingState } from "@/components/ui/StatusMessage.tsx";
import { useSession } from "@/features/auth/session-context.ts";
import { useCart } from "@/features/cart/hooks/useCart.ts";
import { usePayOrder } from "@/features/orders/hooks/usePayOrder.ts";
import { paymentPath } from "@/features/orders/paths.ts";
import { payErrorMessage } from "@/features/orders/payment-errors.ts";
import {
  addressesQuery,
  cartSignature,
  previewQuery,
  shippingQuotesQuery,
} from "../api/queries.ts";
import { chosenAddressId, validShippingChoice } from "../shipping.ts";
import type { ShippingChoice } from "../shipping.ts";
import { usePlaceOrder } from "../hooks/usePlaceOrder.ts";
import { AddressStep } from "./AddressStep.tsx";
import { CourierStep } from "./CourierStep.tsx";
import { PlaceOrder } from "./PlaceOrder.tsx";
import { SummaryStep } from "./SummaryStep.tsx";

/**
 * /checkout (Bab 11 artikel 02–04): one page, in steps the buyer fills
 * from top to bottom: where the order goes, with which courier, and
 * (artikel 03) what it will cost, with a voucher if the buyer has one.
 *
 * Rendered only inside RequireAuth (Bab 10 artikel 13): a guest who
 * presses "Lanjut ke checkout" goes to /masuk?kembali=/checkout first, and
 * the login merges the guest cart into theirs before coming back.
 *
 * The buyer's choices are page state (useState), not global and not in
 * the URL: they matter to this page only, and an address id in an address
 * bar that can be shared is worth nothing to anyone else. What the page
 * shows is derived from those choices and the API's lists on every render
 * (chosenAddressId, validShippingChoice in shipping.ts): the default
 * address until the buyer picks one, and a courier choice that silently
 * stops counting when the buyer picks another address.
 *
 * Artikel 04 places the order and starts paying it in one press: POST
 * /v1/checkout (usePlaceOrder, with its Idempotency-Key), then POST
 * /v1/orders/{id}/pay (usePayOrder), which sends the buyer to Midtrans or,
 * with the test gateway, to the order's payment page. Once the order
 * exists the page shows it instead of the steps: the cart it came from is
 * empty now, and "Keranjang Anda kosong" would be the wrong thing to say.
 * When the payment cannot be started the order still exists, so the buyer
 * goes to its payment page anyway, which says why and offers "Bayar".
 */
export function CheckoutPage() {
  const { session, authApi } = useSession();
  // RequireAuth renders this page only when someone is logged in.
  const userId = session?.user.id ?? "";
  const cart = useCart();
  const [pickedAddress, setPickedAddress] = useState<string | null>(null);
  const [pickedShipping, setPickedShipping] = useState<ShippingChoice | null>(
    null,
  );
  const [voucherCode, setVoucherCode] = useState<string | null>(null);
  const router = useRouter();
  const place = usePlaceOrder(userId);
  const payment = usePayOrder();

  const addresses = useQuery({
    ...addressesQuery(authApi, userId),
    enabled: session !== null,
  });
  const addressId = chosenAddressId(addresses.data, pickedAddress);
  const quotes = useQuery({
    ...shippingQuotesQuery(authApi, userId, addressId ?? ""),
    enabled: session !== null && addressId !== null,
  });
  const shipping = validShippingChoice(
    pickedShipping,
    addressId,
    quotes.data?.quotes,
  );

  const cartIsEmpty = cart.status === "success" && cart.data.lines.length === 0;

  // What the buyer has chosen so far, in the shape of the preview's body:
  // a field is sent only once it is chosen. The voucher is added on top,
  // and only after the API accepted it (VoucherForm).
  const choice: CheckoutPreviewRequest = {};
  if (addressId !== null) choice.address_id = addressId;
  if (shipping !== null) {
    choice.courier = shipping.courier;
    choice.service = shipping.service;
  }
  const signature = cartSignature(cart.data);
  const preview = useQuery({
    ...previewQuery(
      authApi,
      userId,
      signature,
      voucherCode === null ? choice : { ...choice, voucher_code: voucherCode },
    ),
    // Not before the addresses have answered: the first preview would
    // be priced without the default address, then again with it, and
    // preview, quotes and checkout share one rate limit.
    enabled:
      session !== null &&
      cart.status === "success" &&
      !cartIsEmpty &&
      addresses.status !== "pending" &&
      !place.isSuccess,
    // Another choice is another key. Until its answer arrives the summary
    // keeps the last totals (dimmed) instead of going back to "loading".
    placeholderData: keepPreviousData,
  });

  // The checkout body, once everything it needs is chosen.
  const body: CheckoutRequest | null =
    addressId === null || shipping === null
      ? null
      : {
          address_id: addressId,
          courier: shipping.courier,
          service: shipping.service,
          ...(voucherCode === null ? {} : { voucher_code: voucherCode }),
        };
  const blockedBy =
    body === null
      ? "Pilih alamat dan kurir dulu."
      : preview.status !== "success" || preview.isPlaceholderData
        ? "Tunggu ringkasan pesanan selesai dihitung."
        : null;

  const onPlace = () => {
    if (body === null) return;
    place.place(body, {
      onSuccess: (order) => {
        payment.pay(order, {
          replace: true,
          onError: (error) => {
            const path = paymentPath(order.id);
            setNavigationState(path, { payError: payErrorMessage(error) });
            router.replace(path);
          },
        });
      },
    });
  };

  if (place.data !== undefined) {
    return (
      <Card>
        <h1 tabIndex={-1} className="mb-4">
          Checkout
        </h1>
        <p role="status">
          Pesanan <strong>{place.data.code}</strong> (
          {formatRupiah(place.data.totals.total)}) sudah dibuat. Membuka
          pembayaran…
        </p>
      </Card>
    );
  }

  return (
    <div className="grid gap-4">
      <Card>
        <h1 tabIndex={-1}>Checkout</h1>
        {cartIsEmpty && (
          <p className="mt-2">
            Keranjang Anda kosong. <Link href="/">Lihat produk</Link> untuk
            mulai belanja.
          </p>
        )}
      </Card>
      {!cartIsEmpty && (
        <>
          <Section title="1. Alamat pengiriman">
            {addresses.status === "pending" && (
              <LoadingState>Memuat alamat…</LoadingState>
            )}
            {addresses.status === "error" && (
              <ErrorState
                error={addresses.error}
                onRetry={() => {
                  void addresses.refetch();
                }}
              />
            )}
            {addresses.status === "success" && (
              <AddressStep
                userId={userId}
                addresses={addresses.data}
                selectedId={addressId}
                onSelect={setPickedAddress}
              />
            )}
          </Section>
          <Section title="2. Kurir">
            <CourierStep
              hasAddress={addressId !== null}
              quotes={quotes.data?.quotes}
              loading={
                quotes.status === "pending" ||
                (quotes.status === "error" && quotes.isFetching)
              }
              error={
                quotes.status === "error" && !quotes.isFetching
                  ? quotes.error
                  : null
              }
              onRetry={() => {
                void quotes.refetch();
              }}
              selected={shipping}
              onSelect={(quote) => {
                if (addressId === null) return;
                setPickedShipping({
                  addressId,
                  courier: quote.courier,
                  service: quote.service,
                });
              }}
            />
          </Section>
          <Section title="3. Ringkasan pesanan">
            <SummaryStep
              userId={userId}
              cartSignature={signature}
              cartLines={cart.data?.lines}
              choice={choice}
              voucherCode={voucherCode}
              onVoucherChange={setVoucherCode}
              preview={preview}
            />
            <PlaceOrder
              blockedBy={blockedBy}
              busy={place.isPending || payment.isPending}
              error={place.error}
              cartLines={cart.data?.lines}
              onPlace={onPlace}
            />
          </Section>
        </>
      )}
    </div>
  );
}
