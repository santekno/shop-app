/**
 * What a page that renders only in the browser shows while its code
 * downloads (client-pages.tsx: the cart, the login and every page behind
 * the session). The server sends this text in the page's HTML, so even
 * before any JavaScript runs the buyer sees that something is coming.
 */
export function AppLoading() {
  return (
    <p
      role="status"
      className="text-muted-foreground mx-auto max-w-page px-4 py-6"
    >
      Memuat GoShop…
    </p>
  );
}
