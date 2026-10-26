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
      {/* navigation-progress styles nothing: a hook for the tests. The
          animation is a theme token (index.css); with reduced motion the
          bar stands still at half width. */}
      {busy && (
        <div
          className="navigation-progress fixed inset-x-0 top-0 h-0.75 origin-left animate-navigation-progress bg-primary motion-reduce:scale-x-50 motion-reduce:animate-none"
          aria-hidden="true"
        />
      )}
      {/* sr-only: read by screen readers, invisible on screen. */}
      <p role="status" className="sr-only">
        {busy ? "Memuat halaman…" : ""}
      </p>
    </>
  );
}
