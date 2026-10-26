import { lazy, Suspense } from "react";
import { NavLink } from "react-router";
import { useSession } from "../session-context.ts";

// Loaded the first time a logged-in header renders (see AccountMenu).
const AccountMenu = lazy(async () => ({
  default: (await import("./AccountMenu.tsx")).AccountMenu,
}));

/**
 * The header's account links: Masuk and Daftar for a guest; after login,
 * a menu under the buyer's name (shadcn/ui's DropdownMenu) with Keluar.
 * Fragments for the guest, because the header's list owns the <li>
 * around each item.
 */
export function AccountNav() {
  const { session, setSession } = useSession();

  if (session === null) {
    return (
      <>
        <li>
          <NavLink to="/masuk">Masuk</NavLink>
        </li>
        <li>
          <NavLink to="/daftar">Daftar</NavLink>
        </li>
      </>
    );
  }

  return (
    <li>
      {/* Until the menu's code arrives, the name alone: the header keeps
          its size, and nothing jumps when the menu replaces it. */}
      <Suspense
        fallback={
          <span className="text-sm text-muted-foreground">
            Halo, {session.user.name}
          </span>
        }
      >
        {/* Forgets the session in this tab only. Revoking it on the
            server (POST /v1/auth/logout) needs the refresh token, which
            Bab 9 does not keep; artikel 12 does both. */}
        <AccountMenu
          user={session.user}
          onLogout={() => {
            setSession(null);
          }}
        />
      </Suspense>
    </li>
  );
}
