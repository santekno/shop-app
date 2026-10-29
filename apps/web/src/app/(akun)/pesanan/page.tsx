import type { Metadata } from "next";
import { OrdersPage } from "@/components/layout/client-pages.tsx";

export const metadata: Metadata = { title: "Pesanan saya" };

/** /pesanan: the buyer's orders (artikel 06). Rendered in the browser only (client-pages.tsx). */
export default function Page() {
  return <OrdersPage />;
}
