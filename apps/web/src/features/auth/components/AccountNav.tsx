import { NavLink } from "react-router";
import { useSession } from "../session-context.ts";

/**
 * The header's account links: Masuk and Daftar for a guest, the buyer's
 * name and Keluar after login. Fragments, because the header's list owns
 * the <li> around each item.
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
    <>
      <li className="muted">Halo, {session.user.name}</li>
      <li>
        {/* Forgets the session in this tab only. Revoking it on the
            server (POST /v1/auth/logout) needs the refresh token, which
            Bab 9 does not keep; Bab 10 does both. */}
        <button
          type="button"
          className="text-button"
          onClick={() => {
            setSession(null);
          }}
        >
          Keluar
        </button>
      </li>
    </>
  );
}
