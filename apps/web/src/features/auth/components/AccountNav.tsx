import { lazy, Suspense, useRef, useState } from "react";
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
 * around each item. While the session is being restored at start-up,
 * nothing: showing "Masuk" to a buyer who is about to be recognised would
 * flash the wrong header.
 */
export function AccountNav() {
  const { session, status, logout } = useSession();
  // Keluar failed: the API could not confirm the logout, so the buyer is
  // still logged in, and is told so.
  const [logoutFailed, setLogoutFailed] = useState(false);
  // Set by "Keluar". The menu that had the focus disappears with the
  // session, and the focus would fall back to <body>, the top of the
  // document. The "Masuk" link that takes its place takes the focus
  // instead, so a keyboard user stays where they were.
  const focusLoginLink = useRef(false);

  if (status === "restoring") return null;

  if (status === "anonymous") {
    return (
      <>
        <li>
          <NavLink
            to="/masuk"
            // A ref callback runs when the link is attached to the page.
            ref={(link) => {
              if (link === null || !focusLoginLink.current) return;
              focusLoginLink.current = false;
              link.focus();
            }}
          >
            Masuk
          </NavLink>
        </li>
        <li>
          <NavLink to="/daftar">Daftar</NavLink>
        </li>
      </>
    );
  }

  // Here status is "authenticated", so TypeScript knows session is a
  // Session: the union in session-context.ts narrows it.
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
        {/* POST /v1/auth/web/logout ends the session on the server and
            clears the cookie, so a reload stays logged out; only then is
            the session forgotten here. */}
        <AccountMenu
          user={session.user}
          onLogout={() => {
            focusLoginLink.current = true;
            setLogoutFailed(false);
            logout().catch(() => {
              focusLoginLink.current = false;
              setLogoutFailed(true);
            });
          }}
        />
      </Suspense>
      {logoutFailed && (
        <p role="alert" className="text-sm text-destructive">
          Gagal keluar. Periksa koneksi Anda, lalu coba lagi.
        </p>
      )}
    </li>
  );
}
