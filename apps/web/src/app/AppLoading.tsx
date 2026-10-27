/**
 * What the router shows on the very first render while it still loads a
 * lazy route's code: a visit that starts on /masuk or /produk/…, before
 * the page's chunk has arrived (the route's HydrateFallback). Later
 * navigations keep the old page on screen instead (NavigationProgress).
 */
export function AppLoading() {
  return (
    <p role="status" className="app-loading">
      Memuat GoShop…
    </p>
  );
}
