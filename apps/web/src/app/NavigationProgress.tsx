import { useNavigation } from "react-router";

/**
 * A thin bar at the top while the router is between two pages: a lazy
 * route's code is downloading, so the old page stays on screen until the
 * new one is ready. useNavigation().state is "idle" otherwise. The text
 * is for screen readers; the bar is for the eye.
 */
export function NavigationProgress() {
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";
  return (
    <>
      {busy && <div className="navigation-progress" aria-hidden="true" />}
      <p role="status" className="visually-hidden">
        {busy ? "Memuat halaman…" : ""}
      </p>
    </>
  );
}
