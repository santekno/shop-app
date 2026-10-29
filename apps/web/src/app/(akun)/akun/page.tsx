import type { Metadata } from "next";
import { AccountPage } from "@/components/layout/client-pages.tsx";

export const metadata: Metadata = { title: "Akun saya" };

/** /akun: the logged-in buyer's account. Rendered in the browser only (client-pages.tsx). */
export default function Page() {
  return <AccountPage />;
}
