import type { Metadata } from "next";
import { CartPage } from "@/components/layout/client-pages.tsx";

// A cart is one browser's: never a search result.
export const metadata: Metadata = {
  title: "Keranjang",
  robots: { index: false },
};

/** /keranjang: the cart, the guest's or the buyer's. Rendered in the browser only (client-pages.tsx). */
export default function Page() {
  return <CartPage />;
}
