import type { Metadata } from "next";
import { CheckoutPage } from "@/components/layout/client-pages.tsx";

export const metadata: Metadata = { title: "Checkout" };

/** /checkout: address, courier, voucher and the order (artikel 02–04). Rendered in the browser only (client-pages.tsx). */
export default function Page() {
  return <CheckoutPage />;
}
