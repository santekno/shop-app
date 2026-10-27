import type { Metadata } from "next";
import type { ReactNode } from "react";
import { RequireAuth } from "@/features/auth/components/RequireAuth.tsx";

/**
 * (akun) groups every page that needs a login, without adding to the URL:
 * /akun, /checkout, /pesanan, /pesanan/[id], its payment page and
 * Midtrans' return page. RequireAuth (a client component) waits for the
 * session the browser restores, then shows the page or sends a guest to
 * /masuk?kembali=…. Personal pages are never indexed.
 */
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function Layout({ children }: { children: ReactNode }) {
  return <RequireAuth>{children}</RequireAuth>;
}
