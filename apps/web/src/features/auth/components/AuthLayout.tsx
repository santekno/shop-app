import type { ReactNode } from "react";

/**
 * A nested layout: the narrow column both auth pages sit in
 * (app/(auth)/layout.tsx renders it). /masuk and /daftar render inside
 * two layouts: the header from the root layout, this frame, then the page
 * itself as `children`. No hooks, no handlers: it stays a server
 * component, and costs the browser no JavaScript.
 */
export function AuthLayout({ children }: { children: ReactNode }) {
  return <div className="auth-layout mx-auto w-full max-w-md">{children}</div>;
}
