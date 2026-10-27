import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { Card } from "@/components/ui/Card.tsx";
import { Section } from "@/components/ui/Section.tsx";
import { ErrorState, LoadingState } from "@/components/ui/StatusMessage.tsx";
import { useSession } from "@/features/auth/session-context.ts";
import { useCart } from "@/features/cart/hooks/useCart.ts";
import { useDocumentTitle } from "@/hooks/useDocumentTitle.ts";
import { addressesQuery, shippingQuotesQuery } from "../api/queries.ts";
import { chosenAddressId, validShippingChoice } from "../shipping.ts";
import type { ShippingChoice } from "../shipping.ts";
import { AddressStep } from "./AddressStep.tsx";
import { CourierStep } from "./CourierStep.tsx";

/**
 * /checkout (Bab 11 artikel 02–04): one page, in steps the buyer fills
 * from top to bottom: where the order goes, with which courier, and
 * (artikel 03) what it will cost.
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
 */
export function CheckoutPage() {
  useDocumentTitle("Checkout — GoShop");
  const { session, authApi } = useSession();
  // RequireAuth renders this page only when someone is logged in.
  const userId = session?.user.id ?? "";
  const cart = useCart();
  const [pickedAddress, setPickedAddress] = useState<string | null>(null);
  const [pickedShipping, setPickedShipping] = useState<ShippingChoice | null>(
    null,
  );

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

  return (
    <div className="grid gap-4">
      <Card>
        <h1 tabIndex={-1}>Checkout</h1>
        {cartIsEmpty && (
          <p className="mt-2">
            Keranjang Anda kosong. <Link to="/">Lihat produk</Link> untuk mulai
            belanja.
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
        </>
      )}
    </div>
  );
}
