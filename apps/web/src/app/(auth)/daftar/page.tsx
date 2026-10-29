import type { Metadata } from "next";
import { RegisterPage } from "@/components/layout/client-pages.tsx";

export const metadata: Metadata = { title: "Daftar" };

/** /daftar: a new account. Rendered in the browser only (client-pages.tsx). */
export default function Page() {
  return <RegisterPage />;
}
