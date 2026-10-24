import { Link, NavLink } from "react-router";
import { CartNavLink } from "@/features/cart/components/CartNavLink.tsx";

/**
 * The site's banner and main navigation, on every page (RootLayout).
 *
 * <Link> renders a real <a href>: it can be opened in a new tab, copied
 * and read by a screen reader as a link. A plain click is caught and
 * handled by the router without a page load. <NavLink> is a Link that
 * knows when its page is the current one: it sets aria-current="page"
 * (which the CSS styles), so the current page is announced too.
 *
 * JSX looks like HTML but compiles to function calls, not markup: with
 * "jsx": "react-jsx" (tsconfig.app.json) the build turns
 * <header className="site-header"> into jsx("header", { className: … }),
 * imported for you from react/jsx-runtime. So `className`, not `class`;
 * every tag is closed; a component returns one root element.
 */
export function SiteHeader() {
  return (
    <header className="site-header">
      <div className="site-header__bar">
        <Link to="/" className="brand">
          GoShop
        </Link>
        <nav aria-label="Utama">
          <ul className="site-nav">
            <li>
              <CartNavLink />
            </li>
            <li>
              <NavLink to="/masuk">Masuk</NavLink>
            </li>
            <li>
              <NavLink to="/daftar">Daftar</NavLink>
            </li>
          </ul>
        </nav>
      </div>
      <p className="muted">
        Toko online contoh dari kursus Fullstack Santekno.
      </p>
    </header>
  );
}
