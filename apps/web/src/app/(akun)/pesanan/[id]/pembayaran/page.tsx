import type { Metadata } from "next";
import { PaymentPage } from "@/components/layout/client-pages.tsx";

export const metadata: Metadata = { title: "Pembayaran" };

/** /pesanan/[id]/pembayaran: the payment's status (artikel 05). Rendered in the browser only (client-pages.tsx). */
export default function Page() {
  return <PaymentPage />;
}
