// The page a product-form test lands on after a navigation (artikel 03).
import { useLocation } from "react-router";

/**
 * Where a navigation went, for a route the test does not render for real:
 * its path and the notice the create page hands over in history state.
 */
export function Landed() {
  const location = useLocation();
  const state: unknown = location.state;
  const notice =
    typeof state === "object" && state !== null && "notice" in state
      ? String(state.notice)
      : "";
  return (
    <main>
      <h1>Halaman {location.pathname}</h1>
      <p>{notice}</p>
    </main>
  );
}
