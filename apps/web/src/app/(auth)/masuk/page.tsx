import type { Metadata } from "next";
import { LoginPage } from "@/components/layout/client-pages.tsx";

export const metadata: Metadata = { title: "Masuk" };

/** /masuk: the login form. Rendered in the browser only (client-pages.tsx). */
export default function Page() {
  return <LoginPage />;
}
