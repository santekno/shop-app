import type { Metadata } from "next";
import { PaymentReturnPage } from "@/components/layout/client-pages.tsx";

export const metadata: Metadata = { title: "Pembayaran" };

/** /pembayaran/selesai: where Midtrans sends the buyer back (artikel 04). Rendered in the browser only (client-pages.tsx). */
export default function Page() {
  return <PaymentReturnPage />;
}
