import type { Metadata } from "next";
import { OrderDetailPage } from "@/components/layout/client-pages.tsx";

export const metadata: Metadata = { title: "Detail pesanan" };

/** /pesanan/[id]: one order (artikel 06). Rendered in the browser only (client-pages.tsx). */
export default function Page() {
  return <OrderDetailPage />;
}
