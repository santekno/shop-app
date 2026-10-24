import { Outlet } from "react-router";

/**
 * A nested layout: the narrow column both auth pages sit in. It is a
 * child of RootLayout and the parent of /masuk and /daftar, so those
 * pages render inside two layouts: the header from RootLayout, this
 * frame from AuthLayout, then the page itself in this <Outlet />.
 */
export function AuthLayout() {
  return (
    <div className="auth-layout">
      <Outlet />
    </div>
  );
}
