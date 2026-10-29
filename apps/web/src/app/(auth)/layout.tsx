import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AuthLayout } from "@/features/auth/components/AuthLayout.tsx";

/**
 * (auth) is a route group: the parentheses keep it out of the URL
 * (/masuk, not /auth/masuk). It exists to give both auth pages one layout
 * and one setting: a login form is no search result.
 */
export const metadata: Metadata = { robots: { index: false } };

export default function Layout({ children }: { children: ReactNode }) {
  return <AuthLayout>{children}</AuthLayout>;
}
